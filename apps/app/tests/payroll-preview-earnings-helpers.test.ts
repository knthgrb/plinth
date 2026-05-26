import { describe, expect, it } from "vitest";

import { getPreviewEarningsFromSource } from "@/app/[organizationId]/payroll/_components/payroll-preview-earnings-helpers";

describe("payroll preview earnings helpers", () => {
  it("maps legacy payroll restDayPremiumPay into restDayPay for preview rows", () => {
    const result = getPreviewEarningsFromSource({
      restDayPremiumPay: 413.78,
      overtimeRestDay: 237.92,
      nightDiffPay: 55.5,
    });

    expect(result.restDayPay).toBe(413.78);
    expect(result.overtimeRestDay).toBe(237.92);
    expect(result.nightDiffPay).toBe(55.5);
  });

  it("prefers explicit restDayPay when both normalized and legacy keys exist", () => {
    const result = getPreviewEarningsFromSource({
      restDayPay: 500,
      restDayPremiumPay: 413.78,
    });

    expect(result.restDayPay).toBe(500);
  });
});
