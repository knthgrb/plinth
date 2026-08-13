import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireUserRecord } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

async function authorizeEmployeePinAccess(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<"employees">,
  allowPrivileged: boolean,
) {
  const employee = await ctx.db.get(employeeId);
  if (!employee) throw new Error("Employee not found");
  const user = await requireUserRecord(ctx);
  const membership = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user_organization", (q) =>
      q
        .eq("userId", user._id)
        .eq("organizationId", employee.organizationId),
    )
    .unique();
  const organization = await ctx.db.get(employee.organizationId);
  if (!membership || !organization || organization.status === "archived") {
    throw new Error("Not authorized");
  }
  const accessStatus = membership.accessStatus ?? "active";
  const isSelf = membership.employeeId === employeeId;
  const selfCanAccess =
    isSelf && (accessStatus === "active" || accessStatus === "alumni");
  const privilegedCanAccess =
    allowPrivileged &&
    accessStatus === "active" &&
    ["owner", "admin", "hr"].includes(membership.role);
  if (!selfCanAccess && !privilegedCanAccess) {
    throw new Error("Not authorized");
  }
  return { employee, user };
}

async function getPayslipCredential(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<"employees">,
) {
  const credentials = await ctx.db
    .query("payslipCredentials")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .take(2);
  if (credentials.length > 1) {
    throw new Error("Payslip credential is not unique");
  }
  return credentials[0] ?? null;
}

export async function loadPayslipCredentialHash(
  ctx: QueryCtx | MutationCtx,
  employee: Doc<"employees">,
): Promise<string | null> {
  const credential = await getPayslipCredential(
    ctx,
    employee._id,
  );
  if (credential) {
    if (credential.organizationId !== employee.organizationId) {
      throw new Error("Payslip credential organization mismatch");
    }
    return credential.credentialHash;
  }
  return employee.payslipPinHash ?? null;
}

async function writePayslipCredential(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  credentialHash: string,
  now: number,
) {
  const employeeId = employee._id;
  const credential = await getPayslipCredential(ctx, employeeId);
  if (credential && credential.organizationId !== employee.organizationId) {
    throw new Error("Payslip credential organization mismatch");
  }
  if (credential) {
    await ctx.db.patch(credential._id, {
      credentialHash,
      credentialVersion: 1,
      migrationVersion: 1,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("payslipCredentials", {
      organizationId: employee.organizationId,
      employeeId,
      credentialHash,
      credentialVersion: 1,
      migrationVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(employeeId, {
    payslipPinHash: credentialHash,
    updatedAt: now,
  });
}

export const storePayslipPinCredential = internalMutation({
  args: {
    employeeId: v.id("employees"),
    credential: v.string(),
  },
  handler: async (ctx, args) => {
    const { employee, user } = await authorizeEmployeePinAccess(
      ctx,
      args.employeeId,
      false,
    );
    await writePayslipCredential(ctx, employee, args.credential, Date.now());
    const attempt = await ctx.db
      .query("payslipPinAttempts")
      .withIndex("by_user_employee", (q) =>
        q.eq("userId", user._id).eq("employeeId", args.employeeId),
      )
      .unique();
    if (attempt) await ctx.db.delete(attempt._id);
    return { success: true };
  },
});

export const beginPayslipPinVerification = internalMutation({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const { employee, user } = await authorizeEmployeePinAccess(
      ctx,
      args.employeeId,
      false,
    );
    const now = Date.now();
    const attempt = await ctx.db
      .query("payslipPinAttempts")
      .withIndex("by_user_employee", (q) =>
        q.eq("userId", user._id).eq("employeeId", args.employeeId),
      )
      .unique();

    if (attempt?.lockedUntil && attempt.lockedUntil > now) {
      return { credential: null, locked: true };
    }

    const windowExpired =
      !attempt || now - attempt.windowStartedAt >= ATTEMPT_WINDOW_MS;
    const attemptCount = windowExpired ? 1 : attempt.attemptCount + 1;
    if (attemptCount > MAX_ATTEMPTS) {
      if (attempt) {
        await ctx.db.patch(attempt._id, {
          lockedUntil: now + LOCK_DURATION_MS,
          updatedAt: now,
        });
      }
      return { credential: null, locked: true };
    }

    if (attempt) {
      await ctx.db.patch(attempt._id, {
        attemptCount,
        windowStartedAt: windowExpired ? now : attempt.windowStartedAt,
        lockedUntil: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("payslipPinAttempts", {
        userId: user._id,
        employeeId: args.employeeId,
        organizationId: employee.organizationId,
        attemptCount,
        windowStartedAt: now,
        updatedAt: now,
      });
    }

    return {
      credential: await loadPayslipCredentialHash(ctx, employee),
      locked: false,
    };
  },
});

export const completePayslipPinVerification = internalMutation({
  args: {
    employeeId: v.id("employees"),
    upgradedCredential: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { employee, user } = await authorizeEmployeePinAccess(
      ctx,
      args.employeeId,
      false,
    );
    if (args.upgradedCredential) {
      await writePayslipCredential(
        ctx,
        employee,
        args.upgradedCredential,
        Date.now(),
      );
    }
    const attempt = await ctx.db
      .query("payslipPinAttempts")
      .withIndex("by_user_employee", (q) =>
        q.eq("userId", user._id).eq("employeeId", args.employeeId),
      )
      .unique();
    if (attempt) await ctx.db.delete(attempt._id);
    return { success: true };
  },
});

export const insertReset = internalMutation({
  args: {
    employeeId: v.id("employees"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingResets = await ctx.db
      .query("payslipPinResets")
      .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
      .collect();
    for (const reset of existingResets) {
      if (!reset.usedAt) await ctx.db.patch(reset._id, { usedAt: now });
    }
    await ctx.db.insert("payslipPinResets", {
      employeeId: args.employeeId,
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
    return { success: true };
  },
});

export const getPayslipPinResetContext = internalQuery({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const { employee } = await authorizeEmployeePinAccess(
      ctx,
      args.employeeId,
      false,
    );
    return {
      employeeEmail: employee.personalInfo.email,
      organizationId: employee.organizationId,
    };
  },
});

export const getAuthorizedResetByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const reset = await ctx.db
      .query("payslipPinResets")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!reset || reset.usedAt || reset.expiresAt <= Date.now()) {
      throw new Error("Reset link is invalid or has expired");
    }
    await authorizeEmployeePinAccess(ctx, reset.employeeId, false);
    return { employeeId: reset.employeeId };
  },
});

export const consumeResetAndSetCredential = internalMutation({
  args: {
    tokenHash: v.string(),
    credential: v.string(),
  },
  handler: async (ctx, args) => {
    const reset = await ctx.db
      .query("payslipPinResets")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!reset || reset.usedAt || reset.expiresAt <= Date.now()) {
      throw new Error("Reset link is invalid or has expired");
    }
    const { employee, user } = await authorizeEmployeePinAccess(
      ctx,
      reset.employeeId,
      false,
    );
    const now = Date.now();
    await writePayslipCredential(ctx, employee, args.credential, now);
    await ctx.db.patch(reset._id, { usedAt: now });
    const attempt = await ctx.db
      .query("payslipPinAttempts")
      .withIndex("by_user_employee", (q) =>
        q.eq("userId", user._id).eq("employeeId", reset.employeeId),
      )
      .unique();
    if (attempt) await ctx.db.delete(attempt._id);
    return { success: true };
  },
});
