type LeaveRequestPayFields = {
  leaveType?: string | null;
  customLeaveType?: string | null;
  isPaid?: boolean | null;
};

type LeaveTypePayConfig = {
  type: string;
  name?: string;
  isPaid?: boolean;
};

type CutoffDates = {
  firstCutoff?: number;
  secondCutoff?: number;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function clampDay(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getLeaveTypePayKey(request: LeaveRequestPayFields) {
  if (request.leaveType === "custom" && request.customLeaveType) {
    return request.customLeaveType;
  }

  return request.leaveType ?? "";
}

export function resolveLeavePayLabel(
  request: LeaveRequestPayFields,
  configuredLeaveTypes: LeaveTypePayConfig[],
) {
  if (typeof request.isPaid === "boolean") {
    return request.isPaid ? "w/ Pay" : "w/o Pay";
  }

  const typeKey = getLeaveTypePayKey(request);
  const configured = configuredLeaveTypes.find((type) => type.type === typeKey);

  return configured?.isPaid === false ? "w/o Pay" : "w/ Pay";
}

export function formatLeaveCutoffPeriod(
  leaveDate: number | null | undefined,
  cutoffDates?: CutoffDates | null,
) {
  if (!leaveDate) return null;

  const date = new Date(leaveDate);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const firstCutoff = clampDay(cutoffDates?.firstCutoff ?? 15, 1, lastDay);

  if (day <= firstCutoff) {
    return `${MONTH_LABELS[month]} 1-${firstCutoff}, ${year}`;
  }

  const configuredSecondCutoff = cutoffDates?.secondCutoff ?? lastDay;
  const secondCutoff = clampDay(configuredSecondCutoff, firstCutoff + 1, lastDay);
  const secondPeriodEnd = Math.max(secondCutoff, day);

  return `${MONTH_LABELS[month]} ${firstCutoff + 1}-${secondPeriodEnd}, ${year}`;
}
