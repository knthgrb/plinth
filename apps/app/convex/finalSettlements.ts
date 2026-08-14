import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import {
  buildFinalSettlementPayrollDeductions,
  computeFinalSettlementSummary,
  createDefaultFinalSettlementChecklist,
  createLoanPayoffsFromEmployeeDeductions,
  isFinalSettlementReadyForPayroll,
  type FinalSettlementCustomDeduction,
  type FinalSettlementLoanPayoff,
} from "@/utils/final-settlement";
import { loadEffectiveEmployee } from "./leaveEmployeeCompatibility";
import { prepareEmployeeLeaveForFinalSettlement } from "./leaveConversions";

const clearanceStatusValidator = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("waived"),
);

const loanPayoffRuleValidator = v.union(
  v.literal("deduct_full_balance"),
  v.literal("deduct_scheduled_amount"),
  v.literal("waive"),
  v.literal("custom_amount"),
);

const lineStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("waived"),
);

const customDeductionTypeValidator = v.union(
  v.literal("loan"),
  v.literal("company_property"),
  v.literal("cash_advance"),
  v.literal("training_bond"),
  v.literal("other"),
);

async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;
  if (!["owner", "admin", "hr", "accounting"].includes(userRole || "")) {
    throw new Error("Not authorized");
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus ?? "active",
  };
}

async function getSettlementForWrite(ctx: any, settlementId: any) {
  const settlement = await ctx.db.get(settlementId);
  if (!settlement) throw new Error("Final settlement not found");
  const userRecord = await checkAuth(ctx, settlement.organizationId);
  return { settlement, userRecord };
}

async function findSettlementByEmployee(ctx: any, employeeId: any) {
  return await (ctx.db.query("finalSettlements") as any)
    .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
    .first();
}

function employeeDisplayName(employee: any): string {
  return [employee?.personalInfo?.firstName, employee?.personalInfo?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function isSeparatedEmployee(employee: any): boolean {
  const status = employee?.employment?.status;
  return status === "resigned" || status === "terminated";
}

function nextLineId(prefix: string, now: number, existingLength: number): string {
  return `${prefix}-${now}-${existingLength + 1}`;
}

function normalizeLoanPayoff(
  input: {
    id?: string;
    deductionId?: string;
    name: string;
    scheduledAmount?: number;
    payoffAmount: number;
    rule: FinalSettlementLoanPayoff["rule"];
    status: FinalSettlementLoanPayoff["status"];
    notes?: string;
  },
  fallbackId: string,
): FinalSettlementLoanPayoff {
  return {
    id: input.id || fallbackId,
    deductionId: input.deductionId,
    name: input.name.trim(),
    scheduledAmount:
      typeof input.scheduledAmount === "number"
        ? Math.max(0, Math.round(input.scheduledAmount * 100) / 100)
        : undefined,
    payoffAmount: Math.max(0, Math.round(input.payoffAmount * 100) / 100),
    rule: input.rule,
    status: input.status,
    notes: input.notes?.trim() || undefined,
  };
}

function normalizeCustomDeduction(
  input: {
    id?: string;
    name: string;
    amount: number;
    type: FinalSettlementCustomDeduction["type"];
    taxable?: boolean;
    notes?: string;
  },
  fallbackId: string,
): FinalSettlementCustomDeduction {
  return {
    id: input.id || fallbackId,
    name: input.name.trim(),
    amount: Math.max(0, Math.round(input.amount * 100) / 100),
    type: input.type,
    taxable: input.taxable,
    notes: input.notes?.trim() || undefined,
  };
}

async function enrichSettlement(ctx: any, settlement: any) {
  const employeeRow = await ctx.db.get(settlement.employeeId);
  const employee = employeeRow
    ? await loadEffectiveEmployee(ctx, employeeRow)
    : null;
  const payrollRun = settlement.payrollRunId
    ? await ctx.db.get(settlement.payrollRunId)
    : null;
  const payslip = settlement.payslipId ? await ctx.db.get(settlement.payslipId) : null;

  return {
    ...settlement,
    employee,
    employeeName: employeeDisplayName(employee),
    payrollRun,
    payslip,
    payrollDeductions: buildFinalSettlementPayrollDeductions(settlement),
    summary: computeFinalSettlementSummary(settlement),
  };
}

export const getFinalSettlements = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);

    const settlements = await (ctx.db.query("finalSettlements") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const enrichedSettlements = await Promise.all(
      settlements.map((settlement: any) => enrichSettlement(ctx, settlement)),
    );

    const employeeRows = await (ctx.db.query("employees") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const employees = await Promise.all(
      employeeRows.map((employee: Doc<"employees">) =>
        loadEffectiveEmployee(ctx, employee),
      ),
    );
    const settlementEmployeeIds = new Set(
      settlements.map((settlement: any) => String(settlement.employeeId)),
    );
    const separatedEmployees = employees
      .filter(
        (employee: any) =>
          isSeparatedEmployee(employee) &&
          !settlementEmployeeIds.has(String(employee._id)),
      )
      .map((employee: any) => ({
        _id: employee._id,
        personalInfo: employee.personalInfo,
        employment: employee.employment,
        loanDeductions: (employee.deductions ?? []).filter(
          (deduction: any) => deduction.type === "loan" && deduction.isActive,
        ),
      }));

    enrichedSettlements.sort(
      (a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
    separatedEmployees.sort((a: any, b: any) =>
      employeeDisplayName(a).localeCompare(employeeDisplayName(b)),
    );

    return {
      settlements: enrichedSettlements,
      separatedEmployees,
    };
  },
});

export const prepareFinalSettlement = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    const employeeRow = await ctx.db.get(args.employeeId);
    if (!employeeRow || employeeRow.organizationId !== args.organizationId) {
      throw new Error("Employee not found");
    }
    const employee = await loadEffectiveEmployee(ctx, employeeRow);
    if (!isSeparatedEmployee(employee)) {
      throw new Error("Final settlement can only be prepared for resigned or terminated employees");
    }

    const existing = await findSettlementByEmployee(ctx, args.employeeId);
    if (existing) {
      await prepareEmployeeLeaveForFinalSettlement(ctx, {
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        separationDate:
          employee.employment.separationDate ??
          employee.employment.lastWorkingDay ??
          Date.now(),
        actorId: userRecord._id,
      });
      return existing._id;
    }

    const now = Date.now();
    const separationType =
      employee.employment.status === "terminated" ? "terminated" : "resigned";
    const clearanceItems = createDefaultFinalSettlementChecklist(now).map(
      (item) => ({
        id: item.id,
        label: item.label,
        ownerRole: item.ownerRole,
        required: item.required,
        status: item.status,
        notes: item.notes,
      }),
    );
    const settlementId = await ctx.db.insert("finalSettlements", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      status: "in_review",
      separationType,
      separationDate: employee.employment.separationDate,
      lastWorkingDay: employee.employment.lastWorkingDay,
      separationReason: employee.employment.separationReason,
      clearanceItems,
      loanPayoffs: createLoanPayoffsFromEmployeeDeductions(employee.deductions),
      customDeductions: [],
      bir2316: {
        status: "not_started",
      },
      finalTaxRelease: {
        status: "pending",
      },
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.employeeId, {
      employment: {
        ...employee.employment,
        finalPayStatus: employee.employment.finalPayStatus ?? "pending",
        clearanceStatus: employee.employment.clearanceStatus ?? "pending",
      },
      updatedAt: now,
    });

    await prepareEmployeeLeaveForFinalSettlement(ctx, {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      separationDate:
        employee.employment.separationDate ??
        employee.employment.lastWorkingDay ??
        now,
      actorId: userRecord._id,
    });

    return settlementId;
  },
});

export const updateClearanceItem = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    itemId: v.string(),
    status: clearanceStatusValidator,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { settlement, userRecord } = await getSettlementForWrite(
      ctx,
      args.settlementId,
    );
    const now = Date.now();
    const clearanceItems = settlement.clearanceItems.map((item: any) => {
      if (item.id !== args.itemId) return item;
      return {
        ...item,
        status: args.status,
        notes: args.notes?.trim() || item.notes,
        completedBy: args.status === "completed" ? userRecord._id : undefined,
        completedAt: args.status === "completed" ? now : undefined,
        waivedBy: args.status === "waived" ? userRecord._id : undefined,
        waivedAt: args.status === "waived" ? now : undefined,
      };
    });
    if (
      JSON.stringify(clearanceItems) === JSON.stringify(settlement.clearanceItems)
    ) {
      throw new Error("Clearance item not found");
    }

    const required = clearanceItems.filter((item: any) => item.required);
    const allResolved = required.every(
      (item: any) => item.status === "completed" || item.status === "waived",
    );
    const hasWaived = required.some((item: any) => item.status === "waived");

    await ctx.db.patch(args.settlementId, {
      clearanceItems,
      updatedAt: now,
    });

    const employee = (await ctx.db.get(settlement.employeeId)) as any;
    if (employee && allResolved) {
      await ctx.db.patch(settlement.employeeId, {
        employment: {
          ...employee.employment,
          clearanceStatus: hasWaived ? "waived" : "cleared",
        },
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

export const upsertLoanPayoff = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    loanPayoff: v.object({
      id: v.optional(v.string()),
      deductionId: v.optional(v.string()),
      name: v.string(),
      scheduledAmount: v.optional(v.number()),
      payoffAmount: v.number(),
      rule: loanPayoffRuleValidator,
      status: lineStatusValidator,
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { settlement } = await getSettlementForWrite(ctx, args.settlementId);
    const now = Date.now();
    const fallbackId = nextLineId("loan", now, settlement.loanPayoffs.length);
    const nextLine = normalizeLoanPayoff(args.loanPayoff, fallbackId);
    if (!nextLine.name) throw new Error("Loan payoff name is required");

    const existingIndex = settlement.loanPayoffs.findIndex(
      (line: any) => line.id === nextLine.id,
    );
    const loanPayoffs =
      existingIndex >= 0
        ? settlement.loanPayoffs.map((line: any, index: number) =>
            index === existingIndex ? nextLine : line,
          )
        : [...settlement.loanPayoffs, nextLine];

    await ctx.db.patch(args.settlementId, {
      loanPayoffs,
      updatedAt: now,
    });

    return { success: true };
  },
});

export const removeLoanPayoff = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    loanPayoffId: v.string(),
  },
  handler: async (ctx, args) => {
    const { settlement } = await getSettlementForWrite(ctx, args.settlementId);
    await ctx.db.patch(args.settlementId, {
      loanPayoffs: settlement.loanPayoffs.filter(
        (line: any) => line.id !== args.loanPayoffId,
      ),
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const upsertCustomDeduction = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    deduction: v.object({
      id: v.optional(v.string()),
      name: v.string(),
      amount: v.number(),
      type: customDeductionTypeValidator,
      taxable: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { settlement } = await getSettlementForWrite(ctx, args.settlementId);
    const now = Date.now();
    const fallbackId = nextLineId(
      "deduction",
      now,
      settlement.customDeductions.length,
    );
    const nextLine = normalizeCustomDeduction(args.deduction, fallbackId);
    if (!nextLine.name) throw new Error("Custom deduction name is required");

    const existingIndex = settlement.customDeductions.findIndex(
      (line: any) => line.id === nextLine.id,
    );
    const customDeductions =
      existingIndex >= 0
        ? settlement.customDeductions.map((line: any, index: number) =>
            index === existingIndex ? nextLine : line,
          )
        : [...settlement.customDeductions, nextLine];

    await ctx.db.patch(args.settlementId, {
      customDeductions,
      updatedAt: now,
    });

    return { success: true };
  },
});

export const removeCustomDeduction = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    deductionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { settlement } = await getSettlementForWrite(ctx, args.settlementId);
    await ctx.db.patch(args.settlementId, {
      customDeductions: settlement.customDeductions.filter(
        (line: any) => line.id !== args.deductionId,
      ),
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const markFinalSettlementReadyForPayroll = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
  },
  handler: async (ctx, args) => {
    const { settlement } = await getSettlementForWrite(ctx, args.settlementId);
    const candidate = { ...settlement, status: "ready_for_payroll" as const };
    if (!isFinalSettlementReadyForPayroll(candidate)) {
      throw new Error(
        "Final settlement must resolve required clearance items and loan payoff rules before payroll.",
      );
    }

    await ctx.db.patch(args.settlementId, {
      status: "ready_for_payroll",
      updatedAt: Date.now(),
    });

    const employee = (await ctx.db.get(settlement.employeeId)) as any;
    if (employee) {
      await ctx.db.patch(settlement.employeeId, {
        employment: {
          ...employee.employment,
          finalPayStatus: "processing",
        },
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

export const markBir2316DataReady = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { settlement } = await getSettlementForWrite(ctx, args.settlementId);
    await ctx.db.patch(args.settlementId, {
      bir2316: {
        ...settlement.bir2316,
        status: "data_ready",
        notes: args.notes?.trim() || settlement.bir2316.notes,
      },
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const markBir2316Released = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    documentId: v.optional(v.id("documents")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { settlement, userRecord } = await getSettlementForWrite(
      ctx,
      args.settlementId,
    );
    await ctx.db.patch(args.settlementId, {
      bir2316: {
        ...settlement.bir2316,
        status: "released",
        documentId: args.documentId ?? settlement.bir2316.documentId,
        releasedAt: Date.now(),
        releasedBy: userRecord._id,
        notes: args.notes?.trim() || settlement.bir2316.notes,
      },
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const markFinalTaxReviewed = mutation({
  args: {
    settlementId: v.id("finalSettlements"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { settlement, userRecord } = await getSettlementForWrite(
      ctx,
      args.settlementId,
    );
    await ctx.db.patch(args.settlementId, {
      finalTaxRelease: {
        ...settlement.finalTaxRelease,
        status: "reviewed",
        reviewedBy: userRecord._id,
        reviewedAt: Date.now(),
        notes: args.notes?.trim() || settlement.finalTaxRelease.notes,
      },
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});
