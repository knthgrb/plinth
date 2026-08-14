import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireActiveMembership } from "./access";
import { requireSensitiveLeaveAccess } from "./leaveAccess";

const REVIEWER_ROLES = new Set<Doc<"userOrganizations">["role"]>([
  "owner",
  "admin",
  "hr",
]);

type ReconciliationStatus =
  Doc<"leaveBenefitPayrollReconciliations">["status"];

function assertAmount(name: string, amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${name} must be a non-negative amount`);
  }
}

function equalCurrency(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

export async function ensurePendingBenefitReconciliation(
  ctx: Pick<MutationCtx, "db">,
  request: Doc<"leaveRequests">,
  actorId: Id<"users">,
  now: number,
): Promise<void> {
  if (request.payTreatment !== "statutory_benefit_supported") return;
  const existing = await ctx.db
    .query("leaveBenefitPayrollReconciliations")
    .withIndex("by_request", (builder) =>
      builder.eq("leaveRequestId", request._id),
    )
    .unique();
  if (existing) return;
  await ctx.db.insert("leaveBenefitPayrollReconciliations", {
    organizationId: request.organizationId,
    employeeId: request.employeeId,
    leaveRequestId: request._id,
    expectedGrossBenefitAmount: 0,
    employerAdvanceAmount: 0,
    externalBenefitAmount: 0,
    salaryDifferentialAmount: 0,
    reimbursedAmount: 0,
    status: "pending",
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function syncBenefitReconciliationPayrollAllocation(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    leaveRequestId: Id<"leaveRequests">;
    payrollRunId: Id<"payrollRuns">;
    payslipId: Id<"payslips">;
    attributedPay: number;
    actorId: Id<"users">;
    now: number;
  },
): Promise<void> {
  let reconciliation = await ctx.db
    .query("leaveBenefitPayrollReconciliations")
    .withIndex("by_request", (builder) =>
      builder.eq("leaveRequestId", args.leaveRequestId),
    )
    .unique();
  if (!reconciliation) {
    const reconciliationId = await ctx.db.insert(
      "leaveBenefitPayrollReconciliations",
      {
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        leaveRequestId: args.leaveRequestId,
        expectedGrossBenefitAmount: 0,
        employerAdvanceAmount: 0,
        externalBenefitAmount: 0,
        salaryDifferentialAmount: 0,
        reimbursedAmount: 0,
        status: "pending",
        updatedBy: args.actorId,
        createdAt: args.now,
        updatedAt: args.now,
      },
    );
    reconciliation = await ctx.db.get(reconciliationId);
  }
  if (!reconciliation) throw new Error("Benefit reconciliation was not created");
  const existingAllocation = await ctx.db
    .query("leaveBenefitPayrollAllocations")
    .withIndex("by_request_payroll_run", (builder) =>
      builder
        .eq("leaveRequestId", args.leaveRequestId)
        .eq("payrollRunId", args.payrollRunId),
    )
    .unique();
  if (existingAllocation) {
    await ctx.db.patch(existingAllocation._id, {
      payslipId: args.payslipId,
      attributedPay: args.attributedPay,
      updatedAt: args.now,
    });
  } else {
    await ctx.db.insert("leaveBenefitPayrollAllocations", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      leaveRequestId: args.leaveRequestId,
      reconciliationId: reconciliation._id,
      payrollRunId: args.payrollRunId,
      payslipId: args.payslipId,
      attributedPay: args.attributedPay,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
  await recomputeExpectedBenefitAmount(
    ctx,
    reconciliation,
    args.actorId,
    args.now,
  );
}

async function recomputeExpectedBenefitAmount(
  ctx: Pick<MutationCtx, "db">,
  reconciliation: Doc<"leaveBenefitPayrollReconciliations">,
  actorId: Id<"users">,
  now: number,
): Promise<void> {
  const allocations = await ctx.db
    .query("leaveBenefitPayrollAllocations")
    .withIndex("by_reconciliation", (builder) =>
      builder.eq("reconciliationId", reconciliation._id),
    )
    .take(501);
  if (allocations.length > 500) {
    throw new Error("Benefit payroll allocation count exceeds the supported limit");
  }
  const expectedGrossBenefitAmount = allocations.reduce(
    (sum, allocation) => sum + allocation.attributedPay,
    0,
  );
  await ctx.db.patch(reconciliation._id, {
    expectedGrossBenefitAmount,
    status:
      reconciliation.status === "voided"
        ? "voided"
        : reconciliation.expectedGrossBenefitAmount ===
            expectedGrossBenefitAmount
          ? reconciliation.status
          : "pending",
    updatedBy: actorId,
    updatedAt: now,
  });
}

export async function removeBenefitReconciliationPayrollAllocationsForRun(
  ctx: Pick<MutationCtx, "db">,
  payrollRunId: Id<"payrollRuns">,
  actorId: Id<"users">,
  now: number,
): Promise<void> {
  const allocations = await ctx.db
    .query("leaveBenefitPayrollAllocations")
    .withIndex("by_payroll_run", (builder) =>
      builder.eq("payrollRunId", payrollRunId),
    )
    .take(1001);
  if (allocations.length > 1000) {
    throw new Error("Payroll benefit allocation count exceeds the supported limit");
  }
  const reconciliationIds = new Set(
    allocations.map((allocation) => allocation.reconciliationId),
  );
  for (const allocation of allocations) await ctx.db.delete(allocation._id);
  for (const reconciliationId of reconciliationIds) {
    const reconciliation = await ctx.db.get(reconciliationId);
    if (reconciliation) {
      await recomputeExpectedBenefitAmount(ctx, reconciliation, actorId, now);
    }
  }
}

export async function voidBenefitReconciliation(
  ctx: Pick<MutationCtx, "db">,
  leaveRequestId: Id<"leaveRequests">,
  actorId: Id<"users">,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("leaveBenefitPayrollReconciliations")
    .withIndex("by_request", (builder) => builder.eq("leaveRequestId", leaveRequestId))
    .unique();
  if (!existing) return;
  await ctx.db.patch(existing._id, {
    status: "voided",
    updatedBy: actorId,
    updatedAt: now,
  });
}

export function resolveBenefitReconciliationStatus(args: {
  employerAdvanceAmount: number;
  externalBenefitAmount: number;
  reimbursedAmount: number;
  waived: boolean;
}): ReconciliationStatus {
  if (args.waived) return "waived";
  if (args.employerAdvanceAmount === 0) return "pending";
  if (args.reimbursedAmount === 0) return "advanced";
  if (args.reimbursedAmount < args.externalBenefitAmount) {
    return "partially_reimbursed";
  }
  return "reconciled";
}

async function requireBenefitReviewer(
  ctx: Parameters<typeof requireActiveMembership>[0],
  organizationId: Id<"organizations">,
): Promise<Awaited<ReturnType<typeof requireActiveMembership>>> {
  const access = await requireActiveMembership(ctx, organizationId);
  if (!REVIEWER_ROLES.has(access.membership.role)) {
    throw new Error("Only Owner, Admin, or HR can manage benefit reconciliation");
  }
  return access;
}

export const saveBenefitReconciliation = mutation({
  args: {
    organizationId: v.id("organizations"),
    leaveRequestId: v.id("leaveRequests"),
    employerAdvanceAmount: v.number(),
    externalBenefitAmount: v.number(),
    salaryDifferentialAmount: v.number(),
    reimbursedAmount: v.number(),
    waived: v.optional(v.boolean()),
    referenceNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireBenefitReviewer(ctx, args.organizationId);
    const request = await ctx.db.get(args.leaveRequestId);
    if (
      !request ||
      request.organizationId !== args.organizationId ||
      request.payTreatment !== "statutory_benefit_supported" ||
      request.status !== "approved"
    ) {
      throw new Error("Approved benefit-supported leave request not found");
    }
    await requireSensitiveLeaveAccess(
      ctx,
      args.organizationId,
      request.employeeId,
    );

    assertAmount("Employer advance", args.employerAdvanceAmount);
    assertAmount("External benefit", args.externalBenefitAmount);
    assertAmount("Salary differential", args.salaryDifferentialAmount);
    assertAmount("Reimbursed amount", args.reimbursedAmount);
    if (
      !equalCurrency(
        args.employerAdvanceAmount,
        args.externalBenefitAmount + args.salaryDifferentialAmount,
      )
    ) {
      throw new Error(
        "Employer advance must equal the external benefit plus salary differential",
      );
    }
    if (args.reimbursedAmount > args.externalBenefitAmount) {
      throw new Error("Reimbursement cannot exceed the external benefit");
    }
    const existing = await ctx.db
      .query("leaveBenefitPayrollReconciliations")
      .withIndex("by_request", (builder) =>
        builder.eq("leaveRequestId", request._id),
      )
      .unique();
    if (!existing || existing.expectedGrossBenefitAmount <= 0) {
      throw new Error("Generate payroll before reconciling this benefit");
    }
    if (args.employerAdvanceAmount > existing.expectedGrossBenefitAmount) {
      throw new Error("Employer advance cannot exceed the expected gross benefit");
    }

    const status = resolveBenefitReconciliationStatus({
      employerAdvanceAmount: args.employerAdvanceAmount,
      externalBenefitAmount: args.externalBenefitAmount,
      reimbursedAmount: args.reimbursedAmount,
      waived: args.waived === true,
    });
    const now = Date.now();
    const values = {
      employerAdvanceAmount: args.employerAdvanceAmount,
      externalBenefitAmount: args.externalBenefitAmount,
      salaryDifferentialAmount: args.salaryDifferentialAmount,
      reimbursedAmount: args.reimbursedAmount,
      status,
      referenceNumber: args.referenceNumber?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      updatedBy: access.user._id,
      updatedAt: now,
    };
    await ctx.db.patch(existing._id, values);
    const reconciliationId = existing._id;
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: args.organizationId,
      type: "corrected",
      actorId: access.user._id,
      reason: "Statutory benefit payroll reconciliation updated",
      detailsJson: JSON.stringify({ reconciliationId, status }),
      createdAt: now,
    });
    return { reconciliationId, status };
  },
});

export const getBenefitReconciliationQueue = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("advanced"),
        v.literal("partially_reimbursed"),
        v.literal("reconciled"),
        v.literal("waived"),
        v.literal("voided"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const access = await requireBenefitReviewer(ctx, args.organizationId);
    const sensitiveGrant = await ctx.db
      .query("leaveSensitiveAccessGrants")
      .withIndex("by_membership_active", (builder) =>
        builder.eq("membershipId", access.membership._id).eq("isActive", true),
      )
      .filter((builder) =>
        builder.eq(builder.field("organizationId"), args.organizationId),
      )
      .first();
    if (!sensitiveGrant) {
      return { hasSensitiveAccess: false, rows: [] };
    }
    const activeStatuses = [
      "pending",
      "advanced",
      "partially_reimbursed",
      "reconciled",
      "waived",
    ] as const;
    const rows = args.status
      ? await ctx.db
          .query("leaveBenefitPayrollReconciliations")
          .withIndex("by_organization_status", (builder) =>
            builder
              .eq("organizationId", args.organizationId)
              .eq("status", args.status!),
          )
          .take(501)
      : (
          await Promise.all(
            activeStatuses.map((status) =>
              ctx.db
                .query("leaveBenefitPayrollReconciliations")
                .withIndex("by_organization_status", (builder) =>
                  builder
                    .eq("organizationId", args.organizationId)
                    .eq("status", status),
                )
                .take(501),
            ),
          )
        ).flat();
    if (rows.length > 500) {
      throw new Error("Benefit reconciliation queue exceeds the supported limit");
    }

    const visible = [];
    for (const row of rows) {
      const [employee, request] = await Promise.all([
        ctx.db.get(row.employeeId),
        ctx.db.get(row.leaveRequestId),
      ]);
      visible.push({
        ...row,
        employeeName: employee
          ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`
          : "Former employee",
        leaveStart: request?.startDate,
        leaveEnd: request?.endDate,
      });
    }
    return { hasSensitiveAccess: true, rows: visible };
  },
});
