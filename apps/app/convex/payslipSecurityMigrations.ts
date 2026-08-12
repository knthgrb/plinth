import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const clearLegacyPdfPasswords = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    dryRun: v.boolean(),
  },
  handler: async (ctx, args) => {
    const [employees, payslips] = await Promise.all([
      ctx.db
        .query("employees")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect(),
      ctx.db
        .query("payslips")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect(),
    ]);

    const employeesWithPassword = employees.filter(
      (employee) => typeof employee.payslipPdfPassword === "string",
    );
    const snapshotsWithPassword = payslips.filter((payslip) => {
      const snapshot = payslip.employeeSnapshot;
      return (
        snapshot !== null &&
        typeof snapshot === "object" &&
        typeof snapshot.payslipPdfPassword === "string"
      );
    });

    if (!args.dryRun) {
      const now = Date.now();
      for (const employee of employeesWithPassword) {
        await ctx.db.patch(employee._id, {
          payslipPdfPassword: undefined,
          updatedAt: now,
        });
      }
      for (const payslip of snapshotsWithPassword) {
        const snapshot = payslip.employeeSnapshot;
        if (!snapshot || typeof snapshot !== "object") continue;
        const employeeSnapshot = { ...snapshot };
        delete employeeSnapshot.payslipPdfPassword;
        await ctx.db.patch(payslip._id, { employeeSnapshot });
      }
    }

    return {
      employeeRows: employeesWithPassword.length,
      snapshotRows: snapshotsWithPassword.length,
      dryRun: args.dryRun,
    };
  },
});
