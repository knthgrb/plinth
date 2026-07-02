import { describe, expect, it } from "vitest";
import { getConvexUserFacingMessage } from "../lib/convex-user-facing-error";

describe("Convex user-facing error messages", () => {
  it("extracts the message from a Convex transport error with a request id", () => {
    const error = new Error(
      'Uncaught ConvexError: {"code":"PAYROLL_RUN_UPDATE_FAILED","message":"Document does not match schema"}\n[Request ID: abc123] Server Error',
    );

    expect(getConvexUserFacingMessage(error)).toBe("Document does not match schema");
  });

  it("extracts normal thrown errors from Convex transport errors", () => {
    const error = new Error(
      "[CONVEX M(payroll:updatePayrollRun)] [Request ID: abc123] Server Error\nUncaught Error: Payroll run not found",
    );

    expect(getConvexUserFacingMessage(error)).toBe("Payroll run not found");
  });
});
