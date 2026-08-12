"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  hashPayslipPin,
  isLegacyPayslipPinHash,
  validateNewPayslipPin,
  verifyPayslipPinHash,
} from "./payslipPinCrypto";

const storeCredential = makeFunctionReference<
  "mutation",
  { employeeId: Id<"employees">; credential: string },
  { success: boolean }
>("payslipPinResetDb:storePayslipPinCredential");

const beginVerification = makeFunctionReference<
  "mutation",
  { employeeId: Id<"employees"> },
  { credential: string | null; locked: boolean }
>("payslipPinResetDb:beginPayslipPinVerification");

const completeVerification = makeFunctionReference<
  "mutation",
  { employeeId: Id<"employees">; upgradedCredential?: string },
  { success: boolean }
>("payslipPinResetDb:completePayslipPinVerification");

export const setPayslipPin = action({
  args: {
    employeeId: v.id("employees"),
    pin: v.string(),
  },
  handler: async (ctx, args) => {
    const pin = validateNewPayslipPin(args.pin);
    const credential = await hashPayslipPin(pin);
    await ctx.runMutation(storeCredential, {
      employeeId: args.employeeId,
      credential,
    });
    return { success: true };
  },
});

export const verifyPayslipPin = action({
  args: {
    employeeId: v.id("employees"),
    pin: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean }> => {
    const verification = await ctx.runMutation(beginVerification, {
      employeeId: args.employeeId,
    });
    if (verification.locked) {
      throw new Error("Too many PIN attempts. Try again in 15 minutes.");
    }
    if (!verification.credential) {
      await ctx.runMutation(completeVerification, {
        employeeId: args.employeeId,
      });
      return { valid: true };
    }

    const valid = await verifyPayslipPinHash(
      args.pin,
      verification.credential,
      String(args.employeeId),
    );
    if (!valid) return { valid: false };

    const upgradedCredential = isLegacyPayslipPinHash(verification.credential)
      ? await hashPayslipPin(args.pin)
      : undefined;
    await ctx.runMutation(completeVerification, {
      employeeId: args.employeeId,
      upgradedCredential,
    });
    return { valid: true };
  },
});
