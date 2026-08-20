"use client";

import { useEffect, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { rehireEmployee } from "@/actions/employees";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmploymentTypeSelect,
  type EmploymentType,
} from "@/components/ui/employment-type-select";
import { useToast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";

type RehireEmployeeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    _id: Id<"employees">;
    personalInfo: { firstName: string; lastName: string };
    employment: {
      position: string;
      department: string;
      employmentType: EmploymentType;
    };
  };
  hasMembership: boolean;
  onSuccess: () => void;
};

function getTodayDateInput(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function RehireEmployeeDialog({
  open,
  onOpenChange,
  employee,
  hasMembership,
  onSuccess,
}: RehireEmployeeDialogProps) {
  const { toast } = useToast();
  const [hireDate, setHireDate] = useState(getTodayDateInput);
  const [position, setPosition] = useState(employee.employment.position);
  const [department, setDepartment] = useState(employee.employment.department);
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    employee.employment.employmentType,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [restoreAccess, setRestoreAccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHireDate(getTodayDateInput());
    setPosition(employee.employment.position);
    setDepartment(employee.employment.department);
    setEmploymentType(employee.employment.employmentType);
    setRestoreAccess(false);
  }, [employee, open]);

  const handleSubmit = async () => {
    const hireDateValue = new Date(`${hireDate}T00:00:00`).getTime();
    if (
      !hireDate ||
      Number.isNaN(hireDateValue) ||
      !position.trim() ||
      !department.trim()
    ) {
      toast({
        title: "Complete the rehire details",
        description: "Hire date, position, and department are required.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await rehireEmployee({
        employeeId: employee._id,
        hireDate: hireDateValue,
        position: position.trim(),
        department: department.trim(),
        employmentType,
        restoreAccess: hasMembership && restoreAccess,
        role: hasMembership && restoreAccess ? "employee" : undefined,
      });
      toast({
        title: "Employee rehired",
        description: hasMembership
          ? restoreAccess
            ? "The employee is active and account access was restored with the Employee role."
            : "The employee is active, but their organization account remains suspended."
          : "The employee record is active again without an organization account.",
      });
      onOpenChange(false);
      onSuccess();
    } catch (error: unknown) {
      toast({
        title: "Could not rehire employee",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rehire employee</DialogTitle>
          <DialogDescription>
            Restore {employee.personalInfo.firstName}{" "}
            {employee.personalInfo.lastName}
            {hasMembership
              ? ". Choose whether their existing organization access should also be restored."
              : " as an active employee record."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="rehire-date" required>
              New hire date
            </Label>
            <Input
              id="rehire-date"
              type="date"
              value={hireDate}
              onChange={(event) => setHireDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rehire-position" required>
              Position
            </Label>
            <Input
              id="rehire-position"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rehire-department" required>
              Department
            </Label>
            <Input
              id="rehire-department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label required>Employment type</Label>
            <EmploymentTypeSelect
              value={employmentType}
              onValueChange={setEmploymentType}
            />
          </div>
          {hasMembership && (
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox
                id="rehire-restore-access"
                checked={restoreAccess}
                onCheckedChange={(checked) =>
                  setRestoreAccess(checked === true)
                }
              />
              <div className="space-y-1">
                <Label htmlFor="rehire-restore-access">
                  Restore organization access
                </Label>
                <p className="text-sm text-muted-foreground">
                  Restores access with the Employee role. Privileged roles must
                  be assigned separately.
                </p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? "Rehiring…" : "Rehire employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
