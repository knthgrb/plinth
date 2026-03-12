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
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { create13thMonthRun } from "@/actions/payroll";
import { PayrollRunsTable } from "./payroll-runs-table";

interface ThirteenthMonthTabProps {
  organizationId: string;
  payrollRuns: any[];
  onLoadPayrollRuns: () => void;
  onViewSummary: (run: any) => void;
  onViewPayslips: (run: any) => void;
  onEdit: (run: any) => void;
  onStatusChange: (run: any, status: string) => void;
  onDelete: (run: any) => void;
}

export function ThirteenthMonthTab({
  organizationId,
  payrollRuns,
  onLoadPayrollRuns,
  onViewSummary,
  onViewPayslips,
  onEdit,
  onStatusChange,
  onDelete,
}: ThirteenthMonthTabProps) {
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

  const amounts = useQuery(
    (api as any).payroll.compute13thMonthAmounts,
    organizationId && selectedYear
      ? {
          organizationId,
          year: selectedYear,
          employeeIds: employees?.map((e: any) => e._id) ?? undefined,
        }
      : "skip",
  );

  const thirteenthMonthRuns = payrollRuns.filter(
    (r: any) => (r.runType ?? "regular") === "13th_month",
  );

  const filteredRuns = thirteenthMonthRuns.filter(
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
      (a: any) => a.thirteenthMonthAmount > 0,
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
        description: "Select at least one employee to generate 13th month pay.",
        variant: "destructive",
      });
      return;
    }

    const withAmount = (amounts ?? []).filter((a: any) =>
      selectedEmployeeIds.includes(a.employeeId),
    );
    const withPositiveAmount = withAmount.filter(
      (a: any) => a.thirteenthMonthAmount > 0,
    );
    if (withPositiveAmount.length === 0) {
      toast({
        title: "No 13th month amount",
        description:
          "Selected employees have no basic pay for this year. Cannot generate.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      await create13thMonthRun({
        organizationId,
        year: selectedYear,
        employeeIds: withPositiveAmount.map((a: any) => a.employeeId),
      });
      onLoadPayrollRuns();
      setIsDialogOpen(false);
      setSelectedEmployeeIds([]);
      toast({
        title: "Success",
        description: "13th month payroll run created successfully!",
        variant: "success",
      });
    } catch (error: any) {
      console.error("Error creating 13th month run:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create 13th month run",
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
        <div className="flex items-center gap-4">
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
                Generate 13th Month
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Generate 13th Month Pay</DialogTitle>
                <p className="text-sm text-gray-500">
                  Select employees to include. 13th month = sum of basic pay for{" "}
                  {selectedYear} ÷ 12.
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
                      (a: any) => a.thirteenthMonthAmount > 0,
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
                          Total Basic Pay ({selectedYear})
                        </TableHead>
                        <TableHead className="text-right">
                          13th Month Amount
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {amounts === undefined ? (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center py-8 text-gray-500"
                          >
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            Computing amounts...
                          </TableCell>
                        </TableRow>
                      ) : (amounts ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={4}
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
                          const isDisabled = row.thirteenthMonthAmount <= 0;
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
                                ₱
                                {row.totalBasicPay.toLocaleString("en-PH", {
                                  minimumFractionDigits: 2,
                                })}
                              </TableCell>
                              <TableCell className="text-right">
                                ₱
                                {row.thirteenthMonthAmount.toLocaleString(
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
                    "Generate 13th Month"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>13th Month Runs ({selectedYear})</CardTitle>
          <p className="text-sm text-gray-500">
            Payroll runs for 13th month pay. View payslips and manage status.
          </p>
        </CardHeader>
        <CardContent>
          {filteredRuns.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="mb-2">No 13th month runs for {selectedYear}</p>
              <p className="text-sm">
                Click &quot;Generate 13th Month&quot; to create a run.
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
