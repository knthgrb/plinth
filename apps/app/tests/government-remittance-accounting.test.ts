import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MutationCtx } from "../convex/_generated/server";
import {
  postGovernmentRemittancePaymentJournal,
  reverseGovernmentRemittancePaymentJournal,
} from "../convex/governmentRemittanceAccounting";
import {
  decryptGovernmentRemittanceDetails,
  encryptGovernmentRemittanceDetails,
  encryptGovernmentRemittanceReason,
} from "../convex/governmentRemittanceCrypto";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seedRemittance(ctx: MutationCtx) {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Remittance Accounting Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const actorId = await ctx.db.insert("users", {
    email: "remittance-owner@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  const remittanceId = await ctx.db.insert("governmentRemittances", {
    organizationId,
    remittanceNumber: "SSS-202608-000001",
    agency: "sss",
    status: "filed",
    periodStart: 1,
    periodEnd: 2,
    dueDate: 3,
    liabilityAmount: 12_000,
    penaltyAmount: 300,
    interestAmount: 100,
    advancePaymentAmount: 750,
    advanceAppliedAmount: 1_000,
    cashAmount: 12_150,
    createdBy: actorId,
    filedBy: actorId,
    filedAt: 3,
    createdAt: 1,
    updatedAt: 3,
  });
  return { organizationId, actorId, remittanceId };
}

describe("government remittance accounting", () => {
  it("posts payment once with a stable source identity", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedRemittance);

    const result = await t.run(async (ctx) => {
      const first = await postGovernmentRemittancePaymentJournal(
        ctx,
        fixture.remittanceId,
        fixture.actorId,
        4,
      );
      const retry = await postGovernmentRemittancePaymentJournal(
        ctx,
        fixture.remittanceId,
        fixture.actorId,
        4,
      );
      const entry = await ctx.db.get(first);
      const lines = await ctx.db
        .query("accountingJournalLines")
        .withIndex("by_entry", (query) => query.eq("journalEntryId", first))
        .collect();
      return { first, retry, entry, lines };
    });

    expect(result.retry).toBe(result.first);
    expect(result.entry).toMatchObject({
      sourceType: "government_remittance",
      sourceId: String(fixture.remittanceId),
      sourceKey: `${fixture.remittanceId}:payment:v1`,
      entryType: "government_remittance_payment",
      status: "posted",
      effectiveAt: 4,
    });
    expect(
      result.lines.map(({ accountCode, debit, credit }) => ({
        accountCode,
        debit,
        credit,
      })),
    ).toEqual([
      { accountCode: "2110", debit: 12_000, credit: 0 },
      { accountCode: "6900", debit: 300, credit: 0 },
      { accountCode: "6910", debit: 100, credit: 0 },
      { accountCode: "1320", debit: 750, credit: 0 },
      { accountCode: "1320", debit: 0, credit: 1_000 },
      { accountCode: "1000", debit: 0, credit: 12_150 },
    ]);
  });

  it("preserves the payment and posts an idempotent opposite reversal", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedRemittance);

    const result = await t.run(async (ctx) => {
      const paymentId = await postGovernmentRemittancePaymentJournal(
        ctx,
        fixture.remittanceId,
        fixture.actorId,
        4,
      );
      const reversalId = await reverseGovernmentRemittancePaymentJournal(
        ctx,
        fixture.remittanceId,
        fixture.actorId,
        "Duplicate bank payment",
        5,
      );
      const retryId = await reverseGovernmentRemittancePaymentJournal(
        ctx,
        fixture.remittanceId,
        fixture.actorId,
        "Duplicate bank payment",
        5,
      );
      const payment = await ctx.db.get(paymentId);
      const reversal = await ctx.db.get(reversalId);
      const lines = await ctx.db
        .query("accountingJournalLines")
        .withIndex("by_entry", (query) =>
          query.eq("journalEntryId", reversalId),
        )
        .collect();
      return { payment, reversal, reversalId, retryId, lines };
    });

    expect(result.retryId).toBe(result.reversalId);
    expect(result.payment).toMatchObject({ status: "reversed" });
    expect(result.reversal).toMatchObject({
      entryType: "government_remittance_reversal",
      reversalOf: result.payment?._id,
      status: "posted",
    });
    expect(
      result.lines.map(({ accountCode, debit, credit }) => ({
        accountCode,
        debit,
        credit,
      })),
    ).toEqual([
      { accountCode: "2110", debit: 0, credit: 12_000 },
      { accountCode: "6900", debit: 0, credit: 300 },
      { accountCode: "6910", debit: 0, credit: 100 },
      { accountCode: "1320", debit: 0, credit: 750 },
      { accountCode: "1320", debit: 1_000, credit: 0 },
      { accountCode: "1000", debit: 12_150, credit: 0 },
    ]);
  });

  it("encrypts remittance details and reasons with separate purposes", () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    const details = {
      referenceNumber: "BIR-REF-SECRET",
      bankAccountLabel: "Operating Account 1234",
    };
    const encryptedDetails = encryptGovernmentRemittanceDetails(details);
    const encryptedReason = encryptGovernmentRemittanceReason(
      "Payment returned by bank",
    );

    expect(encryptedDetails).not.toContain(details.referenceNumber);
    expect(encryptedReason).not.toContain("Payment returned by bank");
    expect(
      decryptGovernmentRemittanceDetails<typeof details>(encryptedDetails),
    ).toEqual(details);
    expect(() =>
      decryptGovernmentRemittanceDetails<typeof details>(encryptedReason),
    ).toThrow();
  });
});
