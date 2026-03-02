"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

interface Deduction {
  name: string;
  amount: number;
  type: string;
}

interface EmployeeDeduction {
  employeeId: string;
  deductions: Deduction[];
}

interface EmployeeIncentive {
  employeeId: string;
  incentives: Deduction[];
}

interface PayrollStep4DeductionsIncentivesProps {
  employees: any[];
  selectedEmployees: string[];
  employeeDeductions: EmployeeDeduction[];
  employeeIncentives: EmployeeIncentive[];
  onAddDeduction: (employeeId: string) => void;
  onRemoveDeduction: (employeeId: string, index: number) => void;
  onUpdateDeduction: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
  ) => void;
  onAddIncentive: (employeeId: string) => void;
  onRemoveIncentive: (employeeId: string, index: number) => void;
  onUpdateIncentive: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
  ) => void;
}

export function PayrollStep4DeductionsIncentives({
  employees,
  selectedEmployees,
  employeeDeductions,
  employeeIncentives,
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
  onAddIncentive,
  onRemoveIncentive,
  onUpdateIncentive,
}: PayrollStep4DeductionsIncentivesProps) {
  return (
    <div className="grid gap-4 py-4">
      <div className="space-y-6">
        {/* Deductions Section */}
        <div className="space-y-4">
          <Label>Enter Other Deductions (Loans, etc.)</Label>
          <p className="text-sm text-gray-500">
            Add custom deductions like loans, advances, etc. These are inputted
            by accounting.
          </p>
          <div className="space-y-6 max-h-96 overflow-y-auto">
            {selectedEmployees.map((employeeId: string) => {
              const employee = employees?.find(
                (e: any) => e._id === employeeId
              );
              const empDeductions = employeeDeductions.find(
                (ed) => ed.employeeId === employeeId
              ) || { employeeId, deductions: [] };

              return (
                <Card key={employeeId}>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {employee?.personalInfo.firstName}{" "}
                      {employee?.personalInfo.lastName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {empDeductions.deductions.map((deduction, idx) => (
                      <div key={idx} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Label>Deduction Name</Label>
                          <Input
                            value={deduction.name}
                            onChange={(e) =>
                              onUpdateDeduction(
                                employeeId,
                                idx,
                                "name",
                                e.target.value
                              )
                            }
                            placeholder="e.g., Loan, Advance, etc."
                          />
                        </div>
                        <div className="w-32">
                          <Label>Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={
                              deduction.amount === 0 ? "" : deduction.amount
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === "-") {
                                onUpdateDeduction(employeeId, idx, "amount", 0);
                              } else {
                                const numVal = parseFloat(val);
                                if (!isNaN(numVal)) {
                                  onUpdateDeduction(
                                    employeeId,
                                    idx,
                                    "amount",
                                    numVal
                                  );
                                }
                              }
                            }}
                            placeholder="0.00"
                          />
                        </div>
                        <div className="w-32">
                          <Label>Type</Label>
                          <Input
                            value={deduction.type}
                            onChange={(e) =>
                              onUpdateDeduction(
                                employeeId,
                                idx,
                                "type",
                                e.target.value
                              )
                            }
                            placeholder="loan/advance"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveDeduction(employeeId, idx)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onAddDeduction(employeeId)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Deduction
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Incentives Section */}
        <div className="space-y-4">
          <Label>Enter Incentives</Label>
          <p className="text-sm text-gray-500">
            Add incentives, bonuses, or other earnings for each employee.
          </p>
          <div className="space-y-6 max-h-96 overflow-y-auto">
            {selectedEmployees.map((employeeId: string) => {
              const employee = employees?.find(
                (e: any) => e._id === employeeId
              );
              const empIncentives = employeeIncentives.find(
                (ei) => ei.employeeId === employeeId
              ) || { employeeId, incentives: [] };

              return (
                <Card key={employeeId}>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {employee?.personalInfo.firstName}{" "}
                      {employee?.personalInfo.lastName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {empIncentives.incentives.map((incentive, idx) => (
                      <div key={idx} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Label>Incentive Name</Label>
                          <Input
                            value={incentive.name}
                            onChange={(e) =>
                              onUpdateIncentive(
                                employeeId,
                                idx,
                                "name",
                                e.target.value
                              )
                            }
                            placeholder="e.g., Bonus, Commission, etc."
                          />
                        </div>
                        <div className="w-32">
                          <Label>Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={
                              incentive.amount === 0 ? "" : incentive.amount
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === "-") {
                                onUpdateIncentive(employeeId, idx, "amount", 0);
                              } else {
                                const numVal = parseFloat(val);
                                if (!isNaN(numVal)) {
                                  onUpdateIncentive(
                                    employeeId,
                                    idx,
                                    "amount",
                                    numVal
                                  );
                                }
                              }
                            }}
                            placeholder="0.00"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveIncentive(employeeId, idx)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onAddIncentive(employeeId)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Incentive
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
