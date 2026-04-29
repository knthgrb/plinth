"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export interface GovernmentDeductionSettings {
  employeeId: string;
  sss: { enabled: boolean; frequency: "full" | "half" };
  pagibig: { enabled: boolean; frequency: "full" | "half" };
  philhealth: { enabled: boolean; frequency: "full" | "half" };
  tax: { enabled: boolean; frequency: "full" | "half" };
}

/** Tax settings from org - withholding tax follows these independently of "Enable government deductions" */
export type TaxSettings = {
  taxDeductionFrequency: "once_per_month" | "twice_per_month";
  taxDeductOnPay: "first" | "second";
};

interface PayrollStep3GovernmentDeductionsProps {
  employees: any[];
  selectedEmployees: string[];
  governmentDeductionSettings: GovernmentDeductionSettings[];
  deductionsEnabled: boolean;
  onDeductionsEnabledChange: (enabled: boolean) => void;
  onUpdateGovernmentDeduction: (
    employeeId: string,
    deductionType: "sss" | "pagibig" | "philhealth" | "tax",
    field: "enabled" | "frequency",
    value: boolean | "full" | "half"
  ) => void;
  /** Org tax settings - withholding tax is enabled based on these (independent of deductionsEnabled) */
  taxSettings?: TaxSettings;
  /** Cutoff start timestamp - used to determine if this is 1st or 2nd pay for once_per_month */
  cutoffStart?: number;
}

/** Used by Step 4 to know if withholding tax applies for this pay (org schedule). */
export function isTaxEnabledForRun(
  taxSettings: TaxSettings,
  cutoffStart?: number
): boolean {
  if (taxSettings.taxDeductionFrequency === "twice_per_month") return true;
  if (!cutoffStart) return true; // default enabled when unknown
  const dayOfMonth = new Date(cutoffStart).getDate();
  const isFirstPay = dayOfMonth <= 15;
  return taxSettings.taxDeductOnPay === "first" ? isFirstPay : !isFirstPay;
}

export function PayrollStep3GovernmentDeductions({
  employees,
  selectedEmployees,
  governmentDeductionSettings,
  deductionsEnabled,
  onDeductionsEnabledChange,
  onUpdateGovernmentDeduction,
  taxSettings = {
    taxDeductionFrequency: "twice_per_month",
    taxDeductOnPay: "first",
  },
  cutoffStart,
}: PayrollStep3GovernmentDeductionsProps) {
  const taxEnabledForRun = isTaxEnabledForRun(taxSettings, cutoffStart);
  const taxNote =
    taxSettings.taxDeductionFrequency === "twice_per_month"
      ? "Based on org settings (tax deducted twice per month)."
      : taxEnabledForRun
        ? `Based on org settings (full tax on ${taxSettings.taxDeductOnPay === "first" ? "1st" : "2nd"} pay).`
        : "Not applicable this pay (org settings: full tax on other pay only).";

  return (
    <div className="grid gap-4 py-4">
      <div className="space-y-4">
        <div className="flex items-center space-x-2 border-b pb-4">
          <Checkbox
            id="deductions-enabled"
            checked={deductionsEnabled}
            onCheckedChange={(checked) =>
              onDeductionsEnabledChange(checked === true)
            }
            className="h-4 w-4"
          />
          <Label
            htmlFor="deductions-enabled"
            className="text-sm font-medium leading-none cursor-pointer"
          >
            Enable government deductions for this run
          </Label>
        </div>
        <p className="text-sm text-gray-500">
          When enabled, full monthly SSS, PhilHealth, and Pag-IBIG are applied.
          Withholding tax follows org settings independently (see note below).
          Use the per-employee checkboxes to override.
        </p>
        {!deductionsEnabled && (
          <p className="text-sm text-amber-600 font-medium">
            SSS, PhilHealth, and Pag-IBIG are off for this run. Withholding tax
            still follows org settings.
          </p>
        )}
        <div className="space-y-6 max-h-96 overflow-y-auto">
          {selectedEmployees.map((employeeId: string) => {
            const employee = employees?.find((e: any) => e._id === employeeId);
            const govSettings = governmentDeductionSettings.find(
              (gs) => gs.employeeId === employeeId
            ) || {
              employeeId,
              sss: { enabled: true, frequency: "full" },
              pagibig: { enabled: true, frequency: "full" },
              philhealth: { enabled: true, frequency: "full" },
              tax: { enabled: true, frequency: "full" },
            };

            return (
              <Card key={employeeId}>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {employee?.personalInfo.firstName}{" "}
                    {employee?.personalInfo.lastName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-gray-500">
                    Override: uncheck to skip that deduction for this employee
                    this run.
                  </p>
                  {[
                    { key: "sss", label: "SSS", disabledByMaster: true },
                    { key: "pagibig", label: "Pag-IBIG", disabledByMaster: true },
                    {
                      key: "philhealth",
                      label: "PhilHealth",
                      disabledByMaster: true,
                    },
                    {
                      key: "tax",
                      label: "Withholding Tax",
                      disabledByMaster: false,
                      note: taxNote,
                    },
                  ].map(({ key, label, disabledByMaster, note }) => (
                    <div
                      key={key}
                      className="flex flex-col gap-1 border-b pb-3"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            govSettings[
                              key as "sss" | "pagibig" | "philhealth" | "tax"
                            ].enabled
                          }
                          disabled={
                            disabledByMaster ? !deductionsEnabled : false
                          }
                          onChange={(e) =>
                            onUpdateGovernmentDeduction(
                              employeeId,
                              key as "sss" | "pagibig" | "philhealth" | "tax",
                              "enabled",
                              e.target.checked
                            )
                          }
                          className="h-4 w-4 accent-brand-purple disabled:opacity-50"
                        />
                        <Label className="font-medium w-32">{label}</Label>
                      </div>
                      {note && (
                        <p className="text-xs text-muted-foreground pl-6">
                          {note}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
