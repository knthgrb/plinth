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
  decryptPayslipRowFromDb,
  type DecryptedPayslipDoc,
} from "./payslipCrypto";
import {
  loadEffectiveAccountingReceipts,
  replaceAccountingReceipts,
} from "./assetsPayrollCompatibility";
import {
  decryptAccountingCostBreakdown,
  encryptAccountingCostBreakdown,
  type AccountingCostBreakdown,
} from "./accountingCostItemCrypto";
import { formatManilaShortDate } from "@/lib/manila-date";

type AccountingDbCtx = QueryCtx | MutationCtx;
type PayrollRun = Doc<"payrollRuns">;
type AccountingCostItem = Doc<"accountingCostItems">;
type PayrollDeduction = {
  name?: string;
  amount?: number;
};
type ExpectedPayrollAccountingItem = {
  type: "payroll" | "sss" | "pagibig" | "philhealth" | "tax";
  sourceKey: string;
  name: string;
  description: string;
  amount: number;
  breakdown: AccountingCostBreakdown;
  notes: string;
};
type PayrollAccountingDriftRow = {
  payrollRunId: Id<"payrollRuns">;
  sourceKey: string;
  name: string;
  issue: "missing" | "out_of_sync";
  expectedAmount: number;
  actualAmount: number;
};
type AccountingCostItemStatus = "pending" | "partial" | "paid" | "overdue";

function decryptAccountingPayslip(
  payslip: Doc<"payslips">,
): DecryptedPayslipDoc {
  const decrypted = decryptPayslipRowFromDb(payslip);
  if (!decrypted) throw new Error("Payroll payslip is unavailable.");
  return decrypted;
}

// Helper to check authorization - accounting, admin, and owner can access
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "accounting",
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  // Allow accounting, admin, and owner
  const allowedRoles = ["owner", "admin", "accounting"];
  if (requiredRole && !allowedRoles.includes(userRole || "")) {
    throw new Error("Not authorized - accounting role required");
  }
  if (!requiredRole && !allowedRoles.includes(userRole || "")) {
    throw new Error("Not authorized - accounting role required");
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

function isPayrollGeneratedCostItem(
  item: Pick<
    Doc<"accountingCostItems">,
    "name" | "payrollRunId" | "sourceType"
  >,
) {
  if (item.sourceType === "payroll_run" || item.payrollRunId !== undefined) {
    return true;
  }
  return [
    "Payroll - ",
    "SSS - ",
    "Pag-IBIG - ",
    "PhilHealth - ",
    "Tax Employee Deductions - ",
  ].some((prefix) => item.name.startsWith(prefix));
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function deriveAccountingCostItemStatus(
  amount: number,
  amountPaid: number,
): "pending" | "partial" | "paid" {
  if (amountPaid <= 0) return "pending";
  if (amountPaid >= amount) return "paid";
  return "partial";
}

function assertValidAccountingAmount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative amount.`);
  }
}

function getPayrollAccountingSourceKey(
  payrollRun: Pick<PayrollRun, "_id">,
  type: string,
) {
  return `${payrollRun._id}:${type}`;
}

function getDeductionAmountByNames(
  deductions: PayrollDeduction[],
  names: string[],
): number {
  const normalizedNames = names.map((name) => name.toLowerCase());
  return deductions.reduce((sum, deduction) => {
    const deductionName = String(deduction?.name ?? "").toLowerCase();
    return normalizedNames.includes(deductionName)
      ? sum + (deduction?.amount ?? 0)
      : sum;
  }, 0);
}

function formatPayrollAccountingPeriod(payrollRun: PayrollRun) {
  return `${formatManilaShortDate(payrollRun.cutoffStart)} - ${formatManilaShortDate(payrollRun.cutoffEnd)}`;
}

async function getPayrollPayslipsWithNames(
  ctx: AccountingDbCtx,
  payrollRun: PayrollRun,
) {
  const payslipsRaw = await ctx.db
    .query("payslips")
    .withIndex("by_payroll_run", (query) =>
      query.eq("payrollRunId", payrollRun._id),
    )
    .collect();
  const payslips = payslipsRaw.map(decryptAccountingPayslip);

  const employees = await Promise.all(
    payslips.map((payslip) => ctx.db.get(payslip.employeeId)),
  );
  const employeeNameById = new Map<string, string>();
  employees.forEach((employee) => {
    if (!employee) return;
    employeeNameById.set(
      employee._id,
      `${employee.personalInfo?.firstName ?? ""} ${employee.personalInfo?.lastName ?? ""}`.trim(),
    );
  });

  return { payslips, employeeNameById };
}

async function buildExpectedPayrollAccountingItems(
  ctx: AccountingDbCtx,
  payrollRun: PayrollRun,
): Promise<ExpectedPayrollAccountingItem[]> {
  const { payslips, employeeNameById } = await getPayrollPayslipsWithNames(
    ctx,
    payrollRun,
  );
  if (payslips.length === 0) return [];

  const payslipCount = payslips.length;
  const periodStr = formatPayrollAccountingPeriod(payrollRun);
  const baseNotes = `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`;
  const items: ExpectedPayrollAccountingItem[] = [];

  const totalNetPay = round2(
    payslips.reduce((sum, payslip) => sum + payslip.netPay, 0),
  );

  if (totalNetPay > 0) {
    items.push({
      type: "payroll",
      sourceKey: getPayrollAccountingSourceKey(payrollRun, "payroll"),
      name: `Payroll - ${periodStr}`,
      description: `Total net pay for cutoff period ${payrollRun.period} (${payslipCount} payslip${payslipCount > 1 ? "s" : ""})`,
      amount: totalNetPay,
      breakdown: {
        kind: "payroll",
        rows: payslips.map((payslip) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          grossPay: payslip.grossPay ?? 0,
          nonTaxableAllowance: payslip.nonTaxableAllowance ?? 0,
          totalIncentives: (payslip.incentives ?? []).reduce(
            (sum, incentive) => sum + incentive.amount,
            0,
          ),
          totalDeductions: (payslip.deductions ?? []).reduce(
            (sum, deduction) => sum + deduction.amount,
            0,
          ),
          incentiveItems: (payslip.incentives ?? []).map((incentive) => ({
            name: incentive.name,
            amount: incentive.amount ?? 0,
            type: incentive.type,
          })),
          deductionItems: payslip.deductions.map((deduction) => ({
            name: deduction.name,
            amount: deduction.amount ?? 0,
            type: deduction.type,
          })),
          netPay: payslip.netPay ?? 0,
        })),
      },
      notes: `Auto-generated from payroll run ${payrollRun.period}. Payslips: ${payslipCount}, Total net pay: ₱${totalNetPay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    });
  }

  let totalEmployeeSSS = 0;
  let totalEmployeePagIbig = 0;
  let totalEmployeePhilHealth = 0;
  let totalEmployeeTax = 0;
  let totalSSSEmployer = 0;
  let totalPhilHealthEmployer = 0;
  let totalPagIbigEmployer = 0;

  for (const payslip of payslips) {
    for (const deduction of payslip.deductions ?? []) {
      const name = String(deduction.name ?? "").toLowerCase();
      const amount = deduction.amount ?? 0;
      if (name.includes("sss")) {
        totalEmployeeSSS += amount;
      } else if (name.includes("pag-ibig") || name.includes("pagibig")) {
        totalEmployeePagIbig += amount;
      } else if (name.includes("philhealth")) {
        totalEmployeePhilHealth += amount;
      } else if (name.includes("tax") || name.includes("withholding")) {
        totalEmployeeTax += amount;
      }
    }
    totalSSSEmployer += payslip.employerContributions?.sss ?? 0;
    totalPhilHealthEmployer += payslip.employerContributions?.philhealth ?? 0;
    totalPagIbigEmployer += payslip.employerContributions?.pagibig ?? 0;
  }

  const contributionRows = (
    employeeNames: string[],
    companyContribution: "sss" | "philhealth" | "pagibig",
  ) =>
    payslips.map((payslip) => ({
      employeeId: payslip.employeeId,
      employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
      employeeAmount: getDeductionAmountByNames(
        payslip.deductions,
        employeeNames,
      ),
      companyAmount: payslip.employerContributions?.[companyContribution] ?? 0,
    }));

  if (totalEmployeeSSS > 0 || totalSSSEmployer > 0) {
    items.push({
      type: "sss",
      sourceKey: getPayrollAccountingSourceKey(payrollRun, "sss"),
      name: `SSS - ${periodStr}`,
      description: `Total SSS for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: round2(totalEmployeeSSS + totalSSSEmployer),
      breakdown: {
        kind: "contributions",
        rows: contributionRows(["sss"], "sss"),
      },
      notes: baseNotes,
    });
  }

  if (totalEmployeePagIbig > 0 || totalPagIbigEmployer > 0) {
    items.push({
      type: "pagibig",
      sourceKey: getPayrollAccountingSourceKey(payrollRun, "pagibig"),
      name: `Pag-IBIG - ${periodStr}`,
      description: `Total Pag-IBIG for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: round2(totalEmployeePagIbig + totalPagIbigEmployer),
      breakdown: {
        kind: "contributions",
        rows: contributionRows(["pag-ibig", "pagibig"], "pagibig"),
      },
      notes: baseNotes,
    });
  }

  if (totalEmployeePhilHealth > 0 || totalPhilHealthEmployer > 0) {
    items.push({
      type: "philhealth",
      sourceKey: getPayrollAccountingSourceKey(payrollRun, "philhealth"),
      name: `PhilHealth - ${periodStr}`,
      description: `Total PhilHealth for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: round2(totalEmployeePhilHealth + totalPhilHealthEmployer),
      breakdown: {
        kind: "contributions",
        rows: contributionRows(["philhealth"], "philhealth"),
      },
      notes: baseNotes,
    });
  }

  if (totalEmployeeTax > 0) {
    items.push({
      type: "tax",
      sourceKey: getPayrollAccountingSourceKey(payrollRun, "tax"),
      name: `Tax Employee Deductions - ${periodStr}`,
      description: `Total Tax employee deductions for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: round2(totalEmployeeTax),
      breakdown: {
        kind: "contributions",
        rows: payslips.map((payslip) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          employeeAmount: getDeductionAmountByNames(payslip.deductions, [
            "withholding tax",
          ]),
          companyAmount: 0,
        })),
      },
      notes: baseNotes,
    });
  }

  return items;
}

async function getPayrollAccountingRuns(
  ctx: AccountingDbCtx,
  organizationId: Id<"organizations">,
): Promise<PayrollRun[]> {
  const [finalized, paid] = await Promise.all(
    (["finalized", "paid"] as const).map((status) =>
      ctx.db
        .query("payrollRuns")
        .withIndex("by_organization_status_run_type_cutoff_end", (query) =>
          query.eq("organizationId", organizationId).eq("status", status),
        )
        .collect(),
    ),
  );
  return [...finalized, ...paid];
}

async function syncExpectedPayrollAccountingItems(
  ctx: MutationCtx,
  payrollRun: PayrollRun,
) {
  const expectedItems = await buildExpectedPayrollAccountingItems(
    ctx,
    payrollRun,
  );
  const now = Date.now();
  const runItems = await ctx.db
    .query("accountingCostItems")
    .withIndex("by_payroll_run", (query) =>
      query.eq("payrollRunId", payrollRun._id),
    )
    .collect();

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const activeSourceKeys = new Set(expectedItems.map((item) => item.sourceKey));

  for (const expected of expectedItems) {
    const indexedExisting = await ctx.db
      .query("accountingCostItems")
      .withIndex("by_source", (query) =>
        query
          .eq("organizationId", payrollRun.organizationId)
          .eq("sourceType", "payroll_run")
          .eq("sourceKey", expected.sourceKey),
      )
      .unique();
    const existing =
      indexedExisting ?? runItems.find((item) => item.name === expected.name);
    const employeePayrollWasPaid =
      payrollRun.status === "paid" && expected.type === "payroll";
    const existingProjectionRecordedAfterPayment = Boolean(
      existing &&
      payrollRun.paidAt &&
      (existing.sourceUpdatedAt ?? existing.updatedAt) >= payrollRun.paidAt,
    );
    const amountPaid = employeePayrollWasPaid
      ? existingProjectionRecordedAfterPayment
        ? (existing?.amountPaid ?? expected.amount)
        : expected.amount
      : (existing?.amountPaid ?? 0);
    const payload = {
      organizationId: payrollRun.organizationId,
      payrollRunId: payrollRun._id,
      sourceType: "payroll_run" as const,
      sourceKey: expected.sourceKey,
      sourceUpdatedAt: now,
      categoryName: "Employee Related Cost",
      name: expected.name,
      description: expected.description,
      amount: expected.amount,
      amountPaid,
      frequency: "one-time" as const,
      status: deriveAccountingCostItemStatus(expected.amount, amountPaid),
      dueDate: undefined,
      breakdown: encryptAccountingCostBreakdown(expected.breakdown),
      notes: expected.notes,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      updated += 1;
      continue;
    }

    await ctx.db.insert("accountingCostItems", {
      ...payload,
      createdAt: now,
    });
    created += 1;
  }

  const staleItems = runItems.filter(
    (item) =>
      isPayrollGeneratedCostItem(item) &&
      item.sourceKey !== undefined &&
      !activeSourceKeys.has(item.sourceKey),
  );

  for (const item of staleItems) {
    if (item.amountPaid > 0) continue;
    await ctx.db.delete(item._id);
    deleted += 1;
  }

  return { created, updated, deleted };
}

async function getPayrollAccountingDriftRows(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
): Promise<PayrollAccountingDriftRow[]> {
  const payrollRuns = await getPayrollAccountingRuns(ctx, organizationId);
  const rows: PayrollAccountingDriftRow[] = [];

  for (const run of payrollRuns) {
    const runItems = await ctx.db
      .query("accountingCostItems")
      .withIndex("by_payroll_run", (query) => query.eq("payrollRunId", run._id))
      .collect();
    const expectedItems = await buildExpectedPayrollAccountingItems(ctx, run);
    for (const expected of expectedItems) {
      const indexedExisting = await ctx.db
        .query("accountingCostItems")
        .withIndex("by_source", (query) =>
          query
            .eq("organizationId", organizationId)
            .eq("sourceType", "payroll_run")
            .eq("sourceKey", expected.sourceKey),
        )
        .unique();
      const existing =
        indexedExisting ?? runItems.find((item) => item.name === expected.name);
      if (!existing) {
        rows.push({
          payrollRunId: run._id,
          sourceKey: expected.sourceKey,
          name: expected.name,
          issue: "missing",
          expectedAmount: expected.amount,
          actualAmount: 0,
        });
        continue;
      }

      if (
        existing.amount !== expected.amount ||
        existing.sourceType !== "payroll_run" ||
        existing.sourceKey !== expected.sourceKey
      ) {
        rows.push({
          payrollRunId: run._id,
          sourceKey: expected.sourceKey,
          name: expected.name,
          issue: "out_of_sync",
          expectedAmount: expected.amount,
          actualAmount: existing.amount,
        });
      }
    }
  }

  return rows;
}

async function resolvePayrollRunForCostItem(
  ctx: AccountingDbCtx,
  organizationId: Id<"organizations">,
  item: AccountingCostItem,
): Promise<PayrollRun | null> {
  if (item.payrollRunId) {
    const direct = await ctx.db.get(item.payrollRunId);
    if (direct && direct.organizationId === organizationId) {
      return direct;
    }
  }
  if (item.sourceType !== "payroll_run" || !item.sourceKey) return null;
  const sourceId = item.sourceKey.split(":", 1)[0];
  if (!sourceId) return null;
  const sourceRun = await ctx.db.get(sourceId as Id<"payrollRuns">);
  return sourceRun?.organizationId === organizationId ? sourceRun : null;
}

async function buildBreakdownForPayrollCostItem(
  ctx: AccountingDbCtx,
  organizationId: Id<"organizations">,
  item: AccountingCostItem,
): Promise<AccountingCostBreakdown | undefined> {
  const payrollRun = await resolvePayrollRunForCostItem(
    ctx,
    organizationId,
    item,
  );
  if (!payrollRun) return undefined;

  const payslipsRaw = await ctx.db
    .query("payslips")
    .withIndex("by_payroll_run", (query) =>
      query.eq("payrollRunId", payrollRun._id),
    )
    .collect();
  const payslips = payslipsRaw.map(decryptAccountingPayslip);
  if (payslips.length === 0) return undefined;

  const employees = await Promise.all(
    payslips.map((payslip) => ctx.db.get(payslip.employeeId)),
  );
  const employeeNameById = new Map<string, string>();
  employees.forEach((employee) => {
    if (!employee) return;
    employeeNameById.set(
      employee._id,
      `${employee.personalInfo?.firstName ?? ""} ${employee.personalInfo?.lastName ?? ""}`.trim(),
    );
  });

  if (item.name.startsWith("Payroll - ")) {
    return {
      kind: "payroll" as const,
      rows: payslips.map((payslip) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        grossPay: payslip.grossPay ?? 0,
        nonTaxableAllowance: payslip.nonTaxableAllowance ?? 0,
        totalIncentives: (payslip.incentives ?? []).reduce(
          (sum, incentive) => sum + incentive.amount,
          0,
        ),
        totalDeductions: (payslip.deductions ?? []).reduce(
          (sum, deduction) => sum + deduction.amount,
          0,
        ),
        incentiveItems: (payslip.incentives ?? []).map((incentive) => ({
          name: incentive.name,
          amount: incentive.amount ?? 0,
          type: incentive.type,
        })),
        deductionItems: payslip.deductions.map((deduction) => ({
          name: deduction.name,
          amount: deduction.amount ?? 0,
          type: deduction.type,
        })),
        netPay: payslip.netPay ?? 0,
      })),
    };
  }

  if (item.name.startsWith("SSS - ")) {
    return {
      kind: "contributions" as const,
      rows: payslips.map((payslip) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions, ["sss"]),
        companyAmount: payslip.employerContributions?.sss ?? 0,
      })),
    };
  }

  if (item.name.startsWith("Pag-IBIG - ")) {
    return {
      kind: "contributions" as const,
      rows: payslips.map((payslip) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions, [
          "pag-ibig",
          "pagibig",
        ]),
        companyAmount: payslip.employerContributions?.pagibig ?? 0,
      })),
    };
  }

  if (item.name.startsWith("PhilHealth - ")) {
    return {
      kind: "contributions" as const,
      rows: payslips.map((payslip) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions, [
          "philhealth",
        ]),
        companyAmount: payslip.employerContributions?.philhealth ?? 0,
      })),
    };
  }

  if (item.name.startsWith("Tax Employee Deductions - ")) {
    return {
      kind: "contributions" as const,
      rows: payslips.map((payslip) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions, [
          "withholding tax",
        ]),
        companyAmount: 0,
      })),
    };
  }

  return undefined;
}

async function buildAttachmentIdsForPayrollCostItem(
  ctx: AccountingDbCtx,
  organizationId: Id<"organizations">,
  item: AccountingCostItem,
): Promise<Id<"_storage">[] | undefined> {
  const payrollRun = await resolvePayrollRunForCostItem(
    ctx,
    organizationId,
    item,
  );
  if (!payrollRun) return undefined;

  const payslipsRawAttach = await ctx.db
    .query("payslips")
    .withIndex("by_payroll_run", (query) =>
      query.eq("payrollRunId", payrollRun._id),
    )
    .collect();
  const payslips = payslipsRawAttach.map(decryptAccountingPayslip);

  const attachmentIds = Array.from(
    new Set(
      payslips
        .map((payslip) => payslip.pdfFile)
        .filter((pdfFile): pdfFile is Id<"_storage"> => pdfFile !== undefined),
    ),
  );

  return attachmentIds.length > 0 ? attachmentIds : undefined;
}

// Get cost items for an organization (optional filter by categoryName)
export const getCostItems = query({
  args: {
    organizationId: v.id("organizations"),
    categoryName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Avoid server error when user/org not yet replicated after login or invite
    try {
      await checkAuth(ctx, args.organizationId);
    } catch {
      return [];
    }
    const items = await ctx.db
      .query("accountingCostItems")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .collect();
    if (args.categoryName) {
      const filteredItems = items.filter(
        (item) =>
          (item.categoryName ?? "Employee Related Cost") === args.categoryName,
      );
      return await Promise.all(
        filteredItems.map(async (item) => {
          const linkedReceipts = await loadEffectiveAccountingReceipts(
            ctx,
            item,
          );
          return {
            ...item,
            receipts:
              linkedReceipts.length > 0
                ? linkedReceipts
                : await buildAttachmentIdsForPayrollCostItem(
                    ctx,
                    args.organizationId,
                    item,
                  ),
            breakdown:
              decryptAccountingCostBreakdown(item.breakdown) ??
              (await buildBreakdownForPayrollCostItem(
                ctx,
                args.organizationId,
                item,
              )),
          };
        }),
      );
    }
    return await Promise.all(
      items.map(async (item) => {
        const linkedReceipts = await loadEffectiveAccountingReceipts(ctx, item);
        return {
          ...item,
          receipts:
            linkedReceipts.length > 0
              ? linkedReceipts
              : await buildAttachmentIdsForPayrollCostItem(
                  ctx,
                  args.organizationId,
                  item,
                ),
          breakdown:
            decryptAccountingCostBreakdown(item.breakdown) ??
            (await buildBreakdownForPayrollCostItem(
              ctx,
              args.organizationId,
              item,
            )),
        };
      }),
    );
  },
});

export const findPayrollAccountingDrift = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      await checkAuth(ctx, args.organizationId);
    } catch {
      return { driftCount: 0, rows: [] };
    }

    const rows = await getPayrollAccountingDriftRows(ctx, args.organizationId);
    return {
      driftCount: rows.length,
      rows,
    };
  },
});

export const repairPayrollAccounting = mutation({
  args: {
    organizationId: v.id("organizations"),
    payrollRunId: v.optional(v.id("payrollRuns")),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "accounting");

    const payrollRuns = args.payrollRunId
      ? [await ctx.db.get(args.payrollRunId)]
      : await getPayrollAccountingRuns(ctx, args.organizationId);
    const validRuns = payrollRuns.filter(
      (run): run is PayrollRun =>
        run !== null &&
        run.organizationId === args.organizationId &&
        ["finalized", "paid"].includes(run.status),
    );

    let created = 0;
    let updated = 0;
    let deleted = 0;

    for (const run of validRuns) {
      const result = await syncExpectedPayrollAccountingItems(ctx, run);
      created += result.created;
      updated += result.updated;
      deleted += result.deleted;
    }

    return {
      repairedRuns: validRuns.length,
      created,
      updated,
      deleted,
    };
  },
});

// Create cost item
export const createCostItem = mutation({
  args: {
    organizationId: v.id("organizations"),
    categoryName: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    amountPaid: v.optional(v.number()),
    frequency: v.union(
      v.literal("one-time"),
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("yearly"),
    ),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("partial"),
        v.literal("paid"),
        v.literal("overdue"),
      ),
    ),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    receipts: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "accounting");
    const now = Date.now();
    assertValidAccountingAmount(args.amount, "Amount");
    const amountPaid = args.amountPaid ?? 0;
    assertValidAccountingAmount(amountPaid, "Amount paid");
    if (amountPaid > args.amount) {
      throw new Error("Amount paid cannot be greater than the total amount.");
    }

    let status: AccountingCostItemStatus = deriveAccountingCostItemStatus(
      args.amount,
      amountPaid,
    );
    if (args.dueDate && args.dueDate < now && status !== "paid") {
      status = "overdue";
    }
    if (args.status !== undefined && args.status !== status) {
      throw new Error(
        `Status must be ${status} for the supplied amount and payment.`,
      );
    }

    const itemId = await ctx.db.insert("accountingCostItems", {
      organizationId: args.organizationId,
      sourceType: "manual",
      sourceKey: `manual:${now}`,
      sourceUpdatedAt: now,
      categoryName: args.categoryName,
      name: args.name,
      description: args.description,
      amount: args.amount,
      amountPaid,
      frequency: args.frequency,
      status,
      dueDate: args.dueDate,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
    const item = await ctx.db.get(itemId);
    if (!item) throw new Error("Cost item creation did not persist");
    await replaceAccountingReceipts(ctx, item, args.receipts ?? [], now);
    return itemId;
  },
});

// Update cost item
export const updateCostItem = mutation({
  args: {
    itemId: v.id("accountingCostItems"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    amount: v.optional(v.number()),
    amountPaid: v.optional(v.number()),
    frequency: v.optional(
      v.union(
        v.literal("one-time"),
        v.literal("daily"),
        v.literal("weekly"),
        v.literal("monthly"),
        v.literal("yearly"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("partial"),
        v.literal("paid"),
        v.literal("overdue"),
      ),
    ),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    receipts: v.optional(v.array(v.id("_storage"))),
    categoryName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Cost item not found");
    await checkAuth(ctx, item.organizationId, "accounting");

    if (isPayrollGeneratedCostItem(item)) {
      const attemptsGeneratedFieldEdit =
        args.name !== undefined ||
        args.amount !== undefined ||
        args.amountPaid !== undefined ||
        args.frequency !== undefined ||
        args.status !== undefined ||
        args.dueDate !== undefined ||
        args.categoryName !== undefined;
      if (attemptsGeneratedFieldEdit) {
        throw new Error(
          "Payroll-generated financial fields are read-only. Record payment, voiding, or corrections from the payroll run.",
        );
      }
    }

    const nextAmount = args.amount !== undefined ? args.amount : item.amount;
    const nextAmountPaid =
      args.amountPaid !== undefined ? args.amountPaid : item.amountPaid;
    assertValidAccountingAmount(nextAmount, "Amount");
    assertValidAccountingAmount(nextAmountPaid, "Amount paid");
    if (nextAmountPaid > nextAmount) {
      throw new Error("Amount paid cannot be greater than the total amount.");
    }

    const now = Date.now();
    const updates: Partial<Doc<"accountingCostItems">> = { updatedAt: now };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.amount !== undefined) updates.amount = args.amount;
    if (args.amountPaid !== undefined) updates.amountPaid = args.amountPaid;
    if (args.frequency !== undefined) updates.frequency = args.frequency;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.categoryName !== undefined)
      updates.categoryName = args.categoryName;

    if (
      args.status !== undefined ||
      args.amountPaid !== undefined ||
      args.amount !== undefined ||
      args.dueDate !== undefined
    ) {
      let derivedStatus: AccountingCostItemStatus =
        deriveAccountingCostItemStatus(nextAmount, nextAmountPaid);
      const nextDueDate = args.dueDate ?? item.dueDate;
      if (nextDueDate && nextDueDate < now && derivedStatus !== "paid") {
        derivedStatus = "overdue";
      }
      if (args.status !== undefined && args.status !== derivedStatus) {
        throw new Error(
          `Status must be ${derivedStatus} for the supplied amount and payment.`,
        );
      }
      updates.status = derivedStatus;
    }

    if (args.receipts !== undefined) {
      await replaceAccountingReceipts(ctx, item, args.receipts, now);
    }
    await ctx.db.patch(args.itemId, updates);
  },
});

// Delete cost item
export const deleteCostItem = mutation({
  args: {
    itemId: v.id("accountingCostItems"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Cost item not found");
    await checkAuth(ctx, item.organizationId, "accounting");

    if (isPayrollGeneratedCostItem(item)) {
      throw new Error("Payroll-generated cost records cannot be deleted.");
    }

    await replaceAccountingReceipts(ctx, item, [], Date.now());
    await ctx.db.delete(args.itemId);
  },
});
