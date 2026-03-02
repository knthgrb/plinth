"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

const PIN_SALT_PREFIX = "payslip-pin-v1-";

function hashPin(employeeId: string, pin: string): string {
  const crypto = require("crypto");
  return crypto
    .createHash("sha256")
    .update(PIN_SALT_PREFIX + employeeId + "-" + pin)
    .digest("hex");
}

/** Set or change the payslip PIN for an employee. PIN is hashed in this action then stored via mutation. */
export const setPayslipPin = action({
  args: {
    employeeId: v.id("employees"),
    pin: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.pin || args.pin.length < 4) {
      throw new Error("PIN must be at least 4 characters");
    }
    const hashed = hashPin(args.employeeId, args.pin);
    await ctx.runMutation(api.employees.setPayslipPinHash, {
      employeeId: args.employeeId,
      hashedPin: hashed,
    });
    return { success: true };
  },
});

/** Verify the payslip PIN. Returns { valid: true } if correct. Uses query to get hash, compares in action. */
export const verifyPayslipPin = action({
  args: {
    employeeId: v.id("employees"),
    pin: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean }> => {
    const result = (await ctx.runQuery(
      api.employees.getPayslipPinHash,
      { employeeId: args.employeeId }
    )) as { hash: string | null };
    const stored = result.hash;
    if (!stored) {
      return { valid: true };
    }
    const hashed = hashPin(args.employeeId, args.pin);
    return { valid: hashed === stored };
  },
});
