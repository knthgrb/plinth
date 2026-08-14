import type { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type RecruitmentJob = FunctionReturnType<
  typeof api.recruitment.getJobs
>[number];
export type RecruitmentApplicant = FunctionReturnType<
  typeof api.recruitment.getApplicants
>[number];
type OrganizationMemberResult = FunctionReturnType<
  typeof api.organizations.getOrganizationMembers
>[number];
export type OrganizationMember = Exclude<OrganizationMemberResult, null>;

export interface RecruitmentColumn {
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

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function getUnknownField(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
