"use node";

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { api } from "./_generated/api";

const TOKEN_SALT_PREFIX = "payslip-pin-reset-v1-";
const PIN_SALT_PREFIX = "payslip-pin-v1-";
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256Hex(text: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(text).digest("hex");
}

function base64Url(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hashToken(token: string): string {
  return sha256Hex(TOKEN_SALT_PREFIX + token);
}

function hashPin(employeeId: string, pin: string): string {
  return sha256Hex(PIN_SALT_PREFIX + employeeId + "-" + pin);
}

const insertReset = internalMutation({
  args: {
    employeeId: v.id("employees"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("payslipPinResets", {
      employeeId: args.employeeId,
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
    return { success: true };
  },
});

const getResetByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const reset = await (ctx.db.query("payslipPinResets") as any)
      .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", args.tokenHash))
      .first();
    return reset ?? null;
  },
});

const markResetUsed = internalMutation({
  args: { resetId: v.id("payslipPinResets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resetId, { usedAt: Date.now() });
    return { success: true };
  },
});

/**
 * Create a short-lived PIN reset token for an employee, returning the raw token
 * so the caller (server action) can email it.
 */
export const createPayslipPinResetToken = action({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const employee = await ctx.runQuery(api.employees.getEmployee, {
      employeeId: args.employeeId,
    });
    if (!employee) throw new Error("Employee not found");

    // Enforce "same employee" by reusing employees.getPayslipPinHash authorization logic:
    // If the caller isn't authorized to see the hash, they also cannot create a reset token.
    await ctx.runQuery(api.employees.getPayslipPinHash, {
      employeeId: args.employeeId,
    });

    // Generate raw token (never stored), store only hash.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require("crypto");
    const token = base64Url(crypto.randomBytes(32));
    const tokenHash = hashToken(token);
    const expiresAt = Date.now() + RESET_TTL_MS;

    await ctx.runMutation(insertReset, {
      employeeId: args.employeeId,
      tokenHash,
      expiresAt,
    });

    return {
      token,
      employeeEmail: employee.personalInfo.email,
      organizationId: employee.organizationId,
    };
  },
});

export const resetPayslipPinWithToken = action({
  args: {
    token: v.string(),
    newPin: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmedPin = args.newPin.trim();
    if (trimmedPin.length < 4) throw new Error("PIN must be at least 4 characters");

    const tokenHash = hashToken(args.token);
    const reset = await ctx.runQuery(getResetByTokenHash, { tokenHash });
    if (!reset) throw new Error("Reset link is invalid or has expired");
    if (reset.usedAt) throw new Error("Reset link has already been used");
    if (Date.now() > reset.expiresAt) throw new Error("Reset link has expired");

    // Authorize caller for this employee (same employee or HR/admin/owner)
    await ctx.runQuery(api.employees.getPayslipPinHash, {
      employeeId: reset.employeeId,
    });

    const hashed = hashPin(String(reset.employeeId), trimmedPin);
    await ctx.runMutation(api.employees.setPayslipPinHash, {
      employeeId: reset.employeeId,
      hashedPin: hashed,
    });

    await ctx.runMutation(markResetUsed, { resetId: reset._id });
    return { success: true };
  },
});

