import type { Id } from "./_generated/dataModel";
import { decryptEmployeeFromDb } from "./employeeCompensationCrypto";

export async function getUserIdsForLeaveApprovers(
  ctx: { db: any },
  organizationId: Id<"organizations">,
): Promise<Id<"users">[]> {
  const rows = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .collect();
  const approverRoles = new Set(["owner", "admin", "hr"]);
  const seen = new Set<string>();
  const out: Id<"users">[] = [];
  for (const r of rows) {
    if (!approverRoles.has((r as { role: string }).role)) continue;
    const uid = String((r as { userId: Id<"users"> }).userId);
    if (seen.has(uid)) continue;
    seen.add(uid);
    out.push((r as { userId: Id<"users"> }).userId);
  }
  return out;
}

/**
 * Login user for an employee record in this org. Must match
 * `findPlinthAccountEmailForEmployee` in payroll.ts: staff (admin/owner/hr) often
 * have `userOrganizations.employeeId` unset, so the index+filter on employeeId
 * alone misses them; we fall back to work-email + org membership (same as payslip emails).
 */
export async function getUserIdForEmployeeInOrg(
  ctx: { db: any },
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
): Promise<Id<"users"> | null> {
  const rows = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .filter((f: any) => f.eq(f.field("employeeId"), employeeId))
    .collect();
  const direct = (rows[0] as { userId?: Id<"users"> } | undefined)?.userId;
  if (direct) return direct;

  const employeeRaw = await ctx.db.get(employeeId);
  if (!employeeRaw) return null;
  const employee = decryptEmployeeFromDb(employeeRaw as any);
  const workEmail = String(employee.personalInfo?.email || "").trim();

  const tryEmails = new Set<string>();
  if (workEmail) {
    tryEmails.add(workEmail);
    tryEmails.add(workEmail.toLowerCase());
  }
  for (const em of tryEmails) {
    if (!em) continue;
    const user = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", em))
      .first();
    if (!user || (user as { isActive?: boolean }).isActive === false) continue;
    const uo = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", user._id).eq("organizationId", organizationId),
      )
      .first();
    if (!uo) continue;
    if (uo.employeeId != null && uo.employeeId !== employeeId) continue;
    return (user as { _id: Id<"users"> })._id;
  }

  return null;
}

export type InsertInAppNotificationArgs = {
  userId: Id<"users">;
  organizationId: Id<"organizations">;
  type: "leave_submitted" | "leave_approved" | "leave_rejected" | "payslip_ready";
  title: string;
  body?: string;
  pathAfterOrg: string;
  leaveRequestId?: Id<"leaveRequests">;
  payslipId?: Id<"payslips">;
  payrollRunId?: Id<"payrollRuns">;
};

export async function insertInAppNotification(
  ctx: { db: any },
  args: InsertInAppNotificationArgs,
) {
  const now = Date.now();
  return await ctx.db.insert("notifications", {
    userId: args.userId,
    organizationId: args.organizationId,
    type: args.type,
    title: args.title,
    body: args.body,
    read: false,
    createdAt: now,
    pathAfterOrg: args.pathAfterOrg,
    leaveRequestId: args.leaveRequestId,
    payslipId: args.payslipId,
    payrollRunId: args.payrollRunId,
  });
}
