import { Id } from "@/convex/_generated/dataModel";

/**
 * Generate a URL with organizationId prefix
 * @param organizationId - The organization ID
 * @param path - The path (e.g., "/dashboard", "/employees")
 * @returns The full path with organizationId (e.g., "/org123/dashboard")
 */
export function getOrganizationPath(
  organizationId: Id<"organizations"> | string | null | undefined,
  path: string
): string {
  if (!organizationId) {
    return path;
  }
  
  // Remove leading slash from path if present
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  
  // Don't add organizationId if path already starts with it
  if (cleanPath.startsWith(`${organizationId}/`)) {
    return `/${cleanPath}`;
  }
  
  return `/${organizationId}/${cleanPath}`;
}

/**
 * Extract organizationId from a path
 * @param pathname - The current pathname
 * @returns The organizationId if present, null otherwise
 */
export function extractOrganizationId(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)/);
  if (match && match[1]) {
    // Check if it's not a public route
    const publicRoutes = ["login", "signup", "walkthrough", "forgot-password", "reset-password", "api", "_next"];
    if (!publicRoutes.includes(match[1])) {
      return match[1];
    }
  }
  return null;
}

/**
 * Remove organizationId from a path
 * @param pathname - The current pathname with organizationId
 * @returns The path without organizationId prefix
 */
export function removeOrganizationId(pathname: string): string {
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (match && match[2]) {
    return match[2] || "/dashboard";
  }
  return pathname;
}
