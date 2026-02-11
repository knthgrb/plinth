import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";
import { cookies } from "next/headers";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

// Returns a Convex client authenticated with the current Better Auth session.
// Works in both server actions and middleware contexts
export async function getAuthedConvexClient() {
  try {
    // Ensure cookies are available (for server actions)
    // In middleware, this will be a no-op but won't hurt
    try {
      await cookies();
    } catch {
      // In middleware, cookies() might not be available, but getToken() should still work
      // with the request context
    }

    const token = await getToken();
    if (!token) {
      throw new Error("Not authenticated - no token available");
    }

    if (!convexUrl) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    }

    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(token);
    return client;
  } catch (error: any) {
    // Provide more helpful error message for common issues
    if (
      error.message?.includes("fetch failed") ||
      error.message?.includes("ECONNREFUSED") ||
      error.message?.includes("invalid transfer-encoding") ||
      error.name === "TypeError" ||
      error.code === "UND_ERR_INVALID_ARG"
    ) {
      const siteUrl =
        process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
        process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".cloud", ".site");
      throw new Error(
        `Failed to authenticate with Convex. Please check:\n` +
          `1. NEXT_PUBLIC_CONVEX_URL is set: ${!!process.env.NEXT_PUBLIC_CONVEX_URL}\n` +
          `2. NEXT_PUBLIC_CONVEX_SITE_URL is set: ${!!process.env.NEXT_PUBLIC_CONVEX_SITE_URL || "using default"}\n` +
          `3. Better Auth API route is accessible at /api/auth/[...all]\n` +
          `4. Server is running and accessible\n` +
          `Original error: ${error.message || error}`
      );
    }
    throw error;
  }
}
