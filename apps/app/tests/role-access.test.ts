import { describe, expect, it } from "vitest";
import { canAccessRoute, effectiveRole, rolesForPath } from "@/utils/role-access";

describe("role access", () => {
  it("recognizes manager as an organization role", () => {
    expect(effectiveRole("manager")).toBe("manager");
    expect(effectiveRole("Manager")).toBe("manager");
  });

  it("allows managers into people and leave management routes without finance access", () => {
    expect(canAccessRoute("/employees", "manager")).toBe(true);
    expect(canAccessRoute("/attendance", "manager")).toBe(true);
    expect(canAccessRoute("/leave", "manager")).toBe(true);
    expect(canAccessRoute("/requirements", "manager")).toBe(true);
    expect(canAccessRoute("/payslips", "manager")).toBe(true);
    expect(canAccessRoute("/payroll", "manager")).toBe(false);
    expect(canAccessRoute("/accounting", "manager")).toBe(false);
  });

  it("includes manager in sidebar role lists for manager-visible routes", () => {
    expect(rolesForPath("/employees")).toContain("manager");
    expect(rolesForPath("/leave")).toContain("manager");
    expect(rolesForPath("/payslips")).toContain("manager");
    expect(rolesForPath("/payroll")).not.toContain("manager");
  });

  it("keeps evaluation records private to owner, admin, and HR", () => {
    expect(rolesForPath("/evaluations")).toEqual(["admin", "owner", "hr"]);
    expect(canAccessRoute("/evaluations", "owner")).toBe(true);
    expect(canAccessRoute("/evaluations", "admin")).toBe(true);
    expect(canAccessRoute("/evaluations", "hr")).toBe(true);
    expect(canAccessRoute("/evaluations", "manager")).toBe(false);
    expect(canAccessRoute("/evaluations", "accounting")).toBe(false);
    expect(canAccessRoute("/evaluations", "employee")).toBe(false);
  });
});
