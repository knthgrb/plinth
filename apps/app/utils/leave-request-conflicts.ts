export const ACTIVE_LEAVE_REQUEST_STATUSES = ["pending", "approved"] as const;

export type ActiveLeaveRequestStatus =
  (typeof ACTIVE_LEAVE_REQUEST_STATUSES)[number];

export function leaveDateRangesOverlap(
  firstStartDate: number,
  firstEndDate: number,
  secondStartDate: number,
  secondEndDate: number,
) {
  return firstStartDate <= secondEndDate && secondStartDate <= firstEndDate;
}
