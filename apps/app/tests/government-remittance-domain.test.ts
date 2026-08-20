import { describe, expect, it } from "vitest";

import {
  assertGovernmentRemittanceTransition,
  buildGovernmentRemittancePaymentJournal,
  getGovernmentLiabilityAccount,
} from "@/lib/government-remittance";

describe("government remittance domain", () => {
  it("allows the reviewed, approved, filed, paid, and reversal lifecycle", () => {
    expect(() =>
      assertGovernmentRemittanceTransition("draft", "reviewed"),
    ).not.toThrow();
    expect(() =>
      assertGovernmentRemittanceTransition("reviewed", "approved"),
    ).not.toThrow();
    expect(() =>
      assertGovernmentRemittanceTransition("approved", "filed"),
    ).not.toThrow();
    expect(() =>
      assertGovernmentRemittanceTransition("filed", "paid"),
    ).not.toThrow();
    expect(() =>
      assertGovernmentRemittanceTransition("paid", "reversed"),
    ).not.toThrow();
  });

  it("returns filing failures to approved and payment failures to filed", () => {
    expect(() =>
      assertGovernmentRemittanceTransition("failed", "approved", "filing"),
    ).not.toThrow();
    expect(() =>
      assertGovernmentRemittanceTransition("failed", "filed", "payment"),
    ).not.toThrow();
    expect(() =>
      assertGovernmentRemittanceTransition("failed", "filed", "filing"),
    ).toThrow("Invalid government remittance transition");
    expect(() =>
      assertGovernmentRemittanceTransition("failed", "approved", "payment"),
    ).toThrow("Invalid government remittance transition");
    expect(() =>
      assertGovernmentRemittanceTransition("failed", "cancelled", "payment"),
    ).not.toThrow();
  });

  it("rejects skipped and terminal lifecycle transitions", () => {
    expect(() => assertGovernmentRemittanceTransition("draft", "paid")).toThrow(
      "Invalid government remittance transition",
    );
    expect(() => assertGovernmentRemittanceTransition("paid", "filed")).toThrow(
      "Invalid government remittance transition",
    );
    expect(() =>
      assertGovernmentRemittanceTransition("reversed", "draft"),
    ).toThrow("Invalid government remittance transition");
    expect(() =>
      assertGovernmentRemittanceTransition("cancelled", "draft"),
    ).toThrow("Invalid government remittance transition");
  });

  it("maps every agency to its payroll liability account", () => {
    expect(getGovernmentLiabilityAccount("bir")).toEqual({
      code: "2140",
      name: "Withholding Tax Payable",
    });
    expect(getGovernmentLiabilityAccount("sss")).toEqual({
      code: "2110",
      name: "SSS Payable",
    });
    expect(getGovernmentLiabilityAccount("philhealth")).toEqual({
      code: "2120",
      name: "PhilHealth Payable",
    });
    expect(getGovernmentLiabilityAccount("pagibig")).toEqual({
      code: "2130",
      name: "Pag-IBIG Payable",
    });
  });

  it("builds a balanced payment journal with penalties and interest", () => {
    const journal = buildGovernmentRemittancePaymentJournal({
      agency: "bir",
      liabilityAmount: 8_000,
      penaltyAmount: 300,
      interestAmount: 100,
      advancePaymentAmount: 0,
      advanceAppliedAmount: 0,
    });

    expect(journal).toEqual({
      lines: [
        {
          accountCode: "2140",
          accountName: "Withholding Tax Payable",
          debit: 8_000,
          credit: 0,
        },
        {
          accountCode: "6900",
          accountName: "Government Penalties Expense",
          debit: 300,
          credit: 0,
        },
        {
          accountCode: "6910",
          accountName: "Government Interest Expense",
          debit: 100,
          credit: 0,
        },
        {
          accountCode: "1000",
          accountName: "Cash and Bank",
          debit: 0,
          credit: 8_400,
        },
      ],
      totalDebits: 8_400,
      totalCredits: 8_400,
      cashAmount: 8_400,
    });
  });

  it("records a new overpayment as an advance asset", () => {
    const journal = buildGovernmentRemittancePaymentJournal({
      agency: "sss",
      liabilityAmount: 12_000,
      penaltyAmount: 0,
      interestAmount: 0,
      advancePaymentAmount: 750,
      advanceAppliedAmount: 0,
    });

    expect(journal.lines).toEqual([
      {
        accountCode: "2110",
        accountName: "SSS Payable",
        debit: 12_000,
        credit: 0,
      },
      {
        accountCode: "1320",
        accountName: "SSS Remittance Advances",
        debit: 750,
        credit: 0,
      },
      {
        accountCode: "1000",
        accountName: "Cash and Bank",
        debit: 0,
        credit: 12_750,
      },
    ]);
    expect(journal.cashAmount).toBe(12_750);
  });

  it("applies an existing advance before calculating cash", () => {
    const journal = buildGovernmentRemittancePaymentJournal({
      agency: "philhealth",
      liabilityAmount: 4_000,
      penaltyAmount: 50,
      interestAmount: 0,
      advancePaymentAmount: 0,
      advanceAppliedAmount: 1_000,
    });

    expect(journal.lines).toEqual([
      {
        accountCode: "2120",
        accountName: "PhilHealth Payable",
        debit: 4_000,
        credit: 0,
      },
      {
        accountCode: "6900",
        accountName: "Government Penalties Expense",
        debit: 50,
        credit: 0,
      },
      {
        accountCode: "1330",
        accountName: "PhilHealth Remittance Advances",
        debit: 0,
        credit: 1_000,
      },
      {
        accountCode: "1000",
        accountName: "Cash and Bank",
        debit: 0,
        credit: 3_050,
      },
    ]);
    expect(journal.totalDebits).toBe(4_050);
    expect(journal.totalCredits).toBe(4_050);
    expect(journal.cashAmount).toBe(3_050);
  });

  it("rejects invalid financial amounts and advance over-application", () => {
    expect(() =>
      buildGovernmentRemittancePaymentJournal({
        agency: "pagibig",
        liabilityAmount: Number.NaN,
        penaltyAmount: 0,
        interestAmount: 0,
        advancePaymentAmount: 0,
        advanceAppliedAmount: 0,
      }),
    ).toThrow("Liability amount must be a finite non-negative amount");
    expect(() =>
      buildGovernmentRemittancePaymentJournal({
        agency: "pagibig",
        liabilityAmount: 500,
        penaltyAmount: -1,
        interestAmount: 0,
        advancePaymentAmount: 0,
        advanceAppliedAmount: 0,
      }),
    ).toThrow("Penalty amount must be a finite non-negative amount");
    expect(() =>
      buildGovernmentRemittancePaymentJournal({
        agency: "pagibig",
        liabilityAmount: 500,
        penaltyAmount: 0,
        interestAmount: 0,
        advancePaymentAmount: 0,
        advanceAppliedAmount: 501,
      }),
    ).toThrow("Applied advance cannot exceed the liability amount");
  });
});
