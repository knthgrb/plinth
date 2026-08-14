import { describe, expect, it } from "vitest";
import {
  clampEvaluationPage,
  getEvaluationTiming,
  getNextEvaluationDate,
} from "../lib/evaluations/workflow";

describe("evaluation workflow domain", () => {
  it("keeps recurring evaluations on the final valid day of the target month", () => {
    expect(
      getNextEvaluationDate(Date.UTC(2026, 0, 31), {
        kind: "custom",
        intervalMonths: 1,
      }),
    ).toBe(Date.UTC(2026, 1, 28));

    expect(
      getNextEvaluationDate(Date.UTC(2024, 0, 31), {
        kind: "custom",
        intervalMonths: 1,
      }),
    ).toBe(Date.UTC(2024, 1, 29));
  });

  it("maps standard cadences to their next due dates", () => {
    const date = Date.UTC(2026, 2, 15);

    expect(getNextEvaluationDate(date, { kind: "quarterly" })).toBe(
      Date.UTC(2026, 5, 15),
    );
    expect(getNextEvaluationDate(date, { kind: "semiannual" })).toBe(
      Date.UTC(2026, 8, 15),
    );
    expect(getNextEvaluationDate(date, { kind: "annual" })).toBe(
      Date.UTC(2027, 2, 15),
    );
    expect(getNextEvaluationDate(date, { kind: "none" })).toBeNull();
  });

  it("derives overdue and due-soon timing without changing stored status", () => {
    const now = Date.UTC(2026, 7, 14);

    expect(
      getEvaluationTiming("scheduled", Date.UTC(2026, 7, 13), now),
    ).toBe("overdue");
    expect(
      getEvaluationTiming("scheduled", Date.UTC(2026, 7, 20), now),
    ).toBe("due_soon");
    expect(
      getEvaluationTiming("scheduled", Date.UTC(2026, 8, 30), now),
    ).toBe("scheduled");
    expect(
      getEvaluationTiming("completed", Date.UTC(2026, 7, 13), now),
    ).toBe("completed");
    expect(
      getEvaluationTiming("cancelled", Date.UTC(2026, 7, 13), now),
    ).toBe("cancelled");
  });

  it("clamps pagination after filtering reduces the employee count", () => {
    expect(clampEvaluationPage(4, 7, 20)).toBe(1);
    expect(clampEvaluationPage(3, 41, 20)).toBe(3);
    expect(clampEvaluationPage(0, 41, 20)).toBe(1);
    expect(clampEvaluationPage(2, 0, 20)).toBe(1);
  });
});
