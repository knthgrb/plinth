import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import {
  appendOperationalEvent,
  verifyOperationalEventHash,
} from "../convex/operationalEvents";
import schema from "../convex/schema";

vi.mock("../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

async function seed(ctx: MutationCtx) {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Audit Event Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const userId = await ctx.db.insert("users", {
    email: "audit-owner@example.com",
    name: "Audit Owner",
    createdAt: 1,
    updatedAt: 1,
  });
  const membershipId = await ctx.db.insert("userOrganizations", {
    organizationId,
    userId,
    role: "owner",
    accessStatus: "active",
    joinedAt: 1,
    updatedAt: 1,
  });
  return { organizationId, userId, membershipId };
}

describe("operational event backbone", () => {
  it("records actor, time, aggregate, encrypted-ready payload, and a hash chain", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);

    const rows = await t.run(async (ctx) => {
      await appendOperationalEvent(ctx, {
        organizationId: fixture.organizationId,
        eventType: "employee.created",
        aggregateType: "employee",
        aggregateId: "employee-1",
        actor: {
          type: "user",
          userId: fixture.userId,
          membershipId: fixture.membershipId,
          role: "owner",
        },
        occurredAt: 100,
        changedFields: ["personalInfo", "employment"],
        payload: { employeeNumber: "EMP-001" },
        idempotencyKey: "employee-1:create",
      });
      await appendOperationalEvent(ctx, {
        organizationId: fixture.organizationId,
        eventType: "employee.details_changed",
        aggregateType: "employee",
        aggregateId: "employee-1",
        actor: {
          type: "user",
          userId: fixture.userId,
          membershipId: fixture.membershipId,
          role: "owner",
        },
        occurredAt: 200,
        changedFields: ["personalInfo.email"],
        payload: { reason: "Employee requested correction" },
      });
      return ctx.db
        .query("operationalEvents")
        .withIndex("by_organization_sequence", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .collect();
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      eventType: "employee.created",
      sequence: 1,
      aggregateId: "employee-1",
      actorUserId: fixture.userId,
      actorMembershipId: fixture.membershipId,
      actorRole: "owner",
      occurredAt: 100,
    });
    expect(rows[1].previousHash).toBe(rows[0].hash);
    expect(rows.every(verifyOperationalEventHash)).toBe(true);
  });

  it("enforces per-organization idempotency and keeps history after source deletion", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);

    await t.run(async (ctx) => {
      const employeeId = await ctx.db.insert("employees", {
        organizationId: fixture.organizationId,
        personalInfo: {
          firstName: "Delete",
          lastName: "Me",
          email: "delete@example.com",
        },
        employment: {
          employeeId: "DELETE-1",
          position: "Tester",
          department: "QA",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 1, salaryType: "monthly" },
        schedule: {
          defaultSchedule: {
            monday: { in: "09:00", out: "18:00", isWorkday: true },
            tuesday: { in: "09:00", out: "18:00", isWorkday: true },
            wednesday: { in: "09:00", out: "18:00", isWorkday: true },
            thursday: { in: "09:00", out: "18:00", isWorkday: true },
            friday: { in: "09:00", out: "18:00", isWorkday: true },
            saturday: { in: "09:00", out: "18:00", isWorkday: false },
            sunday: { in: "09:00", out: "18:00", isWorkday: false },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      });
      await appendOperationalEvent(ctx, {
        organizationId: fixture.organizationId,
        eventType: "employee.removed",
        aggregateType: "employee",
        aggregateId: String(employeeId),
        actor: { type: "user", userId: fixture.userId, role: "owner" },
        idempotencyKey: `employee:${employeeId}:removed`,
      });
      await ctx.db.delete(employeeId);
    });

    await expect(
      t.run((ctx) =>
        appendOperationalEvent(ctx, {
          organizationId: fixture.organizationId,
          eventType: "employee.removed",
          aggregateType: "employee",
          aggregateId: "another-id",
          actor: { type: "user", userId: fixture.userId, role: "owner" },
          idempotencyKey: "employee:000000000000000000000000:removed",
        }),
      ),
    ).resolves.toBeDefined();

    const event = await t.run((ctx) =>
      ctx.db
        .query("operationalEvents")
        .withIndex("by_organization_event_type", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("eventType", "employee.removed"),
        )
        .first(),
    );
    expect(event?.aggregateId).toBeDefined();

    await expect(
      t.run((ctx) =>
        appendOperationalEvent(ctx, {
          organizationId: fixture.organizationId,
          eventType: "employee.removed",
          aggregateType: "employee",
          aggregateId: event?.aggregateId ?? "missing",
          actor: { type: "user", userId: fixture.userId, role: "owner" },
          idempotencyKey: event?.idempotencyKey,
        }),
      ),
    ).rejects.toThrow("Duplicate operational event");
  });

  it("returns who, when, and what to an authorized auditor", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);
    await t.run((ctx) =>
      appendOperationalEvent(ctx, {
        organizationId: fixture.organizationId,
        eventType: "payroll_run.finalized",
        aggregateType: "payroll_run",
        aggregateId: "run-1",
        actor: { type: "user", userId: fixture.userId, role: "owner" },
        occurredAt: 500,
        summary: "Payroll finalized",
        payload: { payslipCount: 3 },
      }),
    );
    const owner = t.withIdentity({ email: "audit-owner@example.com" });

    const result = await owner.query(
      api.operationalEvents.listOperationalEvents,
      {
        organizationId: fixture.organizationId,
        aggregateType: "payroll_run",
        aggregateId: "run-1",
        limit: 20,
      },
    );

    expect(result.events[0]).toMatchObject({
      eventType: "payroll_run.finalized",
      actorUserId: fixture.userId,
      occurredAt: 500,
      summary: "Payroll finalized",
      payload: { payslipCount: 3 },
    });
  });

  it("bounds event metadata and encrypted payload input", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);

    await expect(
      t.run((ctx) =>
        appendOperationalEvent(ctx, {
          organizationId: fixture.organizationId,
          eventType: "payroll_run.reviewed",
          eventVersion: 0,
          aggregateType: "payroll_run",
          aggregateId: "run-1",
          actor: { type: "user", userId: fixture.userId, role: "owner" },
        }),
      ),
    ).rejects.toThrow("positive integer");
    await expect(
      t.run((ctx) =>
        appendOperationalEvent(ctx, {
          organizationId: fixture.organizationId,
          eventType: "payroll_run.reviewed",
          aggregateType: "payroll_run",
          aggregateId: "run-1",
          actor: { type: "user", userId: fixture.userId, role: "owner" },
          payload: { oversized: "x".repeat(70_000) },
        }),
      ),
    ).rejects.toThrow("payload is too large");
  });
});
