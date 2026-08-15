import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [convexClient()],
});

export type AuthGateState = "loading" | "public" | "ready" | "invalid";
export type AuthGateView = "loader" | "children";

export function resolveAuthGateState({
  isSessionPending,
  hasSession,
  isConvexAuthLoading,
  isConvexAuthenticated,
}: {
  isSessionPending: boolean;
  hasSession: boolean;
  isConvexAuthLoading: boolean;
  isConvexAuthenticated: boolean;
}): AuthGateState {
  if (isSessionPending) return "loading";
  if (!hasSession) return "public";
  if (isConvexAuthLoading) return "loading";
  return isConvexAuthenticated ? "ready" : "invalid";
}

export function resolveAuthGateView(state: AuthGateState): AuthGateView {
  return state === "loading" || state === "invalid" ? "loader" : "children";
}

type SignOutNavigationDependencies = {
  prepare: () => void;
  signOut: () => Promise<unknown>;
  clearRoleCache: () => Promise<unknown>;
  navigateToLogin: () => void;
};

export async function completeSignOutForNavigation({
  prepare,
  signOut,
  clearRoleCache,
  navigateToLogin,
}: SignOutNavigationDependencies): Promise<void> {
  prepare();
  try {
    await Promise.all([signOut(), clearRoleCache()]);
  } finally {
    navigateToLogin();
  }
}

export async function clearRoleCacheCookie(): Promise<void> {
  try {
    await fetch("/api/auth/clear-role-cache", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Role authorization is refreshed from Convex when the cache is absent or stale.
  }
}

export function signOutAndRedirectToLogin(prepare: () => void): Promise<void> {
  return completeSignOutForNavigation({
    prepare,
    signOut: () => authClient.signOut({ fetchOptions: { throw: false } }),
    clearRoleCache: clearRoleCacheCookie,
    navigateToLogin: () => window.location.replace("/login"),
  });
}
