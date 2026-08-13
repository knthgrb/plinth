import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

vi.mock("../../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader,
  ]),
);

const beginVerification = makeFunctionReference<
  "mutation",
  { employeeId: Id<"employees"> },
  { credential: string | null; locked: boolean }
>("payslipPinResetDb:beginPayslipPinVerification");

const storeCredential = makeFunctionReference<
  "mutation",
  { employeeId: Id<"employees">; credential: string },
  { success: boolean }
>("payslipPinResetDb:storePayslipPinCredential");

const consumeReset = makeFunctionReference<
  "mutation",
  { tokenHash: string; credential: string },
  { success: boolean }
>("payslipPinResetDb:consumeResetAndSetCredential");

const completeVerification = makeFunctionReference<
  "mutation",
  { employeeId: Id<"employees">; upgradedCredential?: string },
  { success: boolean }
>("payslipPinResetDb:completePayslipPinVerification");

const exposedCredentialQuery = makeFunctionReference<
  "query",
  { employeeId: Id<"employees"> },
  { hash: string | null }
>("employees:getPayslipPinHash");

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const defaultSchedule = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

async function createFixture(accessStatus: "active" | "alumni" = "active") {
  const t = convexTest(schema, modules);
  const email = "employee@example.com";
  const employeeId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Payroll organization",
      createdAt: 1,
      updatedAt: 1,
    });
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Employee",
        lastName: "One",
        email,
      },
      employment: {
        employeeId: "EMP-001",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: 1,
        status: accessStatus === "alumni" ? "resigned" : "active",
      },
      compensation: { basicSalary: 30_000, salaryType: "monthly" },
      schedule: { defaultSchedule },
      createdAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId,
      organizationId,
      employeeId,
      role: "employee",
      accessStatus,
      joinedAt: 1,
      updatedAt: 1,
    });
    return employeeId;
  });
  return { t, email, employeeId };
}

describe("payslip PIN access", () => {
  it("keeps the stored credential behind internal functions", async () => {
    const { t, email, employeeId } = await createFixture();
    const actor = t.withIdentity({ email });
    await actor.mutation(storeCredential, {
      employeeId,
      credential: "scrypt$v1$credential",
    });

    await expect(
      actor.query(exposedCredentialQuery, { employeeId }),
    ).rejects.toThrow(/no such export|there is no such export/i);
  });

  it("does not use the legacy user employee link for self authorization", async () => {
    const { t, email, employeeId } = await createFixture();
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (!user) throw new Error("User fixture was not found");
      const membership = await ctx.db
        .query("userOrganizations")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      if (!membership) throw new Error("Membership fixture was not found");
      await ctx.db.patch(membership._id, { employeeId: undefined });
    });

    await expect(
      t.withIdentity({ email }).mutation(beginVerification, { employeeId }),
    ).rejects.toThrow("Not authorized");
  });

  it("reads the normalized credential", async () => {
    const { t, email, employeeId } = await createFixture();
    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not found");
      await ctx.db.insert("payslipCredentials", {
        organizationId: employee.organizationId,
        employeeId,
        credentialHash: "normalized-hash",
        credentialVersion: 1,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      t.withIdentity({ email }).mutation(beginVerification, { employeeId }),
    ).resolves.toEqual({ credential: "normalized-hash", locked: false });
  });

  it("writes new and upgraded credentials only to the normalized row", async () => {
    const { t, email, employeeId } = await createFixture();
    const actor = t.withIdentity({ email });
    await actor.mutation(storeCredential, {
      employeeId,
      credential: "scrypt$v1$initial",
    });
    await actor.mutation(completeVerification, {
      employeeId,
      upgradedCredential: "scrypt$v1$upgraded",
    });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(employeeId),
      credentials: await ctx.db
        .query("payslipCredentials")
        .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
        .collect(),
    }));
    expect(state.employee).not.toHaveProperty("payslipPinHash");
    expect(state.credentials).toHaveLength(1);
    expect(state.credentials[0]?.credentialHash).toBe("scrypt$v1$upgraded");
  });

  it("locks the sixth verification attempt within the window", async () => {
    const { t, email, employeeId } = await createFixture();
    const actor = t.withIdentity({ email });
    await actor.mutation(storeCredential, {
      employeeId,
      credential: "scrypt$v1$credential",
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(actor.mutation(beginVerification, { employeeId })).resolves.toEqual({
        credential: "scrypt$v1$credential",
        locked: false,
      });
    }
    await expect(actor.mutation(beginVerification, { employeeId })).resolves.toEqual({
      credential: null,
      locked: true,
    });
  });

  it("atomically consumes a reset token while changing the credential", async () => {
    const { t, email, employeeId } = await createFixture();
    const tokenHash = "reset-token-hash";
    await t.run((ctx) =>
      ctx.db.insert("payslipPinResets", {
        employeeId,
        tokenHash,
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
    );

    const actor = t.withIdentity({ email });
    await expect(
      actor.mutation(consumeReset, {
        tokenHash,
        credential: "scrypt$v1$new-credential",
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      actor.mutation(consumeReset, {
        tokenHash,
        credential: "scrypt$v1$reused-credential",
      }),
    ).rejects.toThrow("Reset link is invalid or has expired");

    const employee = await t.run((ctx) => ctx.db.get(employeeId));
    expect(employee).not.toHaveProperty("payslipPinHash");
    const credentials = await t.run((ctx) =>
      ctx.db
        .query("payslipCredentials")
        .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
        .collect(),
    );
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.credentialHash).toBe(
      "scrypt$v1$new-credential",
    );
  });

  it("allows an alumni employee to verify their historical-payslip PIN", async () => {
    const { t, email, employeeId } = await createFixture("alumni");
    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not found");
      await ctx.db.insert("payslipCredentials", {
        organizationId: employee.organizationId,
        employeeId,
        credentialHash: "scrypt$v1$credential",
        credentialVersion: 1,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      t.withIdentity({ email }).mutation(beginVerification, { employeeId }),
    ).resolves.toEqual({ credential: "scrypt$v1$credential", locked: false });
  });

  it("blocks PIN access after the organization is archived", async () => {
    const { t, email, employeeId } = await createFixture("alumni");
    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not found");
      await ctx.db.patch(employee.organizationId, { status: "archived" });
    });

    await expect(
      t.withIdentity({ email }).mutation(beginVerification, { employeeId }),
    ).rejects.toThrow("Not authorized");
  });
});
