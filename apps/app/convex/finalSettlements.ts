import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import {
  assertFinalSettlementEditable,
  assertFinalSettlementTransition,
  buildSeparationKey,
  buildFinalSettlementPayrollDeductions,
  computeFinalSettlementSummary,
  createDefaultFinalSettlementChecklist,
  createLoanPayoffsFromEmployeeDeductions,
  getLegacyFinalSettlementSeparationType,
  isFinalSettlementReadyForPayroll,
  resolveFinalSettlementSeparationType,
  validateFinalTaxReview,
  type FinalSettlementCustomDeduction,
  type FinalSettlementLoanPayoff,
  type FinalSettlementStatus,
} from "@/utils/final-settlement";
import {
  isEmployeeSeparated,
  normalizeSeparationType,
  type SeparationType,
} from "@/utils/employment-lifecycle";
import { loadEffectiveEmployee } from "./leaveEmployeeCompatibility";
import { prepareEmployeeLeaveForFinalSettlement } from "./leaveConversions";
import { decryptPayslipRowFromDb } from "./payslipCrypto";

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

async function getSettlementForWrite(
  ctx: MutationCtx,
  settlementId: Id<"finalSettlements">,
) {
  const settlement = await ctx.db.get(settlementId);
  if (!settlement) throw new Error("Final settlement not found");
  const userRecord = await checkAuth(ctx, settlement.organizationId);
  return { settlement, userRecord };
}

async function findSettlementBySeparation(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<"employees">,
  separationType: SeparationType,
  separationDate: number,
) {
  const separationKey = buildSeparationKey(
    String(employeeId),
    separationType,
    separationDate,
  );
  const indexed = await ctx.db
    .query("finalSettlements")
    .withIndex("by_employee_separation_key", (query) =>
      query.eq("employeeId", employeeId).eq("separationKey", separationKey),
    )
    .first();
  if (indexed) return indexed;

  const legacySeparationType =
    getLegacyFinalSettlementSeparationType(separationType);
  if (legacySeparationType) {
    const legacyIndexed = await ctx.db
      .query("finalSettlements")
      .withIndex("by_employee_separation_key", (query) =>
        query
          .eq("employeeId", employeeId)
          .eq(
            "separationKey",
            buildSeparationKey(
              String(employeeId),
              legacySeparationType,
              separationDate,
            ),
          ),
      )
      .first();
    if (legacyIndexed) return legacyIndexed;
  }

  const legacyRows = await ctx.db
    .query("finalSettlements")
    .withIndex("by_employee", (query) => query.eq("employeeId", employeeId))
    .collect();
  return (
    legacyRows.find((settlement) => {
      if (!settlement.separationType) return false;
      const date = settlement.lastWorkingDay ?? settlement.separationDate;
      return (
        date === separationDate &&
        normalizeSeparationType(settlement.separationType) === separationType
      );
    }) ?? null
  );
}

async function findSeparationEvent(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<"employees">,
  separationType: SeparationType,
  separationDate: number,
) {
  const events = await ctx.db
    .query("employeeLifecycleEvents")
    .withIndex("by_employee_effective_at", (query) =>
      query.eq("employeeId", employeeId).eq("effectiveAt", separationDate),
    )
    .collect();
  return (
    events.find((event) => {
      const eventSeparationType =
        event.type === "separated"
          ? normalizeSeparationType(event.separationType)
          : normalizeSeparationType(event.type);
      return eventSeparationType === separationType;
    }) ?? null
  );
}

function statusAfterSettlementEdit(
  status: FinalSettlementStatus,
): FinalSettlementStatus {
  return status === "ready_for_payroll" ? "in_review" : status;
}

function assertSettlementHasGeneratedPayroll(
  settlement: Doc<"finalSettlements">,
): number {
  if (
    settlement.status !== "payroll_generated" ||
    !settlement.payrollRunId ||
    !settlement.payslipId
  ) {
    throw new Error(
      "Generate the final-pay payroll draft before completing tax or BIR review.",
    );
  }
  return settlement.calculationVersion ?? 0;
}

function employeeDisplayName(employee: {
  personalInfo?: { firstName?: string; lastName?: string };
} | null): string {
  return [employee?.personalInfo?.firstName, employee?.personalInfo?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function isSeparatedEmployee(employee: {
  employment?: { status?: string };
}): boolean {
  return isEmployeeSeparated(employee.employment?.status);
}

function nextLineId(
  prefix: string,
  now: number,
  existingLength: number,
): string {
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

async function enrichSettlement(
  ctx: QueryCtx,
  settlement: Doc<"finalSettlements">,
) {
  const employeeRow = await ctx.db.get(settlement.employeeId);
  const employee = employeeRow
    ? await loadEffectiveEmployee(ctx, employeeRow)
    : null;
  const payrollRun = settlement.payrollRunId
    ? await ctx.db.get(settlement.payrollRunId)
    : null;
  const rawPayslip = settlement.payslipId
    ? await ctx.db.get(settlement.payslipId)
    : null;
  const payslip = decryptPayslipRowFromDb(rawPayslip);

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

    const settlements = await ctx.db
      .query("finalSettlements")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const enrichedSettlements = await Promise.all(
      settlements.map((settlement) => enrichSettlement(ctx, settlement)),
    );

    const employeeRows = await ctx.db
      .query("employees")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const employees = await Promise.all(
      employeeRows.map((employee: Doc<"employees">) =>
        loadEffectiveEmployee(ctx, employee),
      ),
    );
    const settlementKeys = new Set(
      settlements.flatMap((settlement: Doc<"finalSettlements">) => {
        if (settlement.separationKey) return [settlement.separationKey];
        const date = settlement.lastWorkingDay ?? settlement.separationDate;
        return settlement.separationType && typeof date === "number"
          ? [
              buildSeparationKey(
                String(settlement.employeeId),
                settlement.separationType,
                date,
              ),
            ]
          : [];
      }),
    );
    const separatedEmployees = employees
      .filter((employee) => {
        const separationDate =
          employee.employment.lastWorkingDay ??
          employee.employment.separationDate;
        if (!isSeparatedEmployee(employee) || separationDate === undefined) {
          return false;
        }
        return !settlementKeys.has(
          buildSeparationKey(
            String(employee._id),
            resolveFinalSettlementSeparationType(
              employee.employment.status,
              employee.employment.separationType,
            ),
            separationDate,
          ),
        );
      })
      .map((employee) => ({
        _id: employee._id,
        personalInfo: employee.personalInfo,
        employment: employee.employment,
        loanDeductions: (employee.deductions ?? []).filter(
          (deduction) => deduction.type === "loan" && deduction.isActive,
        ),
      }));

    enrichedSettlements.sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
    separatedEmployees.sort((a, b) =>
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
      throw new Error(
        "Final settlement can only be prepared for separated employees",
      );
    }

    const separationType = resolveFinalSettlementSeparationType(
      employee.employment.status,
      employee.employment.separationType,
    );
    const separationDate =
      employee.employment.lastWorkingDay ?? employee.employment.separationDate;
    if (typeof separationDate !== "number") {
      throw new Error(
        "A last working day or separation date is required before preparing final settlement.",
      );
    }
    const separationKey = buildSeparationKey(
      String(args.employeeId),
      separationType,
      separationDate,
    );
    const separationEvent = await findSeparationEvent(
      ctx,
      args.employeeId,
      separationType,
      separationDate,
    );
    const existing = await findSettlementBySeparation(
      ctx,
      args.employeeId,
      separationType,
      separationDate,
    );
    if (existing) {
      await prepareEmployeeLeaveForFinalSettlement(ctx, {
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        separationDate: separationDate,
        actorId: userRecord._id,
      });
      return existing._id;
    }

    const now = Date.now();
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
      separationEventId: separationEvent?._id,
      separationKey,
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
      calculationVersion: 0,
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
      separationDate: separationDate,
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
    assertFinalSettlementEditable(settlement.status);
    const now = Date.now();
    const clearanceItems = settlement.clearanceItems.map((item) => {
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
      JSON.stringify(clearanceItems) ===
      JSON.stringify(settlement.clearanceItems)
    ) {
      throw new Error("Clearance item not found");
    }

    const required = clearanceItems.filter((item) => item.required);
    const allResolved = required.every(
      (item) => item.status === "completed" || item.status === "waived",
    );
    const hasWaived = required.some((item) => item.status === "waived");

    await ctx.db.patch(args.settlementId, {
      clearanceItems,
      status: statusAfterSettlementEdit(settlement.status),
      updatedAt: now,
    });

    const employee = await ctx.db.get(settlement.employeeId);
    if (employee) {
      await ctx.db.patch(settlement.employeeId, {
        employment: {
          ...employee.employment,
          clearanceStatus: allResolved
            ? hasWaived
              ? "waived"
              : "cleared"
            : "pending",
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
    assertFinalSettlementEditable(settlement.status);
    const now = Date.now();
    const fallbackId = nextLineId("loan", now, settlement.loanPayoffs.length);
    const nextLine = normalizeLoanPayoff(args.loanPayoff, fallbackId);
    if (!nextLine.name) throw new Error("Loan payoff name is required");
    if (
      nextLine.status === "approved" &&
      nextLine.rule !== "waive" &&
      nextLine.payoffAmount <= 0
    ) {
      throw new Error(
        "Enter a verified positive loan payoff amount before approval.",
      );
    }

    const existingIndex = settlement.loanPayoffs.findIndex(
      (line) => line.id === nextLine.id,
    );
    const loanPayoffs =
      existingIndex >= 0
        ? settlement.loanPayoffs.map((line, index) =>
            index === existingIndex ? nextLine : line,
          )
        : [...settlement.loanPayoffs, nextLine];

    await ctx.db.patch(args.settlementId, {
      loanPayoffs,
      status: statusAfterSettlementEdit(settlement.status),
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
    assertFinalSettlementEditable(settlement.status);
    await ctx.db.patch(args.settlementId, {
      loanPayoffs: settlement.loanPayoffs.filter(
        (line) => line.id !== args.loanPayoffId,
      ),
      status: statusAfterSettlementEdit(settlement.status),
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
    assertFinalSettlementEditable(settlement.status);
    const now = Date.now();
    const fallbackId = nextLineId(
      "deduction",
      now,
      settlement.customDeductions.length,
    );
    const nextLine = normalizeCustomDeduction(args.deduction, fallbackId);
    if (!nextLine.name) throw new Error("Custom deduction name is required");

    const existingIndex = settlement.customDeductions.findIndex(
      (line) => line.id === nextLine.id,
    );
    const customDeductions =
      existingIndex >= 0
        ? settlement.customDeductions.map((line, index) =>
            index === existingIndex ? nextLine : line,
          )
        : [...settlement.customDeductions, nextLine];

    await ctx.db.patch(args.settlementId, {
      customDeductions,
      status: statusAfterSettlementEdit(settlement.status),
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
    assertFinalSettlementEditable(settlement.status);
    await ctx.db.patch(args.settlementId, {
      customDeductions: settlement.customDeductions.filter(
        (line) => line.id !== args.deductionId,
      ),
      status: statusAfterSettlementEdit(settlement.status),
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
    assertFinalSettlementTransition(settlement.status, "ready_for_payroll");
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

    const employee = await ctx.db.get(settlement.employeeId);
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
    const calculationVersion = assertSettlementHasGeneratedPayroll(settlement);
    await ctx.db.patch(args.settlementId, {
      bir2316: {
        ...settlement.bir2316,
        status: "data_ready",
        calculationVersion,
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
    if (
      settlement.status !== "payroll_generated" &&
      settlement.status !== "released"
    ) {
      throw new Error(
        "BIR 2316 can only be released after payroll generation.",
      );
    }
    if (
      settlement.bir2316.status !== "data_ready" &&
      settlement.bir2316.status !== "document_generated" &&
      settlement.bir2316.status !== "released"
    ) {
      throw new Error("Prepare BIR 2316 data before releasing the document.");
    }
    const documentId = args.documentId ?? settlement.bir2316.documentId;
    if (!documentId) {
      throw new Error("Attach the generated BIR 2316 document before release.");
    }
    await ctx.db.patch(args.settlementId, {
      bir2316: {
        ...settlement.bir2316,
        status: "released",
        documentId,
        calculationVersion: settlement.calculationVersion ?? 0,
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
    overrideReason: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { settlement, userRecord } = await getSettlementForWrite(
      ctx,
      args.settlementId,
    );
    const calculationVersion = assertSettlementHasGeneratedPayroll(settlement);
    if (!settlement.payslipId) {
      throw new Error(
        "Generate the final-pay payroll draft before reviewing tax.",
      );
    }
    const rawPayslip = await ctx.db.get(settlement.payslipId);
    const payslip = decryptPayslipRowFromDb(rawPayslip);
    if (!payslip)
      throw new Error("The linked final-pay payslip was not found.");
    const withholdingTax = (payslip.deductions ?? [])
      .filter((line: { name?: string }) =>
        (line.name ?? "").toLowerCase().includes("withholding tax"),
      )
      .reduce(
        (sum: number, line: { amount?: number }) =>
          sum + Number(line.amount ?? 0),
        0,
      );
    const withholdingTaxRefund = (payslip.incentives ?? [])
      .filter((line: { name?: string }) =>
        (line.name ?? "").toLowerCase().includes("withholding tax refund"),
      )
      .reduce(
        (sum: number, line: { amount?: number }) =>
          sum + Number(line.amount ?? 0),
        0,
      );
    const review = validateFinalTaxReview({
      calculatedAdjustment:
        settlement.finalTaxRelease.calculatedAdjustment ?? 0,
      appliedAdjustment: withholdingTax - withholdingTaxRefund,
      overrideReason: args.overrideReason,
    });
    await ctx.db.patch(args.settlementId, {
      finalTaxRelease: {
        ...settlement.finalTaxRelease,
        ...review,
        status: "reviewed",
        reviewedBy: userRecord._id,
        reviewedAt: Date.now(),
        calculationVersion,
        notes: args.notes?.trim() || settlement.finalTaxRelease.notes,
      },
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});
