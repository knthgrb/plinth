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
    trustedOrigins: [
      siteUrl,
      "http://localhost:3000",
      "https://plinth-mu.vercel.app",
    ],
    // Configure simple, non-verified email/password to get started
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        const webhookSecret = process.env.AUTH_EMAIL_WEBHOOK_SECRET;
        if (!webhookSecret) {
          throw new Error("Password reset email service is not configured");
        }

        await fetch(`${siteUrl}/api/auth/send-password-reset`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-auth-email-secret": webhookSecret,
          },
          body: JSON.stringify({ user: { email: user.email }, url }),
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
    try {
      return await authComponent.getAuthUser(ctx);
    } catch {
      // Same race as post-login full navigation: session cookie exists but Convex JWT
      // is not wired yet — returning null lets clients retry instead of error boundary.
      return null;
    }
  },
});
