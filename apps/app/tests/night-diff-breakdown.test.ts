import { describe, expect, it } from "vitest";

import { groupNightDiffBreakdownRows } from "@/lib/night-diff-breakdown";

describe("night diff breakdown grouping", () => {
  it("groups categorized night differential rows by category label", () => {
    const rows = groupNightDiffBreakdownRows([
      {
        label: "Wednesday, March 18",
        date: Date.UTC(2026, 2, 18),
        amount: 55.5,
        category: "rest_day",
      },
      {
        label: "Wednesday, March 18",
        date: Date.UTC(2026, 2, 18),
        amount: 12.25,
        category: "rest_day_ot",
      },
      {
        label: "Thursday, March 19",
        date: Date.UTC(2026, 2, 19),
        amount: 44.5,
        category: "rest_day",
      },
    ]);

    expect(rows).toEqual([
      { label: "Night Differential - Rest Day", amount: 100 },
      { label: "Night Differential - Rest Day OT", amount: 12.25 },
    ]);
  });

  it("falls back to a single generic line for uncategorized legacy breakdown rows", () => {
    const rows = groupNightDiffBreakdownRows([
      {
        label: "Wednesday, March 18",
        date: Date.UTC(2026, 2, 18),
        amount: 40,
      },
      {
        label: "Thursday, March 19",
        date: Date.UTC(2026, 2, 19),
        amount: 10,
      },
    ]);

    expect(rows).toEqual([{ label: "Night Differential", amount: 50 }]);
  });
});
