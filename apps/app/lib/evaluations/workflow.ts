export type EvaluationStatus = "scheduled" | "completed" | "cancelled";

export type EvaluationCadence =
  | { kind: "none" }
  | { kind: "quarterly" }
  | { kind: "semiannual" }
  | { kind: "annual" }
  | { kind: "custom"; intervalMonths: number };

export type EvaluationTiming =
  | EvaluationStatus
  | "due_soon"
  | "overdue";

const DUE_SOON_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function cadenceMonths(cadence: EvaluationCadence): number | null {
  switch (cadence.kind) {
    case "none":
      return null;
    case "quarterly":
      return 3;
    case "semiannual":
      return 6;
    case "annual":
      return 12;
    case "custom":
      if (!Number.isInteger(cadence.intervalMonths) || cadence.intervalMonths < 1) {
        throw new Error("Custom evaluation cadence must be at least one month");
      }
      return cadence.intervalMonths;
  }
}

export function getNextEvaluationDate(
  date: number,
  cadence: EvaluationCadence,
): number | null {
  const months = cadenceMonths(cadence);
  if (months === null) return null;

  const source = new Date(date);
  const targetMonthStart = new Date(
    Date.UTC(
      source.getUTCFullYear(),
      source.getUTCMonth() + months,
      1,
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return targetMonthStart.getTime();
}

export function getEvaluationTiming(
  status: EvaluationStatus,
  scheduledFor: number,
  now: number,
): EvaluationTiming {
  if (status !== "scheduled") return status;
  if (scheduledFor < now) return "overdue";
  if (scheduledFor <= now + DUE_SOON_WINDOW_MS) return "due_soon";
  return "scheduled";
}

export function clampEvaluationPage(
  page: number,
  totalItems: number,
  pageSize: number,
): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Evaluation page size must be at least one");
  }

  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
  return Math.min(Math.max(1, Math.trunc(page)), totalPages);
}
