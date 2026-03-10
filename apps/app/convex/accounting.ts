import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization - accounting, admin, and owner can access
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "accounting"
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");

  if (!organizationId) {
    throw new Error("Organization ID is required");
  }

  // Check user's role in the specific organization
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId)
    )
    .first();

  // Fallback to legacy organizationId/role fields for backward compatibility
  let userRole: string | undefined = userOrg?.role;
  const hasAccess =
    userOrg ||
    (userRecord.organizationId === organizationId && userRecord.role);

  if (!hasAccess) {
    throw new Error("User is not a member of this organization");
  }

  // Use legacy role if userOrg doesn't exist
  if (!userRole && userRecord.organizationId === organizationId) {
    userRole = userRecord.role;
  }

  // Allow accounting, admin, and owner
  const allowedRoles = ["owner", "admin", "accounting"];
  if (requiredRole && !allowedRoles.includes(userRole || "")) {
    throw new Error("Not authorized - accounting role required");
  }
  if (!requiredRole && !allowedRoles.includes(userRole || "")) {
    throw new Error("Not authorized - accounting role required");
  }

  return { ...userRecord, role: userRole, organizationId };
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

async function buildBreakdownForPayrollCostItem(
  ctx: any,
  organizationId: any,
  item: any,
) {
  const period = getPayrollPeriodFromCostItemName(item.name);
  if (!period) return undefined;

  const payrollRun = await (ctx.db.query("payrollRuns") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", organizationId))
    .collect()
    .then((runs: any[]) => runs.find((run) => run.period === period));
  if (!payrollRun) return undefined;

  const payslips = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) => q.eq("payrollRunId", payrollRun._id))
    .collect();
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
  const period = getPayrollPeriodFromCostItemName(item.name);
  if (!period) return undefined;

  const payrollRun = await (ctx.db.query("payrollRuns") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", organizationId))
    .collect()
    .then((runs: any[]) => runs.find((run) => run.period === period));
  if (!payrollRun) return undefined;

  const payslips = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) => q.eq("payrollRunId", payrollRun._id))
    .collect();

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
