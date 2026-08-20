import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVALUATION_EMPLOYMENT_STATUS_FILTER,
  filterEvaluationEmployees,
  paginateEvaluationEmployees,
  type EvaluationEmployeeListItem,
} from "../lib/evaluations/view";

const rows: EvaluationEmployeeListItem[] = [
  {
    id: "employee-1",
    name: "Avery Santos",
    employeeCode: "EMP-001",
    position: "Analyst",
    department: "Operations",
    employmentStatus: "active",
    nextEvaluation: {
      status: "scheduled",
      scheduledFor: Date.UTC(2026, 7, 10),
    },
  },
  {
    id: "employee-2",
    name: "Bianca Reyes",
    employeeCode: "EMP-002",
    position: "Designer",
    department: "Product",
    employmentStatus: "resigned",
    nextEvaluation: {
      status: "scheduled",
      scheduledFor: Date.UTC(2026, 7, 20),
    },
  },
  {
    id: "employee-3",
    name: "Carlo Lim",
    employeeCode: "EMP-003",
    position: "Engineer",
    department: "Product",
    employmentStatus: "terminated",
    nextEvaluation: null,
  },
];

describe("evaluation workspace employee list", () => {
  it("searches employee identity fields and combines department and timing filters", () => {
    const now = Date.UTC(2026, 7, 14);

    expect(
      filterEvaluationEmployees(rows, {
        search: "emp-002",
        department: "Product",
        employmentStatus: "all",
        timing: "due_soon",
        now,
      }).map((row) => row.id),
    ).toEqual(["employee-2"]);
    expect(
      filterEvaluationEmployees(rows, {
        search: "engineer",
        department: "all",
        employmentStatus: "all",
        timing: "not_scheduled",
        now,
      }).map((row) => row.id),
    ).toEqual(["employee-3"]);
  });

  it("defaults the employee-status view to active while retaining separated history", () => {
    const baseFilters = {
      search: "",
      department: "all",
      timing: "all" as const,
      now: Date.UTC(2026, 7, 14),
    };

    expect(
      filterEvaluationEmployees(rows, {
        ...baseFilters,
        employmentStatus: DEFAULT_EVALUATION_EMPLOYMENT_STATUS_FILTER,
      }).map((row) => row.id),
    ).toEqual(["employee-1"]);
    expect(
      filterEvaluationEmployees(rows, {
        ...baseFilters,
        employmentStatus: "separated",
      }).map((row) => row.id),
    ).toEqual(["employee-2", "employee-3"]);
    expect(
      filterEvaluationEmployees(rows, {
        ...baseFilters,
        employmentStatus: "resigned",
      }).map((row) => row.id),
    ).toEqual(["employee-2"]);
    expect(
      filterEvaluationEmployees(rows, {
        ...baseFilters,
        employmentStatus: "terminated",
      }).map((row) => row.id),
    ).toEqual(["employee-3"]);
    expect(
      filterEvaluationEmployees(rows, {
        ...baseFilters,
        employmentStatus: "all",
      }).map((row) => row.id),
    ).toEqual(["employee-1", "employee-2", "employee-3"]);
  });

  it("paginates the filtered list and clamps stale page numbers", () => {
    const manyRows = Array.from({ length: 45 }, (_, index) => ({
      ...rows[0],
      id: `employee-${index + 1}`,
      name: `Employee ${index + 1}`,
    }));

    expect(paginateEvaluationEmployees(manyRows, 3, 20)).toMatchObject({
      page: 3,
      totalPages: 3,
      startIndex: 40,
      endIndex: 45,
    });
    expect(
      paginateEvaluationEmployees(manyRows.slice(0, 4), 3, 20),
    ).toMatchObject({
      page: 1,
      totalPages: 1,
      startIndex: 0,
      endIndex: 4,
    });
  });
});
