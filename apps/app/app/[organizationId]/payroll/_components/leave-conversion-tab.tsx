"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { createLeaveConversionRun } from "@/actions/payroll";
import { PayrollRunsTable } from "./payroll-runs-table";

interface LeaveConversionTabProps {
  organizationId: string;
  payrollRuns: any[];
  onLoadPayrollRuns: () => void;
  onViewSummary: (run: any) => void;
  onViewPayslips: (run: any) => void;
  onEdit: (run: any) => void;
  onStatusChange: (run: any, status: string) => void;
  onDelete: (run: any) => void;
}

export function LeaveConversionTab({
  organizationId,
  payrollRuns,
  onLoadPayrollRuns,
  onViewSummary,
  onViewPayslips,
  onEdit,
  onStatusChange,
  onDelete,
}: LeaveConversionTabProps) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const employees = useQuery(
    (api as any).employees.getEmployees,
    organizationId ? { organizationId } : "skip",
  );

  const settings = useQuery(
    (api as any).settings.getSettings,
    organizationId ? { organizationId } : "skip",
  );

  const maxConvertibleDays = settings?.maxConvertibleLeaveDays ?? 5;

  const amounts = useQuery(
    (api as any).payroll.computeLeaveConversionAmounts,
    organizationId && selectedYear
      ? {
          organizationId,
          year: selectedYear,
          employeeIds: employees?.map((e: any) => e._id) ?? undefined,
        }
      : "skip",
  );

  const leaveConversionRuns = payrollRuns.filter(
    (r: any) => (r.runType ?? "regular") === "leave_conversion",
  );

  const filteredRuns = leaveConversionRuns.filter(
    (r: any) => r.year === selectedYear || !r.year,
  );

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId],
    );
  };

  const selectAll = () => {
    const withAmount = (amounts ?? []).filter(
      (a: any) => a.leaveConversionAmount > 0,
    );
    if (selectedEmployeeIds.length === withAmount.length) {
      setSelectedEmployeeIds([]);
    } else {
      setSelectedEmployeeIds(withAmount.map((a: any) => a.employeeId));
    }
  };

  const handleGenerate = async () => {
    if (selectedEmployeeIds.length === 0) {
      toast({
        title: "No employees selected",
        description:
          "Select at least one employee to generate leave conversion pay.",
        variant: "destructive",
      });
      return;
    }

    const withAmount = (amounts ?? []).filter((a: any) =>
      selectedEmployeeIds.includes(a.employeeId),
    );
    const withPositiveAmount = withAmount.filter(
      (a: any) => a.leaveConversionAmount > 0,
    );
    if (withPositiveAmount.length === 0) {
      toast({
        title: "No leave conversion amount",
        description:
          "Selected employees have no convertible leave balance for this year.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      await createLeaveConversionRun({
        organizationId,
        year: selectedYear,
        employeeIds: withPositiveAmount.map((a: any) => a.employeeId),
      });
      onLoadPayrollRuns();
      setIsDialogOpen(false);
      setSelectedEmployeeIds([]);
      toast({
        title: "Success",
        description: "Leave conversion payroll run created successfully!",
      });
    } catch (error: any) {
      console.error("Error creating leave conversion run:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create leave conversion run",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-gray-600">
            Convert unused leave credits (first {maxConvertibleDays} days) to
            cash. Uses leave tracker balance for the selected year × daily rate.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Year
              </label>
              <Select
                value={selectedYear.toString()}
                onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="mt-6">
                  <Plus className="mr-2 h-4 w-4" />
                  Generate Leave Conversion
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Generate Leave Conversion</DialogTitle>
                  <p className="text-sm text-gray-500">
                    Select employees to include. First {maxConvertibleDays} days
                    of unused leave × daily rate for {selectedYear}.
                  </p>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={selectAll}
                    >
                      {selectedEmployeeIds.length ===
                      (amounts ?? []).filter(
                        (a: any) => a.leaveConversionAmount > 0,
                      ).length
                        ? "Deselect all"
                        : "Select all with amount"}
                    </Button>
                  </div>
                  <div className="border rounded-md max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Employee</TableHead>
                          <TableHead className="text-right">
                            Convertible Days
                          </TableHead>
                          <TableHead className="text-right">
                            Daily Rate
                          </TableHead>
                          <TableHead className="text-right">
                            Amount
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {amounts === undefined ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center py-8 text-gray-500"
                            >
                              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                              Computing amounts...
                            </TableCell>
                          </TableRow>
                        ) : (amounts ?? []).length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center py-8 text-gray-500"
                            >
                              No employees found
                            </TableCell>
                          </TableRow>
                        ) : (
                          (amounts ?? []).map((row: any) => {
                            const name =
                              row.employee?.personalInfo?.firstName &&
                              row.employee?.personalInfo?.lastName
                                ? `${row.employee.personalInfo.firstName} ${row.employee.personalInfo.lastName}`
                                : "Employee";
                            const isDisabled =
                              row.leaveConversionAmount <= 0;
                            return (
                              <TableRow key={row.employeeId}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedEmployeeIds.includes(
                                      row.employeeId,
                                    )}
                                    onCheckedChange={() =>
                                      !isDisabled &&
                                      toggleEmployee(row.employeeId)
                                    }
                                    disabled={isDisabled}
                                  />
                                </TableCell>
                                <TableCell>{name}</TableCell>
                                <TableCell className="text-right">
                                  {row.convertibleDays.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right">
                                  ₱
                                  {row.dailyRate.toLocaleString("en-PH", {
                                    minimumFractionDigits: 2,
                                  })}
                                </TableCell>
                                <TableCell className="text-right">
                                  ₱
                                  {row.leaveConversionAmount.toLocaleString(
                                    "en-PH",
                                    { minimumFractionDigits: 2 },
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                    disabled={isGenerating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      "Generate Leave Conversion"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leave Conversion Runs ({selectedYear})</CardTitle>
          <p className="text-sm text-gray-500">
            Payroll runs for leave-to-cash conversion. View payslips and manage
            status.
          </p>
        </CardHeader>
        <CardContent>
          {filteredRuns.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="mb-2">No leave conversion runs for {selectedYear}</p>
              <p className="text-sm">
                Click &quot;Generate Leave Conversion&quot; to create a run.
              </p>
            </div>
          ) : (
            <PayrollRunsTable
              payrollRuns={filteredRuns}
              onViewSummary={onViewSummary}
              onViewPayslips={onViewPayslips}
              onEdit={onEdit}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
