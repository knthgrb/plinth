import type {
  GovernmentDeductionSettings,
  TaxSettings,
} from "./payroll-step-3-government-deductions";
import { isTaxEnabledForRun } from "./payroll-step-3-government-deductions";

/** Canonical names used in preview / payslips (must match payroll convex). */
export const DEFAULT_GOV_DEDUCTION_LINE_NAMES = [
  "SSS",
  "PhilHealth",
  "Pag-IBIG",
  "Withholding Tax",
] as const;

export type DefaultGovDeductionLineName =
  (typeof DEFAULT_GOV_DEDUCTION_LINE_NAMES)[number];

function isDefaultGovName(name: string): name is DefaultGovDeductionLineName {
  return (DEFAULT_GOV_DEDUCTION_LINE_NAMES as readonly string[]).includes(
    (name || "").trim(),
  );
}

/**
 * Government lines that Step 3 says should apply for this employee on this run.
 * Step 4 should start from the preview with these; items not listed were turned off
 * in Step 3 and should not get a "restore" in Step 4.
 */
export function getExpectedDefaultGovLineNames(
  governmentDeductionSettings: GovernmentDeductionSettings[] | undefined,
  employeeId: string,
  deductionsEnabled: boolean,
  taxSettings: TaxSettings,
  /** Cutoff start in ms (local day), same as Step 3. */
  cutoffStartMs: number | undefined,
): DefaultGovDeductionLineName[] {
  const gs = governmentDeductionSettings?.find(
    (g) => g.employeeId === employeeId,
  );
  if (!gs) return [];
  const out: DefaultGovDeductionLineName[] = [];
  if (deductionsEnabled) {
    if (gs.sss.enabled) out.push("SSS");
    if (gs.philhealth.enabled) out.push("PhilHealth");
    if (gs.pagibig.enabled) out.push("Pag-IBIG");
  }
  if (gs.tax.enabled && isTaxEnabledForRun(taxSettings, cutoffStartMs)) {
    out.push("Withholding Tax");
  }
  return out;
}

/**
 * Default gov lines that Step 3 still expects but are missing from the current list
 * (user removed them in Step 4) — only these are restorable in Step 4.
 */
export function getRestorableDefaultGovLineNames(
  expected: readonly DefaultGovDeductionLineName[],
  deductions: { name: string }[],
): DefaultGovDeductionLineName[] {
  const present = new Set(
    deductions.map((d) => (d.name || "").trim()),
  );
  return expected.filter((name) => !present.has(name));
}

/**
 * True if the last server preview for this employee actually included a Withholding Tax line.
 * When false, the employee is below the applicable threshold (or tax was stripped by rules)—
 * do not offer "Restore Withholding Tax" in Step 4.
 */
export function serverPreviewHadWithholdingTaxLine(
  previewRow: { deductions?: { name?: string }[] } | null | undefined,
): boolean {
  return (previewRow?.deductions ?? []).some(
    (d) => (d.name || "").trim() === "Withholding Tax",
  );
}

/**
 * After {@link getRestorableDefaultGovLineNames}, drop "Withholding Tax" unless the
 * server preview for that employee would have output WHT.
 */
export function filterRestorableGovLineNamesForWithholdingReality(
  restorable: readonly DefaultGovDeductionLineName[],
  options: { previewRow?: { deductions?: { name?: string }[] } | null },
): DefaultGovDeductionLineName[] {
  return restorable.filter((name) => {
    if (name !== "Withholding Tax") return true;
    return serverPreviewHadWithholdingTaxLine(options.previewRow);
  });
}

export function isDefaultGovDeductionName(name: string): boolean {
  return isDefaultGovName(name);
}
