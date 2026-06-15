import { describe, expect, it } from "vitest";
import {
  formatLeaveCutoffPeriod,
  resolveLeavePayLabel,
} from "@/utils/leave-history-columns";

describe("leave history columns", () => {
  it("labels paid and unpaid leave from configured leave types", () => {
    const configuredLeaveTypes = [
      { type: "vacation", name: "Vacation Leave", isPaid: true },
      { type: "unpaid_vacation", name: "Vacation Leave", isPaid: false },
    ];

    expect(
      resolveLeavePayLabel(
        { leaveType: "vacation" },
        configuredLeaveTypes,
      ),
    ).toBe("w/ Pay");
    expect(
      resolveLeavePayLabel(
        { leaveType: "custom", customLeaveType: "unpaid_vacation" },
        configuredLeaveTypes,
      ),
    ).toBe("w/o Pay");
  });

  it("defaults legacy leave requests to paid", () => {
    expect(resolveLeavePayLabel({ leaveType: "sick" }, [])).toBe("w/ Pay");
  });

  it("uses the request pay flag before configured leave type defaults", () => {
    expect(
      resolveLeavePayLabel(
        { leaveType: "vacation", isPaid: false },
        [{ type: "vacation", name: "Vacation Leave", isPaid: true }],
      ),
    ).toBe("w/o Pay");
  });

  it("formats the cutoff period from the leave date", () => {
    const cutoffDates = { firstCutoff: 15, secondCutoff: 30 };

    expect(
      formatLeaveCutoffPeriod(new Date(2026, 1, 2).getTime(), cutoffDates),
    ).toBe("Feb 1-15, 2026");
    expect(
      formatLeaveCutoffPeriod(new Date(2026, 1, 19).getTime(), cutoffDates),
    ).toBe("Feb 16-28, 2026");
  });
});
