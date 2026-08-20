import { describe, expect, it } from "vitest";

import {
  getGovernmentRemittanceActions,
  validateGovernmentRemittanceLifecycleInput,
} from "@/lib/government-remittance-ui";

describe("government remittance UI behavior", () => {
  it("shows only lifecycle actions valid for the status and role", () => {
    expect(getGovernmentRemittanceActions("draft", "accounting")).toEqual([
      "view",
      "attach_evidence",
      "edit",
      "submit",
      "cancel",
    ]);
    expect(getGovernmentRemittanceActions("reviewed", "accounting")).toEqual([
      "view",
      "attach_evidence",
      "return_to_draft",
      "cancel",
    ]);
    expect(getGovernmentRemittanceActions("reviewed", "owner")).toEqual([
      "view",
      "attach_evidence",
      "return_to_draft",
      "approve",
      "cancel",
    ]);
    expect(getGovernmentRemittanceActions("approved", "accounting")).toEqual([
      "view",
      "attach_evidence",
      "file",
      "fail_filing",
    ]);
    expect(getGovernmentRemittanceActions("filed", "accounting")).toEqual([
      "view",
      "attach_evidence",
      "pay",
      "fail_payment",
    ]);
    expect(getGovernmentRemittanceActions("paid", "admin")).toEqual([
      "view",
      "attach_evidence",
      "reverse",
    ]);
    expect(getGovernmentRemittanceActions("paid", "accounting")).toEqual([
      "view",
      "attach_evidence",
    ]);
    expect(getGovernmentRemittanceActions("failed", "accounting")).toEqual([
      "view",
      "attach_evidence",
      "retry",
    ]);
    expect(getGovernmentRemittanceActions("failed", "owner")).toEqual([
      "view",
      "attach_evidence",
      "retry",
      "cancel",
    ]);
  });

  it("requires filing and payment references", () => {
    expect(() =>
      validateGovernmentRemittanceLifecycleInput("file", "   "),
    ).toThrow("Filing reference number is required");
    expect(() => validateGovernmentRemittanceLifecycleInput("pay", "")).toThrow(
      "Payment reference number is required",
    );
    expect(
      validateGovernmentRemittanceLifecycleInput("pay", "  BANK-123  "),
    ).toBe("BANK-123");
  });

  it("requires reasons for returns, cancellation, and reversal", () => {
    expect(() =>
      validateGovernmentRemittanceLifecycleInput("return_to_draft", ""),
    ).toThrow("Return reason is required");
    expect(() =>
      validateGovernmentRemittanceLifecycleInput("cancel", ""),
    ).toThrow("Cancellation reason is required");
    expect(() =>
      validateGovernmentRemittanceLifecycleInput("reverse", ""),
    ).toThrow("Reversal reason is required");
    expect(
      validateGovernmentRemittanceLifecycleInput(
        "reverse",
        "  Duplicate transfer  ",
      ),
    ).toBe("Duplicate transfer");
  });
});
