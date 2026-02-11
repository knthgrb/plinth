import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRoleWithCache, setRoleCookieIfNeeded } from "@/helpers/role-cache";

// ============================================================================
// CONSTANTS
// ============================================================================

const PUBLIC_ROUTES = [
  "/login",
  "/signup",
  "/api/auth",
  "/forbidden",
  "/walkthrough",
  "/forgot-password",
  "/reset-password",
  "/invite", // invitation accept flow; do not treat first segment as org id
] as const;

const AUTH_ROUTES = ["/login", "/signup"] as const;

const UNRESTRICTED_ROUTES = ["/forbidden"] as const;

const PUBLIC_ROUTE_SEGMENTS = [
  "login",
  "signup",
  "walkthrough",
  "forgot-password",
  "reset-password",
  "api",
  "_next",
  "forbidden",
  "favicon.ico",
  "favicon",
  ".well-known",
  "invite", // invitation accept flow; must not be treated as organizationId
] as const;

// Role-based route access definitions
const ROUTE_ACCESS = {
  // Employee-only routes
  employee: ["/payslips", "/employee"],
  // Accounting-only routes
  accounting: ["/accounting"],
  // HR routes (accessible to hr, accounting, admin, and owner roles)
  hr: [
    "/dashboard",
    "/employees",
    "/attendance",
    "/payroll",
    "/recruitment",
    "/requirements",
    "/assets",
  ],
  // Routes accessible to all authenticated roles
  all: ["/documents", "/chat", "/announcements", "/leave", "/evaluations"],
} as const;

// Valid roles
type Role = "admin" | "owner" | "hr" | "employee" | "accounting";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a pathname matches a route pattern
 */
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * Check if pathname is a static asset or public route (skip role lookup)
 */
function isStaticOrPublicPath(pathname: string): boolean {
  return (
    pathname === "/favicon.ico" ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/.well-known") ||
    /\.(?:ico|svg|png|jpg|jpeg|gif|webp|woff2?|css|js|json|lottie)$/i.test(pathname)
  );
}

/**
 * Check if pathname is a public route
 */
function isPublicRoute(pathname: string): boolean {
  return (
    isStaticOrPublicPath(pathname) ||
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/api")
  );
}

/**
 * Check if pathname is an auth route
 */
function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname.startsWith(route));
}

/**
 * Check if user is authenticated by checking for better-auth session cookie
 */
function isAuthenticated(request: NextRequest): boolean {
  const cookies = request.cookies.getAll();
  return cookies.some(
    (cookie) => /better-auth/i.test(cookie.name) && cookie.value,
  );
}

/**
 * Convex IDs are alphanumeric (lowercase letters + digits), typically 20+ chars.
 * Reject segments that look like files or non-IDs so we never pass them to getCurrentUser.
 */
function looksLikeConvexId(segment: string): boolean {
  return /^[a-z0-9]{20,}$/.test(segment) && !segment.includes(".");
}

/**
 * Extract organizationId from pathname (format: /{organizationId}/path)
 */
function extractOrganizationId(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)/);
  if (match && match[1]) {
    const segment = match[1];
    if (
      !PUBLIC_ROUTE_SEGMENTS.includes(segment as any) &&
      looksLikeConvexId(segment)
    ) {
      return segment;
    }
  }
  return null;
}

/**
 * Remove organizationId from pathname to get clean route
 */
function removeOrganizationId(pathname: string): string {
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (match && match[2]) {
    return match[2] || "/dashboard";
  }
  return pathname;
}

/**
 * Build path with organizationId
 */
function buildPathWithOrg(organizationId: string | null, path: string): string {
  if (!organizationId) return path;
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `/${organizationId}/${cleanPath}`;
}

/**
 * Get default route for a role
 * - Admin/Owner → dashboard
 * - Employee → announcements
 * - Accounting → accounting
 * - Others → dashboard
 */
function getDefaultRouteForRole(role: string | null): string {
  if (!role) return "/dashboard";

  const normalizedRole = role.toLowerCase() as Role;

  switch (normalizedRole) {
    case "employee":
      return "/announcements";
    case "accounting":
      return "/accounting";
    case "admin":
    case "owner":
    case "hr":
    default:
      return "/dashboard";
  }
}

/**
 * Normalize role to lowercase and validate
 */
function normalizeRole(role: string | null): Role | null {
  if (!role) return null;
  const normalized = role.toLowerCase();
  const validRoles: Role[] = ["admin", "owner", "hr", "employee", "accounting"];
  return validRoles.includes(normalized as Role) ? (normalized as Role) : null;
}

/**
 * Check if user has access to a route based on their role
 */
function hasAccessToRoute(
  userRole: Role,
  cleanPathname: string,
): { hasAccess: boolean; reason?: string } {
  // Unrestricted routes are accessible to all authenticated users
  if (UNRESTRICTED_ROUTES.some((route) => matchesRoute(cleanPathname, route))) {
    return { hasAccess: true };
  }

  // Owner and admin have access to everything except employee-only routes
  // This check must come first to ensure owner/admin always have access
  if (userRole === "owner" || userRole === "admin") {
    // Only block employee-only routes for owner/admin
    const isEmployeeRoute = ROUTE_ACCESS.employee.some((route) =>
      matchesRoute(cleanPathname, route),
    );
    if (isEmployeeRoute) {
      return {
        hasAccess: false,
        reason: "This route is only accessible to employees",
      };
    }
    // Owner and admin have access to all other routes
    return { hasAccess: true };
  }

  // Check employee-only routes
  const isEmployeeRoute = ROUTE_ACCESS.employee.some((route) =>
    matchesRoute(cleanPathname, route),
  );
  if (isEmployeeRoute) {
    if (userRole !== "employee") {
      return {
        hasAccess: false,
        reason: "This route is only accessible to employees",
      };
    }
    return { hasAccess: true };
  }

  // Check accounting routes (accessible to accounting, admin, and owner)
  const isAccountingRoute = ROUTE_ACCESS.accounting.some((route) =>
    matchesRoute(cleanPathname, route),
  );
  if (isAccountingRoute) {
    const allowedAccountingRoles: readonly Role[] = [
      "accounting",
      "admin",
      "owner",
    ] as const;
    if (!(allowedAccountingRoles as readonly string[]).includes(userRole)) {
      return {
        hasAccess: false,
        reason: "This route requires accounting, admin, or owner role",
      };
    }
    return { hasAccess: true };
  }

  // Check HR routes (accessible to hr, accounting, admin, and owner)
  const isHrRoute = ROUTE_ACCESS.hr.some((route) =>
    matchesRoute(cleanPathname, route),
  );
  if (isHrRoute) {
    const allowedRoles: readonly Role[] = [
      "hr",
      "accounting",
      "admin",
      "owner",
    ] as const;
    if (!(allowedRoles as readonly string[]).includes(userRole)) {
      return {
        hasAccess: false,
        reason: "This route requires HR, accounting, admin, or owner role",
      };
    }
    return { hasAccess: true };
  }

  // Check all-roles routes
  // Note: owner/admin should have already been handled above, but this is a fallback
  const isAllRolesRoute = ROUTE_ACCESS.all.some((route) =>
    matchesRoute(cleanPathname, route),
  );
  if (isAllRolesRoute) {
    // These routes are accessible to hr, accounting, employee, admin, and owner
    const allowedRoles: readonly Role[] = [
      "hr",
      "accounting",
      "employee",
      "admin",
      "owner",
    ] as const;
    if ((allowedRoles as readonly string[]).includes(userRole)) {
      return { hasAccess: true };
    }
    return {
      hasAccess: false,
      reason: "This route requires a valid role",
    };
  }

  // All other routes are accessible to authenticated users
  // (pages will handle their own specific checks)
  return { hasAccess: true };
}

// ============================================================================
// MAIN MIDDLEWARE FUNCTION
// ============================================================================

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Step 1: Allow public routes and static assets
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Step 2: Check authentication
  if (!isAuthenticated(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Step 3: Extract organizationId from URL early (if present)
  const urlOrganizationId = extractOrganizationId(pathname);

  // Step 4: Get user role and organization (with caching)
  let cachedUserRole: string | null | undefined = undefined;
  let cachedOrganizationId: string | null | undefined = undefined;
  let shouldSetRoleCookie = false;
  let roleCookieRole: string | null = null;
  let roleCookieOrgId: string | null = null;

  const getUserRoleCached = async (): Promise<string | null> => {
    if (cachedUserRole === undefined) {
      try {
        // Use organizationId from URL if available, otherwise use cached or null
        const orgIdToUse = urlOrganizationId || cachedOrganizationId || null;
        const result = await getRoleWithCache(request, orgIdToUse);
        cachedUserRole = result.role;
        cachedOrganizationId = result.organizationId || orgIdToUse;
        if (!result.fromCache) {
          shouldSetRoleCookie = true;
          roleCookieRole = result.role;
          roleCookieOrgId = result.organizationId || orgIdToUse;
        }
      } catch (error) {
        console.error("[PROXY] Error getting user role:", error);
        cachedUserRole = null;
        cachedOrganizationId = urlOrganizationId || null;
      }
    }
    return cachedUserRole;
  };

  const applyRoleCookie = async (
    response: NextResponse,
  ): Promise<NextResponse> => {
    if (shouldSetRoleCookie) {
      await setRoleCookieIfNeeded(
        response,
        roleCookieRole,
        roleCookieOrgId,
        shouldSetRoleCookie,
      );
    }
    return response;
  };

  // Step 5: Handle authenticated users on auth routes - redirect to proper page
  if (isAuthRoute(pathname)) {
    const userRole = await getUserRoleCached();
    const orgId = cachedOrganizationId;

    // If no role yet, allow the request (prevents loops during initial load)
    if (!userRole && cachedUserRole === null) {
      return applyRoleCookie(NextResponse.next());
    }

    const defaultRoute = getDefaultRouteForRole(userRole);
    const redirectPath = orgId
      ? buildPathWithOrg(orgId, defaultRoute)
      : defaultRoute;

    return applyRoleCookie(
      NextResponse.redirect(new URL(redirectPath, request.url)),
    );
  }

  // Step 6: Handle root path - redirect based on role
  if (pathname === "/") {
    const userRole = await getUserRoleCached();
    const orgId = cachedOrganizationId;

    // If no role yet, allow the request (prevents loops during initial load)
    if (!userRole && cachedUserRole === null) {
      return applyRoleCookie(NextResponse.next());
    }

    const defaultRoute = getDefaultRouteForRole(userRole);
    const redirectPath = orgId
      ? buildPathWithOrg(orgId, defaultRoute)
      : defaultRoute;

    return applyRoleCookie(
      NextResponse.redirect(new URL(redirectPath, request.url)),
    );
  }

  // Step 7: Extract organizationId and clean pathname (already extracted above)
  const cleanPathname = urlOrganizationId
    ? removeOrganizationId(pathname)
    : pathname;

  // Step 8: Role-based route protection
  const userRole = await getUserRoleCached();
  const normalizedRole = normalizeRole(userRole);

  // Debug logging in development
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[PROXY] Route check: pathname=${pathname}, cleanPathname=${cleanPathname}, userRole=${userRole}, normalizedRole=${normalizedRole}`,
    );
  }

  // Allow forbidden page (prevents redirect loops)
  if (matchesRoute(cleanPathname, "/forbidden")) {
    return applyRoleCookie(NextResponse.next());
  }

  // Dashboard requires HR/admin/owner roles - handle separately
  if (matchesRoute(cleanPathname, "/dashboard")) {
    if (!normalizedRole) {
      // No role yet - allow but let page handle it (prevents loops during initial load)
      if (process.env.NODE_ENV === "development") {
        console.log("[PROXY] Dashboard: No role yet, allowing through");
      }
      return applyRoleCookie(NextResponse.next());
    }

    // Redirect employees and accounting to their default routes
    if (normalizedRole === "employee" || normalizedRole === "accounting") {
      const defaultRoute = getDefaultRouteForRole(normalizedRole);
      const orgId = urlOrganizationId || cachedOrganizationId || null;
      const redirectPath = buildPathWithOrg(orgId, defaultRoute);
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[PROXY] Dashboard: Redirecting ${normalizedRole} to ${redirectPath}`,
        );
      }
      return applyRoleCookie(
        NextResponse.redirect(new URL(redirectPath, request.url)),
      );
    }

    // Allow dashboard for admin, owner, and hr roles
    if (
      normalizedRole === "admin" ||
      normalizedRole === "owner" ||
      normalizedRole === "hr"
    ) {
      if (process.env.NODE_ENV === "development") {
        console.log(`[PROXY] Dashboard: Allowing access for ${normalizedRole}`);
      }
      return applyRoleCookie(NextResponse.next());
    }

    // Any other role - redirect to forbidden
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[PROXY] Dashboard: Unknown role ${normalizedRole}, redirecting to forbidden`,
      );
    }
    const orgId = urlOrganizationId || cachedOrganizationId;
    const forbiddenPath = orgId
      ? buildPathWithOrg(orgId, "/forbidden")
      : "/forbidden";
    return applyRoleCookie(
      NextResponse.redirect(new URL(forbiddenPath, request.url)),
    );
  }

  // If we can't resolve a role yet, allow unrestricted routes only
  if (!normalizedRole && cachedUserRole === null) {
    if (
      UNRESTRICTED_ROUTES.some((route) => matchesRoute(cleanPathname, route))
    ) {
      return applyRoleCookie(NextResponse.next());
    }
    // For protected routes, allow but let page handle it
    return applyRoleCookie(NextResponse.next());
  }

  // Check access to the requested route (only if we have a valid role)
  if (!normalizedRole) {
    // No role yet - allow unrestricted routes only
    if (
      UNRESTRICTED_ROUTES.some((route) => matchesRoute(cleanPathname, route))
    ) {
      return applyRoleCookie(NextResponse.next());
    }
    // For protected routes without role, allow but let page handle it
    return applyRoleCookie(NextResponse.next());
  }

  // Check access with valid role
  const accessCheck = hasAccessToRoute(normalizedRole, cleanPathname);

  if (!accessCheck.hasAccess) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[PROXY] Access denied: role=${normalizedRole}, pathname=${pathname}, cleanPathname=${cleanPathname}, reason=${accessCheck.reason}`,
      );
    }

    // Redirect to forbidden page, preserving organizationId if present
    const orgId = urlOrganizationId || cachedOrganizationId;
    const forbiddenPath = orgId
      ? buildPathWithOrg(orgId, "/forbidden")
      : "/forbidden";
    return applyRoleCookie(
      NextResponse.redirect(new URL(forbiddenPath, request.url)),
    );
  }

  // Step 9: All checks passed, allow the request
  return applyRoleCookie(NextResponse.next());
}

// Proxy always runs on Node.js runtime. Do not export route segment config here.
