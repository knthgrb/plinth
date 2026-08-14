import {
  canUseAlumniPayslipAccess,
  canUseFullOrganizationAccess,
} from "@/utils/org-membership-lifecycle";

/**
 * Role-based access for routes and sidebar.
 * - Employee: attendance (read-only), leave, requirements, announcements, notifications, chat, documents
 * - Accounting: payroll, accounting, attendance (e.g. own record / view-as-employee), announcements, chat, documents, assets
 * - Manager: people, attendance, leave, requirements, payslips, announcements, notifications, chat, documents
 * - HR: everything except accounting
 * - Admin: all access
 */

export type OrgRole =
  | "admin"
  | "owner"
  | "hr"
  | "manager"
  | "employee"
  | "accounting";

/** Normalize role for access checks. Case-insensitive; owner and admin both get full access. */
export function effectiveRole(role: string | undefined | null): OrgRole | null {
  if (!role || typeof role !== "string") return null;
  const r = (role as string).toLowerCase();
  if (["admin", "owner", "hr", "manager", "employee", "accounting"].includes(r)) return r as OrgRole;
  return null;
}

/** Paths that require no role (e.g. dashboard is allowed for all in org) */
const PATHS_ALL: string[] = ["/dashboard", "/announcements", "/chat", "/documents"];

/** Path -> roles that can access (admin and owner have full access everywhere) */
const ROUTE_ACCESS: Record<string, OrgRole[]> = {
  "/dashboard": ["admin", "owner", "hr", "manager", "employee", "accounting"],
  "/calendar": ["admin", "owner", "hr", "manager", "employee", "accounting"],
  "/employee": ["admin", "owner", "hr", "manager", "accounting", "employee"],
  "/employees": ["admin", "owner", "hr", "manager"],
  "/attendance": ["admin", "owner", "hr", "manager", "employee", "accounting"],
  "/evaluations": ["admin", "owner", "hr"],
  "/leave": ["admin", "owner", "hr", "manager", "employee"],
  "/requirements": ["admin", "owner", "hr", "manager", "employee"],
  "/recruitment": ["admin", "owner", "hr"],
  "/payroll": ["admin", "owner", "hr", "accounting"],
  "/payslips": ["admin", "owner", "hr", "manager", "accounting", "employee"],
  "/accounting": ["admin", "owner", "accounting"],
  "/announcements": ["admin", "owner", "hr", "manager", "accounting", "employee"],
  "/notifications": ["admin", "owner", "hr", "manager", "accounting", "employee"],
  "/chat": ["admin", "owner", "hr", "manager", "accounting", "employee"],
  "/documents": ["admin", "owner", "hr", "manager", "accounting", "employee"],
  "/assets": ["admin", "owner", "hr", "accounting"],
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
export function canAccessRoute(
  pathname: string,
  role: string | undefined | null,
  accessStatus?: string | null,
): boolean {
  const roleNorm = effectiveRole(role);
  if (!roleNorm) return false;
  let base = pathToBaseRoute(pathname);
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
  // If first segment is not a known route (e.g. it's organizationId), use second segment as base
  if (ROUTE_ACCESS[base] === undefined && segments.length >= 2) {
    base = "/" + segments[1];
  }
  const relativeSegments =
    ROUTE_ACCESS["/" + segments[0]] === undefined && segments.length >= 2
      ? segments.slice(1)
      : segments;
  const isDocumentsIndex =
    relativeSegments.length === 1 && relativeSegments[0] === "documents";

  if (!canUseFullOrganizationAccess(accessStatus)) {
    return (
      (base === "/payslips" || isDocumentsIndex) &&
      canUseAlumniPayslipAccess(accessStatus)
    );
  }

  // Admin and owner have full access to all routes
  if (roleNorm === "admin" || roleNorm === "owner") return true;
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
