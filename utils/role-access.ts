/**
 * Role-based access for routes and sidebar.
 * - Employee: attendance (read-only), leave, requirements, announcements, chat, documents
 * - Accounting: payroll, accounting, announcements, chat, documents, assets
 * - HR: everything except accounting
 * - Admin: all access
 */

export type OrgRole = "admin" | "owner" | "hr" | "employee" | "accounting";

/** Normalize owner to admin for access checks. Case-insensitive so "Employee" and "employee" both work. */
export function effectiveRole(role: string | undefined | null): OrgRole | null {
  if (!role || typeof role !== "string") return null;
  const r = (role as string).toLowerCase();
  if (r === "owner") return "admin";
  if (["admin", "hr", "employee", "accounting"].includes(r)) return r as OrgRole;
  return null;
}

/** Paths that require no role (e.g. dashboard is allowed for all in org) */
const PATHS_ALL: string[] = ["/dashboard", "/announcements", "/chat", "/documents"];

/** Path -> roles that can access (admin always implied where applicable) */
const ROUTE_ACCESS: Record<string, OrgRole[]> = {
  "/dashboard": ["admin", "hr", "employee", "accounting"],
  "/calendar": ["admin", "hr", "employee", "accounting"],
  "/employee": ["admin", "hr", "accounting", "employee"],
  "/employees": ["admin", "hr"],
  "/attendance": ["admin", "hr", "employee"],
  "/evaluations": ["admin", "hr"],
  "/leave": ["admin", "hr", "employee"],
  "/requirements": ["admin", "hr", "employee"],
  "/recruitment": ["admin", "hr"],
  "/payroll": ["admin", "hr", "accounting"],
  "/payslips": ["admin", "hr", "accounting", "employee"],
  "/accounting": ["admin", "accounting"],
  "/announcements": ["admin", "hr", "accounting", "employee"],
  "/chat": ["admin", "hr", "accounting", "employee"],
  "/documents": ["admin", "hr", "accounting", "employee"],
  "/assets": ["admin", "hr", "accounting"],
};

/**
 * Normalize path to a base route (e.g. /dashboard/foo -> /dashboard, /documents/123/edit -> /documents).
 * Expects pathname without org prefix (e.g. /accounting not /orgId/accounting).
 */
export function pathToBaseRoute(pathname: string): string {
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (segments.length === 0) return "/dashboard";
  return "/" + segments[0];
}

/**
 * Check if a role can access a route.
 * Use pathname without org prefix or with (will be stripped).
 */
export function canAccessRoute(pathname: string, role: string | undefined | null): boolean {
  const base = pathToBaseRoute(pathname);
  const roleNorm = effectiveRole(role);
  if (!roleNorm) return false;
  const allowed = ROUTE_ACCESS[base];
  if (!allowed) return false;
  return allowed.includes(roleNorm);
}

/**
 * Roles that can see a given sidebar path. Used to build navigation items.
 */
export function rolesForPath(path: string): OrgRole[] {
  return ROUTE_ACCESS[path] ?? [];
}
