import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { decryptPayslipRowFromDb } from "./payslipCrypto";

// Helper to check authorization - accounting, admin, and owner can access
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "accounting"
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

function isPayrollGeneratedCostItem(item: { name: string }) {
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

function getPayrollAccountingSourceKey(payrollRun: any, type: string) {
  return `${payrollRun._id}:${type}`;
}

function getDeductionAmountByNames(
  deductions: any[],
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

function getPayrollPeriodFromCostItemName(name: string): string | null {
  const prefixes = [
    "Payroll - ",
    "SSS - ",
    "Pag-IBIG - ",
    "PhilHealth - ",
    "Tax Employee Deductions - ",
  ];

  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) {
      return name.slice(prefix.length);
    }
  }

  return null;
}

function formatPayrollAccountingPeriod(payrollRun: any) {
  const startDate = new Date(payrollRun.cutoffStart);
  const endDate = new Date(payrollRun.cutoffEnd);
  return `${startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

async function getPayrollPayslipsWithNames(ctx: any, payrollRun: any) {
  const payslipsRaw = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) =>
      q.eq("payrollRunId", payrollRun._id),
    )
    .collect();
  const payslips = payslipsRaw.map((p: any) => decryptPayslipRowFromDb(p)!);

  const employees = await Promise.all(
    payslips.map((payslip: any) => ctx.db.get(payslip.employeeId)),
  );
  const employeeNameById = new Map<string, string>();
  employees.forEach((employee: any) => {
    if (!employee) return;
    employeeNameById.set(
      employee._id,
      `${employee.personalInfo?.firstName ?? ""} ${employee.personalInfo?.lastName ?? ""}`.trim(),
    );
  });

  return { payslips, employeeNameById };
}

async function buildExpectedPayrollAccountingItems(ctx: any, payrollRun: any) {
  const { payslips, employeeNameById } = await getPayrollPayslipsWithNames(
    ctx,
    payrollRun,
  );
  if (payslips.length === 0) return [];

  const payslipCount = payslips.length;
  const periodStr = formatPayrollAccountingPeriod(payrollRun);
  const baseNotes = `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`;
  const items: any[] = [];

  const totalNetPay = round2(
    payslips.reduce((sum: number, p: any) => sum + (p.netPay ?? 0), 0),
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
        rows: payslips.map((payslip: any) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          grossPay: payslip.grossPay ?? 0,
          nonTaxableAllowance: payslip.nonTaxableAllowance ?? 0,
          totalIncentives: (payslip.incentives ?? []).reduce(
            (sum: number, incentive: any) => sum + (incentive?.amount ?? 0),
            0,
          ),
          totalDeductions: (payslip.deductions ?? []).reduce(
            (sum: number, deduction: any) => sum + (deduction?.amount ?? 0),
            0,
          ),
          incentiveItems: (payslip.incentives ?? []).map((incentive: any) => ({
            name: incentive.name,
            amount: incentive.amount ?? 0,
            type: incentive.type,
          })),
          deductionItems: (payslip.deductions ?? []).map((deduction: any) => ({
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
    payslips.map((payslip: any) => ({
      employeeId: payslip.employeeId,
      employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
      employeeAmount: getDeductionAmountByNames(
        payslip.deductions ?? [],
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
        rows: payslips.map((payslip: any) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
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

async function getPayrollAccountingRuns(ctx: any, organizationId: any) {
  const runs = await (ctx.db.query("payrollRuns") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", organizationId))
    .collect();

  return runs.filter((run: any) =>
    ["finalized", "paid"].includes(run.status),
  );
}

async function syncExpectedPayrollAccountingItems(
  ctx: any,
  payrollRun: any,
) {
  const expectedItems = await buildExpectedPayrollAccountingItems(ctx, payrollRun);
  const now = Date.now();
  const existingItems = await (ctx.db.query("accountingCostItems") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", payrollRun.organizationId),
    )
    .collect();

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const activeSourceKeys = new Set(expectedItems.map((item) => item.sourceKey));
  const activeNames = new Set(expectedItems.map((item) => item.name));

  for (const expected of expectedItems) {
    const existing = existingItems.find(
      (item: any) =>
        item.sourceKey === expected.sourceKey ||
        (item.payrollRunId === payrollRun._id && item.name === expected.name) ||
        item.name === expected.name,
    );
    const amountPaid =
      payrollRun.status === "paid"
        ? expected.amount
        : Math.min(existing?.amountPaid ?? 0, expected.amount);
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
      status:
        payrollRun.status === "paid"
          ? ("paid" as const)
          : deriveAccountingCostItemStatus(expected.amount, amountPaid),
      dueDate: undefined,
      breakdown: expected.breakdown,
      notes: expected.notes,
      receipts: existing?.receipts,
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

  const staleItems = existingItems.filter((item: any) => {
    const belongsToRun =
      item.payrollRunId === payrollRun._id ||
      (item.sourceType === "payroll_run" &&
        String(item.sourceKey ?? "").startsWith(`${payrollRun._id}:`));
    return (
      belongsToRun &&
      isPayrollGeneratedCostItem(item) &&
      !activeSourceKeys.has(item.sourceKey) &&
      !activeNames.has(item.name)
    );
  });

  for (const item of staleItems) {
    await ctx.db.delete(item._id);
    deleted += 1;
  }

  return { created, updated, deleted };
}

async function getPayrollAccountingDriftRows(ctx: any, organizationId: any) {
  const payrollRuns = await getPayrollAccountingRuns(ctx, organizationId);
  const existingItems = await (ctx.db.query("accountingCostItems") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .collect();
  const rows: any[] = [];

  for (const run of payrollRuns) {
    const expectedItems = await buildExpectedPayrollAccountingItems(ctx, run);
    for (const expected of expectedItems) {
      const existing = existingItems.find(
        (item: any) =>
          item.sourceKey === expected.sourceKey ||
          (item.payrollRunId === run._id && item.name === expected.name) ||
          item.name === expected.name,
      );
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

/** Parse "Feb 10 - Feb 24, 2026" to { startDay, endDay } (days since epoch) for matching payroll run cutoff dates */
function parsePeriodToDayRange(periodStr: string): { startDay: number; endDay: number } | null {
  const parts = periodStr.split(" - ").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const endMatch = parts[1].match(/^(.+),\s*(\d{4})$/);
  const year = endMatch ? parseInt(endMatch[2], 10) : new Date().getFullYear();
  const startStr = `${parts[0]}, ${year}`;
  const endStr = endMatch ? `${endMatch[1]}, ${endMatch[2]}` : parts[1];
  const startDate = new Date(startStr);
  const endDate = new Date(endStr);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
  const dayMs = 86400000;
  return {
    startDay: Math.floor(startDate.getTime() / dayMs),
    endDay: Math.floor(endDate.getTime() / dayMs),
  };
}

async function resolvePayrollRunForCostItem(
  ctx: any,
  organizationId: any,
  item: any,
) {
  if (item?.payrollRunId) {
    const direct = await ctx.db.get(item.payrollRunId);
    if (direct && direct.organizationId === organizationId) {
      return direct;
    }
  }

  const period = getPayrollPeriodFromCostItemName(item.name);
  if (!period) return null;

  const runs = await (ctx.db.query("payrollRuns") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", organizationId))
    .collect();

  const exact = runs.find((run: any) => run.period === period);
  if (exact) return exact;

  const dayRange = parsePeriodToDayRange(period);
  if (!dayRange) return null;

  const dayMs = 86400000;
  return (
    runs.find((run: any) => {
      const startDay = Math.floor((run.cutoffStart ?? 0) / dayMs);
      const endDay = Math.floor((run.cutoffEnd ?? 0) / dayMs);
      return (
        startDay === dayRange.startDay &&
        endDay === dayRange.endDay
      );
    }) ?? null
  );
}

async function buildBreakdownForPayrollCostItem(
  ctx: any,
  organizationId: any,
  item: any,
) {
  const payrollRun = await resolvePayrollRunForCostItem(
    ctx,
    organizationId,
    item,
  );
  if (!payrollRun) return undefined;

  const payslipsRaw = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) => q.eq("payrollRunId", payrollRun._id))
    .collect();
  const payslips = payslipsRaw.map((p: any) => decryptPayslipRowFromDb(p)!);
  if (payslips.length === 0) return undefined;

  const employees = await Promise.all(
    payslips.map((payslip: any) => ctx.db.get(payslip.employeeId)),
  );
  const employeeNameById = new Map<string, string>();
  employees.forEach((employee: any) => {
    if (!employee) return;
    employeeNameById.set(
      employee._id,
      `${employee.personalInfo?.firstName ?? ""} ${employee.personalInfo?.lastName ?? ""}`.trim(),
    );
  });

  if (item.name.startsWith("Payroll - ")) {
    return {
      kind: "payroll" as const,
      rows: payslips.map((payslip: any) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        grossPay: payslip.grossPay ?? 0,
        nonTaxableAllowance: payslip.nonTaxableAllowance ?? 0,
        totalIncentives: (payslip.incentives ?? []).reduce(
          (sum: number, incentive: any) => sum + (incentive?.amount ?? 0),
          0,
        ),
        totalDeductions: (payslip.deductions ?? []).reduce(
          (sum: number, deduction: any) => sum + (deduction?.amount ?? 0),
          0,
        ),
        incentiveItems: (payslip.incentives ?? []).map((incentive: any) => ({
          name: incentive.name,
          amount: incentive.amount ?? 0,
          type: incentive.type,
        })),
        deductionItems: (payslip.deductions ?? []).map((deduction: any) => ({
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
      rows: payslips.map((payslip: any) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
          "sss",
        ]),
        companyAmount: payslip.employerContributions?.sss ?? 0,
      })),
    };
  }

  if (item.name.startsWith("Pag-IBIG - ")) {
    return {
      kind: "contributions" as const,
      rows: payslips.map((payslip: any) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
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
      rows: payslips.map((payslip: any) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
          "philhealth",
        ]),
        companyAmount: payslip.employerContributions?.philhealth ?? 0,
      })),
    };
  }

  if (item.name.startsWith("Tax Employee Deductions - ")) {
    return {
      kind: "contributions" as const,
      rows: payslips.map((payslip: any) => ({
        employeeId: payslip.employeeId,
        employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
        employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
          "withholding tax",
        ]),
        companyAmount: 0,
      })),
    };
  }

  return undefined;
}

async function buildAttachmentIdsForPayrollCostItem(
  ctx: any,
  organizationId: any,
  item: any,
) {
  const payrollRun = await resolvePayrollRunForCostItem(
    ctx,
    organizationId,
    item,
  );
  if (!payrollRun) return undefined;

  const payslipsRawAttach = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) => q.eq("payrollRunId", payrollRun._id))
    .collect();
  const payslips = payslipsRawAttach.map((p: any) => decryptPayslipRowFromDb(p)!);

  const attachmentIds = Array.from(
    new Set(
      payslips
        .map((payslip: any) => payslip.pdfFile)
        .filter((pdfFile: any) => Boolean(pdfFile)),
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
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();
    if (args.categoryName) {
      const filteredItems = items.filter(
        (item: any) => (item.categoryName ?? "Employee Related Cost") === args.categoryName
      );
      return await Promise.all(
        filteredItems.map(async (item: any) => ({
          ...item,
          receipts:
            item.receipts ??
            (await buildAttachmentIdsForPayrollCostItem(
              ctx,
              args.organizationId,
              item,
            )),
          breakdown:
            item.breakdown ??
            (await buildBreakdownForPayrollCostItem(
              ctx,
              args.organizationId,
              item,
            )),
        })),
      );
    }
    return await Promise.all(
      items.map(async (item: any) => ({
        ...item,
        receipts:
          item.receipts ??
          (await buildAttachmentIdsForPayrollCostItem(
            ctx,
            args.organizationId,
            item,
          )),
        breakdown:
          item.breakdown ??
          (await buildBreakdownForPayrollCostItem(ctx, args.organizationId, item)),
      })),
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
      (run: any) =>
        run &&
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
      v.literal("yearly")
    ),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("partial"),
        v.literal("paid"),
        v.literal("overdue")
      )
    ),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    receipts: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "accounting");
    const now = Date.now();
    const amountPaid = args.amountPaid || 0;
    if (amountPaid > args.amount) {
      throw new Error("Amount paid cannot be greater than the total amount.");
    }

    // Determine status if not provided
    let status = args.status;
    if (!status) {
      if (amountPaid === 0) {
        status = "pending";
      } else if (amountPaid >= args.amount) {
        status = "paid";
      } else {
        status = "partial";
      }
    }

    // Check if overdue
    if (args.dueDate && args.dueDate < now && status !== "paid") {
      status = "overdue";
    }

    return await ctx.db.insert("accountingCostItems", {
      organizationId: args.organizationId,
      sourceType: "manual",
      sourceKey: `manual:${now}`,
      sourceUpdatedAt: now,
      categoryName: args.categoryName,
      name: args.name,
      description: args.description,
      amount: args.amount,
      amountPaid: args.amountPaid || 0,
      frequency: args.frequency,
      status,
      dueDate: args.dueDate,
      notes: args.notes,
      receipts: args.receipts,
      createdAt: now,
      updatedAt: now,
    });
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
        v.literal("yearly")
      )
    ),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("partial"),
        v.literal("paid"),
        v.literal("overdue")
      )
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

    if (
      isPayrollGeneratedCostItem(item) &&
      args.amount !== undefined &&
      args.amount !== item.amount
    ) {
      throw new Error("Payroll-generated cost amounts cannot be edited.");
    }

    const nextAmount = args.amount !== undefined ? args.amount : item.amount;
    const nextAmountPaid =
      args.amountPaid !== undefined ? args.amountPaid : item.amountPaid;
    if (nextAmountPaid > nextAmount) {
      throw new Error("Amount paid cannot be greater than the total amount.");
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.amount !== undefined) updates.amount = args.amount;
    if (args.amountPaid !== undefined) updates.amountPaid = args.amountPaid;
    if (args.frequency !== undefined) updates.frequency = args.frequency;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.receipts !== undefined) updates.receipts = args.receipts;
    if (args.categoryName !== undefined) updates.categoryName = args.categoryName;

    // Auto-update status based on amountPaid if status not explicitly set
    if (args.status !== undefined) {
      updates.status = args.status;
    } else if (args.amountPaid !== undefined || args.amount !== undefined) {
      const amountPaid =
        args.amountPaid !== undefined ? args.amountPaid : item.amountPaid;
      const amount = args.amount !== undefined ? args.amount : item.amount;

      if (amountPaid === 0) {
        updates.status = "pending";
      } else if (amountPaid >= amount) {
        updates.status = "paid";
      } else {
        updates.status = "partial";
      }

      // Check if overdue
      const dueDate = args.dueDate !== undefined ? args.dueDate : item.dueDate;
      if (dueDate && dueDate < Date.now() && updates.status !== "paid") {
        updates.status = "overdue";
      }
    } else if (args.dueDate !== undefined) {
      // Check if overdue when dueDate changes
      const amountPaid = item.amountPaid;
      const amount = item.amount;
      const currentStatus = item.status;

      if (args.dueDate < Date.now() && currentStatus !== "paid") {
        if (amountPaid === 0) {
          updates.status = "overdue";
        } else if (amountPaid < amount) {
          updates.status = "overdue";
        }
      }
    }

    await ctx.db.patch(args.itemId, updates);

    // When the main payroll expense (net pay) is marked paid, set the linked payroll run to paid
    const finalStatus = updates.status ?? item.status;
    if (finalStatus === "paid" && item.name.startsWith("Payroll - ")) {
      const now = Date.now();
      let payrollRunIdToUpdate: string | null = null;

      if ((item as any).payrollRunId) {
        payrollRunIdToUpdate = (item as any).payrollRunId;
      } else {
        // Fallback for items created before payrollRunId: match by parsing period and comparing cutoff dates
        const periodStr = getPayrollPeriodFromCostItemName(item.name);
        if (periodStr) {
          const dayRange = parsePeriodToDayRange(periodStr);
          if (dayRange) {
            const payrollRuns = await (ctx.db.query("payrollRuns") as any)
              .withIndex("by_organization", (q: any) =>
                q.eq("organizationId", item.organizationId),
              )
              .collect();
            const dayMs = 86400000;
            const matched = payrollRuns.find((pr: any) => {
              const runStartDay = Math.floor((pr.cutoffStart ?? 0) / dayMs);
              const runEndDay = Math.floor((pr.cutoffEnd ?? 0) / dayMs);
              return runStartDay === dayRange.startDay && runEndDay === dayRange.endDay;
            });
            if (matched) payrollRunIdToUpdate = matched._id;
          }
        }
      }

      if (payrollRunIdToUpdate) {
        const run = await ctx.db.get(payrollRunIdToUpdate as any);
        if (run && (run as any).status !== "paid") {
          await ctx.db.patch(payrollRunIdToUpdate as any, {
            status: "paid",
            updatedAt: now,
          });
        }
      }
    }
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

    await ctx.db.delete(args.itemId);
  },
});
