import { ConvexHttpClient } from "convex/browser";
import { headers } from "next/headers";
import { getAuthToken } from "@/lib/convex-auth-proxy";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

// Returns a Convex client authenticated with the current Better Auth session.
// Works in both server actions and middleware contexts
export async function getAuthedConvexClient(incomingHeaders?: Headers) {
  try {
    const requestHeaders = incomingHeaders ?? new Headers(await headers());
    const token = await getAuthToken(requestHeaders);
    if (!token) {
      throw new Error("Not authenticated - no token available");
    }

    if (!convexUrl) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    }

    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(token);
    return client;
  } catch (error: unknown) {
    const errorDetails = error instanceof Error ? error : new Error(String(error));
    const errorCode: unknown =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "code")
        : undefined;
    if (
      errorDetails.message.includes("fetch failed") ||
      errorDetails.message.includes("ECONNREFUSED") ||
      errorDetails.message.includes("invalid transfer-encoding") ||
      errorDetails.name === "TypeError" ||
      errorCode === "UND_ERR_INVALID_ARG"
    ) {
      throw new Error(
        `Failed to authenticate with Convex. Please check:\n` +
          `1. NEXT_PUBLIC_CONVEX_URL is set: ${!!process.env.NEXT_PUBLIC_CONVEX_URL}\n` +
          `2. NEXT_PUBLIC_CONVEX_SITE_URL is set: ${!!process.env.NEXT_PUBLIC_CONVEX_SITE_URL || "using default"}\n` +
          `3. Better Auth API route is accessible at /api/auth/[...all]\n` +
          `4. Server is running and accessible\n` +
          `Original error: ${errorDetails.message}`
      );
    }
    throw error;
  }
}
