import type { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { isRequirementApplicable, type RequirementPolicy } from "./workflow";

type EmployeeDirectoryResult = FunctionReturnType<
  typeof api.employees.getEmployees
>[number];
export type RequirementsEmployee = Extract<
  EmployeeDirectoryResult,
  { requirements: readonly unknown[] }
>;
export type RequirementsItem = RequirementsEmployee["requirements"][number];
export type DefaultRequirementPolicy = FunctionReturnType<
  typeof api.organizations.getDefaultRequirements
>[number];

export interface RequirementsColumn {
  id: string;
  label: string;
  field: string;
  type: "text" | "number" | "date" | "badge" | "link";
  sortable?: boolean;
  width?: string;
  customField?: boolean;
  isDefault?: boolean;
  hidden?: boolean;
}

export interface IndexedRequirement {
  index: number;
  requirement: RequirementsItem;
}

export function hasRequirements(
  employee: EmployeeDirectoryResult,
): employee is RequirementsEmployee {
  return "requirements" in employee && Array.isArray(employee.requirements);
}

function normalizeType(type: string): string {
  return type.trim().toLocaleLowerCase();
}

export function getApplicableEmployeeRequirements(
  employee: RequirementsEmployee,
  policies: readonly RequirementPolicy[],
): IndexedRequirement[] {
  const policiesByType = new Map(
    policies.map((policy) => [normalizeType(policy.type), policy]),
  );
  return employee.requirements.flatMap((requirement, index) => {
    if (requirement.archivedAt !== undefined) return [];
    if (requirement.isCustom) return [{ requirement, index }];
    const policy = policiesByType.get(normalizeType(requirement.type));
    if (!policy || !isRequirementApplicable(policy, employee.employment)) {
      return [];
    }
    return [{ requirement, index }];
  });
}

export function getHistoricalEmployeeRequirements(
  employee: RequirementsEmployee,
  policies: readonly RequirementPolicy[],
): IndexedRequirement[] {
  const policiesByType = new Map(
    policies.map((policy) => [normalizeType(policy.type), policy]),
  );
  return employee.requirements.flatMap((requirement, index) => {
    if (requirement.archivedAt !== undefined) return [{ requirement, index }];
    if (requirement.isCustom) return [];
    const policy = policiesByType.get(normalizeType(requirement.type));
    if (policy && isRequirementApplicable(policy, employee.employment)) {
      return [];
    }
    return [{ requirement, index }];
  });
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
