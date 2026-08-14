import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/convex/_generated/api";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { AttendanceService } from "@/services/attendance-service";

vi.mock("@/lib/convex-client", () => ({
  getAuthedConvexClient: vi.fn(),
}));

const getAuthedConvexClientMock = vi.mocked(getAuthedConvexClient);

describe("AttendanceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes deletion and its correction reason to the attendance mutation", async () => {
    const mutation = vi.fn().mockResolvedValue({ success: true });
    getAuthedConvexClientMock.mockResolvedValue({ mutation } as never);

    const result = await AttendanceService.deleteAttendance(
      "attendance-id",
      "Removed duplicate biometric entry",
    );

    expect(result).toEqual({ success: true });
    expect(mutation).toHaveBeenCalledWith(api.attendance.deleteAttendance, {
      attendanceId: "attendance-id",
      correctionReason: "Removed duplicate biometric entry",
    });
  });
});
