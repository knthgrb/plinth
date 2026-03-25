import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRoleWithCache, setRoleCookieIfNeeded } from "@/helpers/role-cache";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PUBLIC_ROUTES = [
  "/login", "/signup", "/api/auth", "/forbidden", "/walkthrough",
  "/forgot-password", "/reset-password", "/invite",
] as const;

const AUTH_ROUTES = ["/login", "/signup"] as const;

const PUBLIC_ROUTE_SEGMENTS = [
  "login", "signup", "walkthrough", "forgot-password", "reset-password",
  "api", "_next", "forbidden", "favicon.ico", "favicon", ".well-known", "invite",
] as const;

type Role = "admin" | "owner" | "hr" | "employee" | "accounting";

const ROLES_HR = ["hr", "admin", "owner"] as const;
const ROLES_HR_AND_ACCOUNTING = ["hr", "admin", "owner", "accounting"] as const;
const ROLES_ACCOUNTING_PAGE = ["accounting", "admin", "owner"] as const;
const ROLES_ALL_AUTH = ["hr", "accounting", "employee", "admin", "owner"] as const;

/** Route access: list of path prefixes → allowed roles. First match wins. */
const ROUTE_ROLES: { routes: readonly string[]; roles: readonly Role[] }[] = [
  // Payslips + employee hub: all org roles (layout + Convex enforce fine-grained access; "view as employee" needs this)
  { routes: ["/payslips", "/employee"], roles: ROLES_ALL_AUTH },
  { routes: ["/accounting"], roles: ROLES_ACCOUNTING_PAGE },
  { routes: ["/payroll", "/assets"], roles: ROLES_HR_AND_ACCOUNTING },
  { routes: ["/dashboard", "/employees", "/attendance", "/recruitment", "/requirements"], roles: ROLES_HR },
  { routes: ["/documents", "/chat", "/announcements", "/leave", "/evaluations"], roles: ROLES_ALL_AUTH },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const matchesRoute = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`);

function isStaticOrPublicPath(pathname: string): boolean {
  return (
    pathname === "/favicon.ico" ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/.well-known") ||
    /\.(?:ico|svg|png|jpg|jpeg|gif|webp|woff2?|css|js|json|lottie)$/i.test(pathname)
  );
}

function isPublicRoute(pathname: string): boolean {
  return (
    isStaticOrPublicPath(pathname) ||
    PUBLIC_ROUTES.some((r) => pathname.startsWith(r)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/api")
  );
}

const isAuthRoute = (pathname: string) =>
  AUTH_ROUTES.some((r) => pathname.startsWith(r));

function isAuthenticated(request: NextRequest): boolean {
  return request.cookies.getAll().some(
    (c) => /better-auth/i.test(c.name) && c.value,
  );
}

function looksLikeConvexId(segment: string): boolean {
  return /^[a-z0-9]{20,}$/.test(segment) && !segment.includes(".");
}

function extractOrganizationId(pathname: string): string | null {
  const m = pathname.match(/^\/([^/]+)/);
  if (!m?.[1]) return null;
  const seg = m[1];
  if (PUBLIC_ROUTE_SEGMENTS.includes(seg as any)) return null;
  return looksLikeConvexId(seg) ? seg : null;
}

function removeOrganizationId(pathname: string): string {
  const m = pathname.match(/^\/([^/]+)(\/.*)?$/);
  return (m && m[2] ? m[2] : pathname) || "/dashboard";
}

function buildPathWithOrg(orgId: string | null, path: string): string {
  if (!orgId) return path;
  return `/${orgId}/${path.startsWith("/") ? path.slice(1) : path}`;
}

function getDefaultRouteForRole(role: string | null): string {
  if (!role) return "/dashboard";
  const r = role.toLowerCase();
  // Only employee and accounting land on announcements; admin/owner/hr land on dashboard
  if (r === "employee" || r === "accounting") return "/announcements";
  return "/dashboard";
}

function normalizeRole(role: string | null): Role | null {
  if (!role) return null;
  const r = role.toLowerCase();
  const valid: Role[] = ["admin", "owner", "hr", "employee", "accounting"];
  return valid.includes(r as Role) ? (r as Role) : null;
}

function hasAccessToRoute(userRole: Role, cleanPathname: string): boolean {
  if (matchesRoute(cleanPathname, "/forbidden")) return true;
  for (const { routes, roles } of ROUTE_ROLES) {
    if (routes.some((r) => matchesRoute(cleanPathname, r)))
      return (roles as readonly string[]).includes(userRole);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicRoute(pathname)) return NextResponse.next();
  if (!isAuthenticated(request)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  const urlOrganizationId = extractOrganizationId(pathname);
  let cachedUserRole: string | null | undefined = undefined;
  let cachedOrganizationId: string | null | undefined = undefined;
  let shouldSetRoleCookie = false;
  let roleCookieRole: string | null = null;
  let roleCookieOrgId: string | null = null;

  const getUserRoleCached = async (): Promise<string | null> => {
    if (cachedUserRole !== undefined) return cachedUserRole;
    try {
      const orgIdToUse = urlOrganizationId ?? cachedOrganizationId ?? null;
      const result = await getRoleWithCache(request, orgIdToUse);
      cachedUserRole = result.role;
      cachedOrganizationId = result.organizationId ?? orgIdToUse;
      if (!result.fromCache) {
        shouldSetRoleCookie = true;
        roleCookieRole = result.role;
        roleCookieOrgId = result.organizationId ?? orgIdToUse;
      }
    } catch (e) {
      console.error("[PROXY] Error getting user role:", e);
      cachedUserRole = null;
      cachedOrganizationId = urlOrganizationId ?? null;
    }
    return cachedUserRole ?? null;
  };

  const applyCookie = async (res: NextResponse) => {
    if (shouldSetRoleCookie)
      await setRoleCookieIfNeeded(res, roleCookieRole, roleCookieOrgId, true);
    return res;
  };

  const redirectToDefault = async () => {
    const userRole = await getUserRoleCached();
    // Avoid role-based redirects from auth routes because role cookie can be stale
    // across organizations right after login; root app page resolves correct org+role.
    if (userRole) return applyCookie(NextResponse.redirect(new URL("/", request.url)));
    return applyCookie(NextResponse.next());
  };

  const redirectToForbidden = () => {
    const orgId = urlOrganizationId ?? cachedOrganizationId;
    const url = new URL(orgId ? buildPathWithOrg(orgId, "/forbidden") : "/forbidden", request.url);
    return applyCookie(NextResponse.redirect(url));
  };

  if (isAuthRoute(pathname)) return redirectToDefault();

  if (pathname === "/") {
    // Let app/page.tsx compute default route from live org membership + role.
    // This avoids incorrect redirects caused by stale role cache.
    return applyCookie(NextResponse.next());
  }

  const cleanPathname = urlOrganizationId ? removeOrganizationId(pathname) : pathname;
  const userRole = await getUserRoleCached();
  const normalizedRole = normalizeRole(userRole);

  if (matchesRoute(cleanPathname, "/forbidden"))
    return applyCookie(NextResponse.next());

  if (matchesRoute(cleanPathname, "/dashboard")) {
    if (!normalizedRole) return applyCookie(NextResponse.next());
    // Employee and accounting default to announcements; admin/owner/hr stay on dashboard
    if (normalizedRole === "employee" || normalizedRole === "accounting")
      return applyCookie(NextResponse.redirect(new URL(buildPathWithOrg(urlOrganizationId ?? cachedOrganizationId ?? null, "/announcements"), request.url)));
    if (["admin", "owner", "hr"].includes(normalizedRole))
      return applyCookie(NextResponse.next());
    return redirectToForbidden();
  }

  if (!normalizedRole) return applyCookie(NextResponse.next());
  if (!hasAccessToRoute(normalizedRole, cleanPathname)) return redirectToForbidden();

  return applyCookie(NextResponse.next());
}
