"use client";

import { Suspense } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EditPayrollStep1Dates } from "./edit-payroll-step-1-dates";
import { PayrollStep2Employees } from "./payroll-step-2-employees";
import { PayrollStep3GovernmentDeductions } from "./payroll-step-3-government-deductions";
import { PayrollStep4DeductionsIncentives } from "./payroll-step-4-deductions-incentives";

import type { GovernmentDeductionSettings } from "../page"; // if exported; otherwise use any

interface EmployeeDeduction {
  employeeId: string;
  deductions: any[];
}

interface EmployeeIncentive {
  employeeId: string;
  incentives: any[];
}

interface EditPayrollRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: any[];
  editPayrollStep: number;
  editCutoffStart: string;
  editCutoffEnd: string;
  editSelectedEmployees: string[];
  editGovernmentDeductionSettings: GovernmentDeductionSettings[];
  editEmployeeDeductions: EmployeeDeduction[];
  editEmployeeIncentives: EmployeeIncentive[];
  isSavingPayrollRun: boolean;
  onCutoffStartChange: (value: string) => void;
  onCutoffEndChange: (value: string) => void;
  setEditPayrollStep: (step: number) => void;
  onUpdateGovernmentDeduction: (
    employeeId: string,
    deductionType: "sss" | "pagibig" | "philhealth" | "tax",
    field: "enabled" | "frequency",
    value: boolean | "full" | "half"
  ) => void;
  onSelectEmployeesChange: (ids: string[]) => void;
  setEditGovernmentDeductionSettings: (settings: GovernmentDeductionSettings[]) => void;
  setEditEmployeeDeductions: (deductions: EmployeeDeduction[]) => void;
  setEditEmployeeIncentives: (incentives: EmployeeIncentive[]) => void;
  onSavePayrollRun: () => void;
  toast: (opts: { title: string; description: string; variant?: "destructive" }) => void;
}

export function EditPayrollRunDialog({
  open,
  onOpenChange,
  employees,
  editPayrollStep,
  editCutoffStart,
  editCutoffEnd,
  editSelectedEmployees,
  editGovernmentDeductionSettings,
  editEmployeeDeductions,
  editEmployeeIncentives,
  isSavingPayrollRun,
  onCutoffStartChange,
  onCutoffEndChange,
  setEditPayrollStep,
  onUpdateGovernmentDeduction,
  onSelectEmployeesChange,
  setEditGovernmentDeductionSettings,
  setEditEmployeeDeductions,
  setEditEmployeeIncentives,
  onSavePayrollRun,
  toast,
}: EditPayrollRunDialogProps) {
  const handleSelectAll = () => {
    if (editSelectedEmployees.length === employees?.length) {
      onSelectEmployeesChange([]);
      setEditGovernmentDeductionSettings([]);
      setEditEmployeeDeductions([]);
      setEditEmployeeIncentives([]);
    } else {
      const allEmployeeIds: string[] = employees?.map((e: any) => e._id) || [];
      onSelectEmployeesChange(allEmployeeIds);
      const allGovSettings: GovernmentDeductionSettings[] =
        allEmployeeIds.map((employeeId: string) => ({
          employeeId,
          sss: { enabled: true, frequency: "full" },
          pagibig: { enabled: true, frequency: "full" },
          philhealth: { enabled: true, frequency: "full" },
          tax: { enabled: true, frequency: "full" },
        }));
      setEditGovernmentDeductionSettings(allGovSettings);
      const allDeductions: EmployeeDeduction[] = allEmployeeIds.map(
        (employeeId: string) => ({
          employeeId,
          deductions: [],
        })
      );
      setEditEmployeeDeductions(allDeductions);
      const allIncentives: EmployeeIncentive[] = allEmployeeIds.map(
        (employeeId: string) => ({
          employeeId,
          incentives: [],
        })
      );
      setEditEmployeeIncentives(allIncentives);
    }
  };

  const handleNext = () => {
    if (editPayrollStep === 1) {
      if (!editCutoffStart || !editCutoffEnd) {
        toast({
          title: "Validation Error",
          description: "Please select cutoff dates",
          variant: "destructive",
        });
        return;
      }
      setEditPayrollStep(2);
    } else if (editPayrollStep === 2) {
      if (editSelectedEmployees.length === 0) {
        toast({
          title: "Validation Error",
          description: "Please select at least one employee",
          variant: "destructive",
        });
        return;
      }
      setEditPayrollStep(3);
    } else if (editPayrollStep === 3) {
      setEditPayrollStep(4);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Payroll Run</DialogTitle>
          <DialogDescription>
            Step {editPayrollStep} of 4: {" "}
            {editPayrollStep === 1 && "Select Period"}
            {editPayrollStep === 2 && "Select Employees"}
            {editPayrollStep === 3 && "Government Deductions"}
            {editPayrollStep === 4 && "Deductions & Incentives"}
          </DialogDescription>
        </DialogHeader>

        {editPayrollStep === 1 && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <EditPayrollStep1Dates
              cutoffStart={editCutoffStart}
              cutoffEnd={editCutoffEnd}
              onCutoffStartChange={onCutoffStartChange}
              onCutoffEndChange={onCutoffEndChange}
            />
          </Suspense>
        )}

        {editPayrollStep === 2 && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <PayrollStep2Employees
              employees={employees || []}
              selectedEmployees={editSelectedEmployees}
              onEmployeeSelect={(employeeId: string, checked: boolean) => {
                if (checked) {
                  const newSelected = [...editSelectedEmployees, employeeId];
                  onSelectEmployeesChange(newSelected);
                  if (
                    !editGovernmentDeductionSettings.find(
                      (gs) => gs.employeeId === employeeId
                    )
                  ) {
                    setEditGovernmentDeductionSettings([
                      ...editGovernmentDeductionSettings,
                      {
                        employeeId,
                        sss: { enabled: true, frequency: "full" },
                        pagibig: { enabled: true, frequency: "full" },
                        philhealth: { enabled: true, frequency: "full" },
                        tax: { enabled: true, frequency: "full" },
                      },
                    ]);
                  }
                  if (
                    !editEmployeeDeductions.find(
                      (ed) => ed.employeeId === employeeId
                    )
                  ) {
                    setEditEmployeeDeductions([
                      ...editEmployeeDeductions,
                      { employeeId, deductions: [] },
                    ]);
                  }
                  if (
                    !editEmployeeIncentives.find(
                      (ei) => ei.employeeId === employeeId
                    )
                  ) {
                    setEditEmployeeIncentives([
                      ...editEmployeeIncentives,
                      { employeeId, incentives: [] },
                    ]);
                  }
                } else {
                  onSelectEmployeesChange(
                    editSelectedEmployees.filter((id) => id !== employeeId)
                  );
                  setEditGovernmentDeductionSettings(
                    editGovernmentDeductionSettings.filter(
                      (gs) => gs.employeeId !== employeeId
                    )
                  );
                  setEditEmployeeDeductions(
                    editEmployeeDeductions.filter(
                      (ed) => ed.employeeId !== employeeId
                    )
                  );
                  setEditEmployeeIncentives(
                    editEmployeeIncentives.filter(
                      (ei) => ei.employeeId !== employeeId
                    )
                  );
                }
              }}
              onSelectAll={handleSelectAll}
            />
          </Suspense>
        )}

        {editPayrollStep === 3 && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <PayrollStep3GovernmentDeductions
              employees={employees || []}
              selectedEmployees={editSelectedEmployees}
              governmentDeductionSettings={editGovernmentDeductionSettings}
              onUpdateGovernmentDeduction={onUpdateGovernmentDeduction}
            />
          </Suspense>
        )}

        {editPayrollStep === 4 && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <PayrollStep4DeductionsIncentives
              employees={employees || []}
              selectedEmployees={editSelectedEmployees}
              employeeDeductions={editEmployeeDeductions}
              employeeIncentives={editEmployeeIncentives}
              onAddDeduction={(employeeId: string) => {
                const updated = editEmployeeDeductions.map((ed) => {
                  if (ed.employeeId === employeeId) {
                    return {
                      ...ed,
                      deductions: [
                        ...ed.deductions,
                        { name: "", amount: 0, type: "custom" },
                      ],
                    };
                  }
                  return ed;
                });
                if (!updated.find((ed) => ed.employeeId === employeeId)) {
                  updated.push({
                    employeeId,
                    deductions: [{ name: "", amount: 0, type: "custom" }],
                  });
                }
                setEditEmployeeDeductions(updated);
              }}
              onRemoveDeduction={(employeeId: string, index: number) => {
                const updated = editEmployeeDeductions.map((ed) => {
                  if (ed.employeeId === employeeId) {
                    return {
                      ...ed,
                      deductions: ed.deductions.filter((_, i) => i !== index),
                    };
                  }
                  return ed;
                });
                setEditEmployeeDeductions(updated);
              }}
              onUpdateDeduction={(
                employeeId: string,
                index: number,
                field: "name" | "amount" | "type",
                value: string | number
              ) => {
                const updated = editEmployeeDeductions.map((ed) => {
                  if (ed.employeeId === employeeId) {
                    const newDeductions = [...ed.deductions];
                    newDeductions[index] = {
                      ...newDeductions[index],
                      [field]: value,
                    };
                    return { ...ed, deductions: newDeductions };
                  }
                  return ed;
                });
                setEditEmployeeDeductions(updated);
              }}
              onAddIncentive={(employeeId: string) => {
                const updated = editEmployeeIncentives.map((ei) => {
                  if (ei.employeeId === employeeId) {
                    return {
                      ...ei,
                      incentives: [
                        ...ei.incentives,
                        { name: "", amount: 0, type: "incentive" },
                      ],
                    };
                  }
                  return ei;
                });
                if (!updated.find((ei) => ei.employeeId === employeeId)) {
                  updated.push({
                    employeeId,
                    incentives: [
                      { name: "", amount: 0, type: "incentive" },
                    ],
                  });
                }
                setEditEmployeeIncentives(updated);
              }}
              onRemoveIncentive={(employeeId: string, index: number) => {
                const updated = editEmployeeIncentives.map((ei) => {
                  if (ei.employeeId === employeeId) {
                    return {
                      ...ei,
                      incentives: ei.incentives.filter((_, i) => i !== index),
                    };
                  }
                  return ei;
                });
                setEditEmployeeIncentives(updated);
              }}
              onUpdateIncentive={(
                employeeId: string,
                index: number,
                field: "name" | "amount" | "type",
                value: string | number
              ) => {
                const updated = editEmployeeIncentives.map((ei) => {
                  if (ei.employeeId === employeeId) {
                    const newIncentives = [...ei.incentives];
                    newIncentives[index] = {
                      ...newIncentives[index],
                      [field]: value,
                    };
                    return { ...ei, incentives: newIncentives };
                  }
                  return ei;
                });
                setEditEmployeeIncentives(updated);
              }}
            />
          </Suspense>
        )}

        <DialogFooter>
          <div className="flex justify-between w-full">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (editPayrollStep > 1) {
                  setEditPayrollStep(editPayrollStep - 1);
                } else {
                  onOpenChange(false);
                }
              }}
              disabled={isSavingPayrollRun}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              {editPayrollStep === 1 ? "Cancel" : "Back"}
            </Button>
            <div className="flex gap-2">
              {editPayrollStep < 4 && (
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={isSavingPayrollRun}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )}
              {editPayrollStep === 4 && (
                <Button
                  type="button"
                  onClick={onSavePayrollRun}
                  disabled={isSavingPayrollRun}
                >
                  {isSavingPayrollRun ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
