import {
  clampEvaluationPage,
  getEvaluationTiming,
  type EvaluationStatus,
  type EvaluationTiming,
} from "./workflow";

export type EvaluationEmployeeListItem = {
  id: string;
  name: string;
  employeeCode: string;
  position: string;
  department: string;
  nextEvaluation: {
    status: EvaluationStatus;
    scheduledFor: number;
  } | null;
  hasCompleted?: boolean;
};

export type EvaluationTimingFilter =
  | "all"
  | EvaluationTiming
  | "not_scheduled";

export type EvaluationEmployeeFilters = {
  search: string;
  department: string;
  timing: EvaluationTimingFilter;
  now: number;
};

export function filterEvaluationEmployees<T extends EvaluationEmployeeListItem>(
  rows: T[],
  filters: EvaluationEmployeeFilters,
): T[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesSearch =
      !search ||
      [row.name, row.employeeCode, row.position, row.department].some((value) =>
        value.toLowerCase().includes(search),
      );
    const matchesDepartment =
      filters.department === "all" || row.department === filters.department;
    let matchesTiming = filters.timing === "all";

    if (filters.timing === "not_scheduled") {
      matchesTiming = row.nextEvaluation === null;
    } else if (filters.timing === "completed") {
      matchesTiming = row.hasCompleted === true;
    } else if (filters.timing !== "all") {
      matchesTiming =
        row.nextEvaluation !== null &&
        getEvaluationTiming(
          row.nextEvaluation.status,
          row.nextEvaluation.scheduledFor,
          filters.now,
        ) === filters.timing;
    }

    return matchesSearch && matchesDepartment && matchesTiming;
  });
}

export function paginateEvaluationEmployees<T>(
  rows: T[],
  requestedPage: number,
  pageSize: number,
) {
  const page = clampEvaluationPage(requestedPage, rows.length, pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, rows.length);
  return {
    items: rows.slice(startIndex, endIndex),
    page,
    totalPages,
    startIndex,
    endIndex,
    totalItems: rows.length,
  };
}
