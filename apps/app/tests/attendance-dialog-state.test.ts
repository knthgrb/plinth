import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../convex/_generated/dataModel";
import { resolveAttendanceEmployeeOnDialogOpen } from "../lib/attendance-dialog-state";
import { AddAttendanceDialog } from "../app/[organizationId]/attendance/_components/add-attendance-dialog";

vi.mock("convex/react", () => ({
  useQuery: () => [],
}));

vi.mock("@/actions/attendance", () => ({
  createAttendance: vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/dialog", async () => {
  const { createElement: createMockElement, Fragment: MockFragment } =
    await import("react");
  const Passthrough = ({ children }: { children?: ReactNode }) =>
    createMockElement(MockFragment, null, children);

  return {
    Dialog: Passthrough,
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
    DialogTrigger: Passthrough,
  };
});

vi.mock("@/components/ui/popover", async () => {
  const { createElement: createMockElement, Fragment: MockFragment } =
    await import("react");
  const Passthrough = ({ children }: { children?: ReactNode }) =>
    createMockElement(MockFragment, null, children);

  return {
    Popover: Passthrough,
    PopoverContent: Passthrough,
    PopoverTrigger: Passthrough,
  };
});

const schedule = {
  defaultSchedule: {
    monday: { in: "09:00", out: "18:00", isWorkday: true },
    tuesday: { in: "09:00", out: "18:00", isWorkday: true },
    wednesday: { in: "09:00", out: "18:00", isWorkday: true },
    thursday: { in: "09:00", out: "18:00", isWorkday: true },
    friday: { in: "09:00", out: "18:00", isWorkday: true },
    saturday: { in: "09:00", out: "18:00", isWorkday: false },
    sunday: { in: "09:00", out: "18:00", isWorkday: false },
  },
} as const;

function employeeFixture(
  id: string,
  firstName: string,
  status: "active" | "resigned" | "terminated",
): Doc<"employees"> {
  return {
    _id: id as Id<"employees">,
    _creationTime: 1,
    organizationId: "organization" as Id<"organizations">,
    personalInfo: {
      firstName,
      lastName: "Employee",
      email: `${firstName.toLowerCase()}@example.com`,
    },
    employment: {
      employeeId: id,
      position: "Engineer",
      department: "Technology",
      employmentType: "regular",
      hireDate: Date.UTC(2026, 0, 1),
      separationDate:
        status === "active" ? undefined : Date.UTC(2026, 7, 10),
      status,
    },
    compensation: {
      basicSalary: 50_000,
      salaryType: "monthly",
    },
    schedule,
    createdAt: 1,
    updatedAt: 1,
  };
}

const employees = [
  employeeFixture("active-employee", "Active", "active"),
  employeeFixture("resigned-employee", "Resigned", "resigned"),
  employeeFixture("terminated-employee", "Terminated", "terminated"),
];

function renderDialog(viewedEmployeeId?: string): string {
  return renderToStaticMarkup(
    createElement(AddAttendanceDialog, {
      employees,
      currentOrganizationId: "organization",
      viewedEmployeeId,
    }),
  );
}

describe("attendance dialog employee selection", () => {
  it("inherits the employee currently being viewed when the dialog opens", () => {
    expect(
      resolveAttendanceEmployeeOnDialogOpen("employee-being-viewed"),
    ).toBe("employee-being-viewed");
  });

  it("starts without an employee when the attendance page has no selection", () => {
    expect(
      resolveAttendanceEmployeeOnDialogOpen(),
    ).toBe("");
  });

  it("renders the viewed separated employee as an editable attendance selection", () => {
    const markup = renderDialog("resigned-employee");
    const employeeCombobox = markup
      .match(/<button[^>]*role="combobox"[^>]*>[\s\S]*?<\/button>/g)
      ?.find((button) => button.includes("Resigned Employee"));

    expect(employeeCombobox).toBeDefined();
    expect(employeeCombobox).not.toMatch(/\sdisabled(?:=|>)/);
    expect(markup).toContain("Active Employee");
    expect(markup).toContain("Terminated Employee");
  });

  it("renders the employee placeholder when no attendance employee is viewed", () => {
    const markup = renderDialog();
    const employeeCombobox = markup
      .match(/<button[^>]*role="combobox"[^>]*>[\s\S]*?<\/button>/g)
      ?.find((button) => button.includes("Select employee..."));

    expect(employeeCombobox).toBeDefined();
  });
});
