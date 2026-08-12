import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { headers } from "next/headers";
import { getAuthToken } from "@/lib/convex-auth-proxy";

export const {
  handler,
  preloadAuthQuery,
  isAuthenticated,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
  convexSiteUrl:
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
    (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".cloud", ".site"),
});

export async function getToken() {
  return getAuthToken(new Headers(await headers()));
}
