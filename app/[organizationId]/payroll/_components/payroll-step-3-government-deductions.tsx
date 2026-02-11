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
}

export function PayrollStep3GovernmentDeductions({
  employees,
  selectedEmployees,
  governmentDeductionSettings,
  deductionsEnabled,
  onDeductionsEnabledChange,
  onUpdateGovernmentDeduction,
}: PayrollStep3GovernmentDeductionsProps) {
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
          When enabled, full monthly SSS, PhilHealth, Pag-IBIG, and withholding
          tax are applied. Use the per-employee checkboxes below to override
          (e.g. skip deductions for a specific employee this run).
        </p>
        {!deductionsEnabled && (
          <p className="text-sm text-amber-600 font-medium">
            Deductions are off for this run — no SSS, PhilHealth, Pag-IBIG, or
            tax will be applied to any employee.
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
                    { key: "sss", label: "SSS" },
                    { key: "pagibig", label: "Pag-IBIG" },
                    { key: "philhealth", label: "PhilHealth" },
                    { key: "tax", label: "Withholding Tax" },
                  ].map(({ key, label }) => (
                    <div
                      key={key}
                      className="flex items-center gap-4 border-b pb-3"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            govSettings[
                              key as "sss" | "pagibig" | "philhealth" | "tax"
                            ].enabled
                          }
                          disabled={!deductionsEnabled}
                          onChange={(e) =>
                            onUpdateGovernmentDeduction(
                              employeeId,
                              key as "sss" | "pagibig" | "philhealth" | "tax",
                              "enabled",
                              e.target.checked
                            )
                          }
                          className="h-4 w-4 accent-purple-600 disabled:opacity-50"
                        />
                        <Label className="font-medium w-32">{label}</Label>
                      </div>
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
