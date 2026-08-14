import { describe, expect, it } from "vitest";
import {
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
    nextEvaluation: { status: "scheduled", scheduledFor: Date.UTC(2026, 7, 10) },
  },
  {
    id: "employee-2",
    name: "Bianca Reyes",
    employeeCode: "EMP-002",
    position: "Designer",
    department: "Product",
    nextEvaluation: { status: "scheduled", scheduledFor: Date.UTC(2026, 7, 20) },
  },
  {
    id: "employee-3",
    name: "Carlo Lim",
    employeeCode: "EMP-003",
    position: "Engineer",
    department: "Product",
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
        timing: "due_soon",
        now,
      }).map((row) => row.id),
    ).toEqual(["employee-2"]);
    expect(
      filterEvaluationEmployees(rows, {
        search: "engineer",
        department: "all",
        timing: "not_scheduled",
        now,
      }).map((row) => row.id),
    ).toEqual(["employee-3"]);
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
    expect(paginateEvaluationEmployees(manyRows.slice(0, 4), 3, 20)).toMatchObject({
      page: 1,
      totalPages: 1,
      startIndex: 0,
      endIndex: 4,
    });
  });
});
