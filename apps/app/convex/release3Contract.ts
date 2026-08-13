import {
  FULL_SCHEMA_FIELD_OVERRIDES,
  type CurrentSchemaTable,
} from "./fullSchemaInventory";

export const RELEASE_3_CONTRACT_KEY = "full-schema-release-3-contract" as const;
export const RELEASE_3_CONTRACT_VERSION = 1 as const;

export type Release3Removal = {
  table: CurrentSchemaTable;
  field: string;
  target?: string;
  clearStrategy: "unset" | "nested_unset";
};

const isRelease3Removal = ({
  table,
  field,
  classification,
}: (typeof FULL_SCHEMA_FIELD_OVERRIDES)[number]): boolean =>
  (classification === "compatibility_read" ||
    classification === "compatibility_write" ||
    classification === "removable") &&
  !(table === "attendance" && field === "status");

export const RELEASE_3_REMOVALS: readonly Release3Removal[] =
  FULL_SCHEMA_FIELD_OVERRIDES.filter(isRelease3Removal).map(
    ({ table, field, target }) => ({
      table,
      field,
      ...(target !== undefined ? { target } : {}),
      clearStrategy: field.includes(".") ? "nested_unset" : "unset",
    }),
  );

export function resolveRelease3ProgramReadiness(input: {
  domainsReady: boolean;
  compatibilitySwitched: boolean;
  cleanupAuditReady: boolean;
}): { readyForRelease3B: boolean; blockers: string[] } {
  const blockers = [
    ...(!input.domainsReady ? ["ADDITIVE_MIGRATIONS_NOT_READY"] : []),
    ...(!input.compatibilitySwitched ? ["COMPATIBILITY_SWITCH_NOT_READY"] : []),
    ...(!input.cleanupAuditReady
      ? ["RELEASE_3_CONTRACT_AUDIT_NOT_READY"]
      : []),
  ];
  return { readyForRelease3B: blockers.length === 0, blockers };
}
