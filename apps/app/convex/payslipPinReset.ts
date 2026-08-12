"use node";

import { createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashPayslipPin, validateNewPayslipPin } from "./payslipPinCrypto";

const TOKEN_SALT_PREFIX = "payslip-pin-reset-v1-";
const RESET_TTL_MS = 60 * 60 * 1000;

const getResetEmployeeContext = makeFunctionReference<
  "query",
  { employeeId: Id<"employees"> },
  { employeeEmail: string; organizationId: Id<"organizations"> }
>("payslipPinResetDb:getPayslipPinResetContext");

const getAuthorizedReset = makeFunctionReference<
  "query",
  { tokenHash: string },
  { employeeId: Id<"employees"> }
>("payslipPinResetDb:getAuthorizedResetByTokenHash");

const consumeReset = makeFunctionReference<
  "mutation",
  { tokenHash: string; credential: string },
  { success: boolean }
>("payslipPinResetDb:consumeResetAndSetCredential");

function hashToken(token: string): string {
  return createHash("sha256")
    .update(TOKEN_SALT_PREFIX + token)
    .digest("hex");
}

export const createPayslipPinResetToken = action({
  args: { employeeId: v.id("employees") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    token: string;
    employeeEmail: string;
    organizationId: Id<"organizations">;
  }> => {
    const context = await ctx.runQuery(getResetEmployeeContext, {
      employeeId: args.employeeId,
    });
    const token = randomBytes(32).toString("base64url");
    await ctx.runMutation(internal.payslipPinResetDb.insertReset, {
      employeeId: args.employeeId,
      tokenHash: hashToken(token),
      expiresAt: Date.now() + RESET_TTL_MS,
    });
    return { token, ...context };
  },
});

export const resetPayslipPinWithToken = action({
  args: {
    token: v.string(),
    newPin: v.string(),
  },
  handler: async (ctx, args) => {
    const pin = validateNewPayslipPin(args.newPin);
    const tokenHash = hashToken(args.token);
    await ctx.runQuery(getAuthorizedReset, { tokenHash });
    const credential = await hashPayslipPin(pin);
    await ctx.runMutation(consumeReset, { tokenHash, credential });
    return { success: true };
  },
});
