import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth";
import authConfig from "./auth.config";

// Prefer an explicit SITE_URL, fall back to NEXT_PUBLIC_SITE_URL or localhost
const siteUrl =
  process.env.SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000";

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(
  (
    components as unknown as {
      betterAuth: Parameters<typeof createClient<DataModel>>[0];
    }
  ).betterAuth
);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    // Allow tokens to be issued/read from the configured site origin as well
    trustedOrigins: [siteUrl, "http://localhost:3000"],
    // Configure simple, non-verified email/password to get started
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url, token }, request) => {
        // Call our API route to send the password reset email
        // Don't await to prevent timing attacks
        void fetch(`${siteUrl}/api/auth/send-password-reset`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user, url, token }),
        }).catch((error) => {
          console.error("Failed to send password reset email:", error);
        });
      },
    },
    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
};

// Example function for getting the current user
// Feel free to edit, omit, etc.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
