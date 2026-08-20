export const SEPARATION_TYPES = [
  "resignation",
  "termination",
  "job_abandonment",
  "end_of_contract",
  "retirement",
  "redundancy",
  "mutual_separation",
  "death",
  "transfer",
  "other",
] as const;

export type SeparationType = (typeof SEPARATION_TYPES)[number];
export type EmploymentStatus = "active" | "separated";
export type LegacyEmploymentStatus = "resigned" | "terminated";

const SEPARATION_TYPE_LABELS: Record<SeparationType, string> = {
  resignation: "Resignation",
  termination: "Termination",
  job_abandonment: "Job abandonment",
  end_of_contract: "End of contract",
  retirement: "Retirement",
  redundancy: "Redundancy",
  mutual_separation: "Mutual separation",
  death: "Death",
  transfer: "Transfer",
  other: "Other",
};

export function normalizeEmploymentStatus(
  status: string | null | undefined,
): EmploymentStatus {
  return status === "separated" ||
    status === "resigned" ||
    status === "terminated"
    ? "separated"
    : "active";
}

export function isEmployeeSeparated(
  status: string | null | undefined,
): boolean {
  return normalizeEmploymentStatus(status) === "separated";
}

export function resolveSeparationType(
  status: string | null | undefined,
  separationType?: string | null,
): SeparationType | null {
  if (!isEmployeeSeparated(status)) return null;
  if (status === "resigned") return "resignation";
  if (status === "terminated") return "termination";
  return normalizeSeparationType(separationType) ?? "other";
}

export function normalizeSeparationType(
  separationType: string | null | undefined,
): SeparationType | null {
  if (separationType === "resigned") return "resignation";
  if (separationType === "terminated") return "termination";
  return SEPARATION_TYPES.includes(separationType as SeparationType)
    ? (separationType as SeparationType)
    : null;
}

export function getSeparationTypeLabel(type: SeparationType): string {
  return SEPARATION_TYPE_LABELS[type];
}
