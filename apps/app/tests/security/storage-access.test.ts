import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const rawModules = import.meta.glob("../../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader,
  ]),
);

async function createMembershipFixture(
  accessStatus: "active" | "alumni" = "active",
) {
  const t = convexTest(schema, modules);
  const email = `${accessStatus}@example.com`;
  const organizationId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: `${accessStatus} organization`,
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
      role: "employee",
      accessStatus,
      joinedAt: 1,
      updatedAt: 1,
    });
    return organizationId;
  });

  return { t, email, organizationId };
}

describe("tenant-owned storage", () => {
  it("allows an active member to register and read their organization's upload", async () => {
    const { t, email, organizationId } = await createMembershipFixture();
    const actor = t.withIdentity({ email });
    const intent = await actor.mutation(api.files.createUploadIntent, {
      organizationId,
      purpose: "document_attachment",
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["private document"], { type: "text/plain" })),
    );

    await actor.mutation(api.files.registerUploadedFile, {
      intentId: intent.intentId,
      storageId,
      fileName: "private.txt",
    });

    const storedMetadata = await t.run((ctx) =>
      ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .unique(),
    );
    expect(storedMetadata?.contentType).toBeUndefined();
    expect(storedMetadata?.size).toBe(16);

    const url = await actor.query(api.files.getFileUrl, {
      organizationId,
      storageId,
    });
    expect(url).toMatch(/^https:\/\//);
  });

  it("rejects a storage object through another organization", async () => {
    const { t, email, organizationId } = await createMembershipFixture();
    const actor = t.withIdentity({ email });
    const intent = await actor.mutation(api.files.createUploadIntent, {
      organizationId,
      purpose: "document_attachment",
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["tenant A document"])),
    );
    await actor.mutation(api.files.registerUploadedFile, {
      intentId: intent.intentId,
      storageId,
    });

    const otherOrganizationId = await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: otherUserId,
        organizationId: otherOrganizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return otherOrganizationId;
    });

    await expect(
      t.withIdentity({ email: "other@example.com" }).query(api.files.getFileUrl, {
        organizationId: otherOrganizationId,
        storageId,
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("rejects an unregistered storage ID", async () => {
    const { t, email, organizationId } = await createMembershipFixture();
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["unregistered document"])),
    );

    await expect(
      t.withIdentity({ email }).query(api.files.getFileUrl, {
        organizationId,
        storageId,
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("allows a legacy file only when an organization record references it", async () => {
    const { t, email, organizationId } = await createMembershipFixture();
    const storageId = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (!user) throw new Error("Fixture user missing");
      const storageId = await ctx.storage.store(new Blob(["legacy document"]));
      await ctx.db.insert("documents", {
        organizationId,
        createdBy: user._id,
        title: "Legacy document",
        content: "{}",
        type: "other",
        attachments: [storageId],
        createdAt: 1,
        updatedAt: 1,
      });
      return storageId;
    });

    const url = await t.withIdentity({ email }).query(api.files.getFileUrl, {
      organizationId,
      storageId,
    });
    expect(url).toMatch(/^https:\/\//);
  });

  it("does not issue upload intents to alumni", async () => {
    const { t, email, organizationId } = await createMembershipFixture("alumni");

    await expect(
      t.withIdentity({ email }).mutation(api.files.createUploadIntent, {
        organizationId,
        purpose: "document_attachment",
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("does not let an employee create an accounting receipt upload", async () => {
    const { t, email, organizationId } = await createMembershipFixture();

    await expect(
      t.withIdentity({ email }).mutation(api.files.createUploadIntent, {
        organizationId,
        purpose: "accounting_receipt",
      }),
    ).rejects.toThrow("Not authorized");
  });
});
