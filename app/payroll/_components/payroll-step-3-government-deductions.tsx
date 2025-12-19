"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface GovernmentDeductionSettings {
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
  onUpdateGovernmentDeduction,
}: PayrollStep3GovernmentDeductionsProps) {
  return (
    <div className="grid gap-4 py-4">
      <div className="space-y-4">
        <Label>Configure Government Deductions</Label>
        <p className="text-sm text-gray-500">
          Enable/disable government deductions and choose frequency (full per
          cutoff or half per cutoff for monthly deductions).
        </p>
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
                          onChange={(e) =>
                            onUpdateGovernmentDeduction(
                              employeeId,
                              key as "sss" | "pagibig" | "philhealth" | "tax",
                              "enabled",
                              e.target.checked
                            )
                          }
                          className="h-4 w-4 accent-purple-600"
                        />
                        <Label className="font-medium w-32">{label}</Label>
                      </div>
                      {govSettings[
                        key as "sss" | "pagibig" | "philhealth" | "tax"
                      ].enabled && (
                        <div className="flex items-center gap-2">
                          <Label className="text-sm">Frequency:</Label>
                          <select
                            value={
                              govSettings[
                                key as "sss" | "pagibig" | "philhealth" | "tax"
                              ].frequency
                            }
                            onChange={(e) =>
                              onUpdateGovernmentDeduction(
                                employeeId,
                                key as "sss" | "pagibig" | "philhealth" | "tax",
                                "frequency",
                                e.target.value as "full" | "half"
                              )
                            }
                            className="px-3 py-1 border rounded-md text-sm"
                          >
                            <option value="half">Half (Monthly split)</option>
                            <option value="full">Full (Per cutoff)</option>
                          </select>
                        </div>
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
