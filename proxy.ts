import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRoleWithCache, setRoleCookieIfNeeded } from "@/helpers/role-cache";

// Public routes that don't require authentication
const publicRoutes = ["/login", "/signup", "/api/auth", "/forbidden"];

// Routes that should redirect authenticated users to dashboard
const authRoutes = ["/login", "/signup"];

// Employee-only routes (only employees can access)
const employeeOnlyRoutes = ["/payslips", "/employee"];

// Accounting routes (admin and accounting roles)
const accountingRoutes = ["/accounting"];

// HR routes (admin, hr, and accounting roles can access)
const hrRoutes = [
  "/employees",
  "/attendance",
  "/payroll",
  "/recruitment",
  "/requirements",
  "/assets", // Assets Management
  "/settings/payroll", // Payroll Settings
  "/settings/leave-types", // Leave Types
  "/settings/departments", // Departments
  "/settings/holidays", // Holidays
];

// Routes accessible to admin, hr, accounting, and employee
const allRolesRoutes = ["/documents", "/chat"];

const matchesRoute = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`);

// Helper function to check if user has access to route
function hasAccessToRoute(
  userRole: string | null,
  pathname: string
): { hasAccess: boolean; shouldRedirect?: string } {
  // Check employee-only routes (exact or subpath match)
  if (employeeOnlyRoutes.some((route) => matchesRoute(pathname, route))) {
    if (userRole !== "employee") {
      return { hasAccess: false, shouldRedirect: "/forbidden" };
    }
    return { hasAccess: true };
  }

  // Check accounting routes (exact or subpath match)
  if (accountingRoutes.some((route) => matchesRoute(pathname, route))) {
    if (userRole !== "accounting" && userRole !== "admin") {
      return { hasAccess: false, shouldRedirect: "/forbidden" };
    }
    return { hasAccess: true };
  }

  // Check HR routes (exact or subpath match)
  if (hrRoutes.some((route) => matchesRoute(pathname, route))) {
    if (
      userRole !== "admin" &&
      userRole !== "hr" &&
      userRole !== "accounting"
    ) {
      return { hasAccess: false, shouldRedirect: "/forbidden" };
    }
    return { hasAccess: true };
  }

  // Check routes accessible to all roles (admin, hr, accounting, employee)
  if (allRolesRoutes.some((route) => matchesRoute(pathname, route))) {
    if (
      userRole !== "admin" &&
      userRole !== "hr" &&
      userRole !== "accounting" &&
      userRole !== "employee"
    ) {
      return { hasAccess: false, shouldRedirect: "/forbidden" };
    }
    return { hasAccess: true };
  }

  // All other routes are accessible to authenticated users (pages will handle their own checks)
  return { hasAccess: true };
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes and API routes
  if (
    publicRoutes.some((route) => pathname.startsWith(route)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  // Check if user is authenticated by checking for better-auth session cookie
  const cookies = request.cookies.getAll();
  const hasSessionCookie = cookies.some(
    (cookie) => /better-auth/i.test(cookie.name) && cookie.value
  );

  const isAuthenticated = hasSessionCookie;

  // If user is not authenticated and trying to access protected routes, redirect to login
  if (
    !isAuthenticated &&
    !publicRoutes.some((route) => pathname.startsWith(route))
  ) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Optimization: cache role once per request; also optionally set a signed cookie for reuse
  let cachedUserRole: string | null | undefined = undefined;
  let cachedOrganizationId: string | null | undefined = undefined;
  let shouldSetRoleCookie = false;
  let roleCookieRole: string | null = null;
  let roleCookieOrgId: string | null = null;

  const getUserRoleCached = async (): Promise<string | null> => {
    if (cachedUserRole === undefined) {
      const result = await getRoleWithCache(request);
      cachedUserRole = result.role;
      cachedOrganizationId = result.organizationId;
      if (!result.fromCache) {
        shouldSetRoleCookie = true;
        roleCookieRole = result.role;
        roleCookieOrgId = result.organizationId;
      }
    }
    return cachedUserRole;
  };

  const applyRoleCookie = async (response: NextResponse) => {
    if (shouldSetRoleCookie) {
      await setRoleCookieIfNeeded(
        response,
        roleCookieRole,
        roleCookieOrgId,
        shouldSetRoleCookie
      );
    }
    return response;
  };

  // If user is authenticated and trying to access auth pages, redirect based on role
  if (
    isAuthenticated &&
    authRoutes.some((route) => pathname.startsWith(route))
  ) {
    const userRole = await getUserRoleCached();

    if (userRole === "accounting") {
      const response = NextResponse.redirect(
        new URL("/accounting", request.url)
      );
      return applyRoleCookie(response);
    } else if (userRole === "employee") {
      const response = NextResponse.redirect(
        new URL("/announcements", request.url)
      );
      return applyRoleCookie(response);
    } else {
      const response = NextResponse.redirect(
        new URL("/dashboard", request.url)
      );
      return applyRoleCookie(response);
    }
  }

  // Handle root path - redirect based on role
  if (isAuthenticated && pathname === "/") {
    const userRole = await getUserRoleCached();

    if (userRole === "accounting") {
      const response = NextResponse.redirect(
        new URL("/accounting", request.url)
      );
      return applyRoleCookie(response);
    } else if (userRole === "employee") {
      const response = NextResponse.redirect(
        new URL("/announcements", request.url)
      );
      return applyRoleCookie(response);
    } else if (userRole === "admin" || userRole === "hr") {
      const response = NextResponse.redirect(
        new URL("/dashboard", request.url)
      );
      return applyRoleCookie(response);
    } else {
      // Fallback to dashboard if role is unknown
      const response = NextResponse.redirect(
        new URL("/dashboard", request.url)
      );
      return applyRoleCookie(response);
    }
  }

  // Role-based route protection for authenticated users
  if (isAuthenticated) {
    const userRole = await getUserRoleCached();

    // If we can't resolve a role, avoid false negatives—let the request pass
    if (!userRole) {
      const response = NextResponse.next();
      return applyRoleCookie(response);
    }

    // Check access to the requested route
    const accessCheck = hasAccessToRoute(userRole, pathname);

    if (!accessCheck.hasAccess) {
      // Redirect to forbidden page if user doesn't have access
      const response = NextResponse.redirect(
        new URL(accessCheck.shouldRedirect || "/forbidden", request.url)
      );
      return applyRoleCookie(response);
    }
  }

  // All checks passed, allow the request
  const response = NextResponse.next();
  return applyRoleCookie(response);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
