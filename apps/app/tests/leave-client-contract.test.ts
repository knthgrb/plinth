import { describe, expect, expectTypeOf, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type {
  LeaveRequestDraftInput,
  LeaveRequestSubmissionInput,
} from "../services/leave-service";

describe("typed leave client boundary", () => {
  it("exports canonical request, review, cancellation, adjustment, and conversion actions", () => {
    type Actions = typeof import("../actions/leave");
    expectTypeOf<Actions["previewLeaveRequest"]>()
      .parameter(0)
      .toEqualTypeOf<LeaveRequestDraftInput>();
    expectTypeOf<Actions["submitLeaveRequest"]>()
      .parameter(0)
      .toEqualTypeOf<LeaveRequestSubmissionInput>();
    expectTypeOf<Actions["approveLeaveRequestV2"]>()
      .parameter(0)
      .toMatchTypeOf<{
        leaveRequestId: Id<"leaveRequests">;
        decisionReason?: string;
      }>();
    expectTypeOf<Actions["rejectLeaveRequestV2"]>()
      .parameter(0)
      .toMatchTypeOf<{
        leaveRequestId: Id<"leaveRequests">;
        decisionReason: string;
      }>();
    expectTypeOf<Actions["requestLeaveCancellation"]>().toBeFunction();
    expectTypeOf<Actions["approveLeaveCancellation"]>().toBeFunction();
    expectTypeOf<Actions["adjustLeaveBalance"]>().toBeFunction();
    expectTypeOf<Actions["requestLeaveConversion"]>().toBeFunction();
    expect(true).toBe(true);
  });
});
