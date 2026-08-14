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
