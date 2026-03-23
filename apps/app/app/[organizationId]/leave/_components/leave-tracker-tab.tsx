"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation } from "convex/react";
import { RotateCcw, Save } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

type TrackerOverride = {
  employeeId: string;
  annualSilOverride?: number;
  availed?: number;
};

type DraftRow = {
  annualSilOverride: string;
  availed: string;
};

type TrackerEmployee = {
  _id: string;
  personalInfo?: {
    firstName?: string;
    lastName?: string;
  };
  employment?: {
    hireDate?: number;
    regularizationDate?: number | null;
  };
  leaveCredits?: {
    vacation?: { used?: number };
    sick?: { used?: number };
  };
};

type ComputedRow = {
  employeeId: string;
  employee: TrackerEmployee;
  formulaAnnualSil: number;
  annualSilValue: number;
  anniversaryLeave: number;
  total: number;
  monthlyAccrual: number;
  accrued: number;
  availedValue: number;
  defaultAvailed: number;
};

interface LeaveTrackerTabProps {
  organizationId: string;
  employees: TrackerEmployee[];
  /** True while employees query is still loading (avoid empty state flash). */
  employeesLoading?: boolean;
  proratedLeave?: boolean;
  annualSil?: number;
  grantLeaveUponRegularization?: boolean;
  savedRows?: TrackerOverride[];
  /** Rows keyed by year; used when leaveTrackerByYear is available */
  savedRowsByYear?: Record<number, TrackerOverride[]>;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function formatNumber(value: number) {
  return roundToTwo(value).toFixed(2);
}

function formatDate(value?: number | null) {
  if (!value) return "—";
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}-${day}-${year}`;
}

function getCompletedYearsSince(
  startDate?: number | null,
  referenceDate: number = Date.now(),
) {
  if (!startDate) return 0;

  const start = new Date(startDate);
  const end = new Date(referenceDate);
  let years = end.getFullYear() - start.getFullYear();

  const monthDiff = end.getMonth() - start.getMonth();
  const dayDiff = end.getDate() - start.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }

  return Math.max(0, years);
}

function getAccrualStartMonth(startDate: number) {
  const date = new Date(startDate);
  const month = date.getMonth() + 1;
  return date.getDate() <= 15 ? month : month + 1;
}

function getProratedAnnualSil(
  annualSil: number,
  startDate: number | undefined,
  referenceDate: number,
) {
  if (!startDate) return annualSil;

  const start = new Date(startDate);
  const reference = new Date(referenceDate);

  if (start.getFullYear() < reference.getFullYear()) {
    return annualSil;
  }

  if (start.getFullYear() > reference.getFullYear()) {
    return 0;
  }

  const accrualStartMonth = getAccrualStartMonth(startDate);
  if (accrualStartMonth > 12) {
    return 0;
  }

  const monthsRemaining = 13 - accrualStartMonth;
  return roundToTwo((annualSil / 12) * monthsRemaining);
}

function getEmployeeName(employee: TrackerEmployee) {
  return (
    `${employee?.personalInfo?.lastName ?? ""}, ${employee?.personalInfo?.firstName ?? ""}`.trim() ||
    "—"
  );
}

function parseNumberOrFallback(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSameNumber(left: number | undefined, right: number) {
  if (left === undefined) return false;
  return Math.abs(left - right) < 0.005;
}

export function LeaveTrackerTab({
  organizationId,
  employees,
  employeesLoading = false,
  proratedLeave = true,
  annualSil = 8,
  grantLeaveUponRegularization = true,
  savedRows,
  savedRowsByYear,
}: LeaveTrackerTabProps) {
  const { toast } = useToast();
  const updateLeaveTracker = useMutation(api.settings.updateLeaveTracker);
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [isSaving, setIsSaving] = useState(false);
  const [draftRows, setDraftRows] = useState<Record<string, DraftRow>>({});

  // Reference date: end of selected year for historical tracking
  const referenceDate = useMemo(() => {
    return new Date(selectedYear, 11, 31).getTime();
  }, [selectedYear]);

  const currentMonthNumber = new Date(referenceDate).getMonth() + 1;

  const savedRowsMap = useMemo(() => {
    const rows =
      savedRowsByYear?.[selectedYear] ??
      (selectedYear === currentYear ? savedRows ?? [] : []);
    return Object.fromEntries((rows || []).map((row) => [row.employeeId, row]));
  }, [savedRows, savedRowsByYear, selectedYear, currentYear]);

  const sortedEmployees = useMemo(() => {
    return [...(employees || [])].sort((left, right) =>
      getEmployeeName(left).localeCompare(getEmployeeName(right)),
    );
  }, [employees]);

  const computedRows = useMemo(() => {
    return sortedEmployees.map((employee): ComputedRow => {
      const employeeId = employee._id as string;
      const regularizationDate =
        employee?.employment?.regularizationDate ?? undefined;
      const prorationStartDate = grantLeaveUponRegularization
        ? regularizationDate ?? employee?.employment?.hireDate
        : employee?.employment?.hireDate;

      const formulaAnnualSil = proratedLeave
        ? getProratedAnnualSil(
            annualSil,
            prorationStartDate,
            referenceDate,
          )
        : annualSil;
      const anniversaryLeave = getCompletedYearsSince(
        regularizationDate,
        referenceDate,
      );
      // For current year use cumulative used; for past years with no saved data use 0
      const defaultAvailed =
        selectedYear < currentYear
          ? 0
          : roundToTwo(
              Number(employee?.leaveCredits?.vacation?.used || 0) +
                Number(employee?.leaveCredits?.sick?.used || 0),
            );

      const savedRow = savedRowsMap[employeeId];
      const annualSilValue =
        savedRow?.annualSilOverride ?? formulaAnnualSil;
      const availedValue = savedRow?.availed ?? defaultAvailed;

      return {
        employeeId,
        employee,
        formulaAnnualSil,
        annualSilValue,
        anniversaryLeave,
        total: roundToTwo(annualSilValue + anniversaryLeave),
        monthlyAccrual: 0,
        accrued: 0,
        availedValue,
        defaultAvailed,
      };
    });
  }, [
    annualSil,
    currentYear,
    grantLeaveUponRegularization,
    proratedLeave,
    referenceDate,
    savedRowsMap,
    selectedYear,
    sortedEmployees,
  ]);

  useEffect(() => {
    const nextDraftRows: Record<string, DraftRow> = {};
    computedRows.forEach((row) => {
      nextDraftRows[row.employeeId] = {
        annualSilOverride: formatNumber(row.annualSilValue),
        availed: formatNumber(row.availedValue),
      };
    });
    setDraftRows(nextDraftRows);
  }, [computedRows]);

  const trackerRows = useMemo(() => {
    return computedRows.map((row) => {
      const draftRow = draftRows[row.employeeId];
      const annualSil = parseNumberOrFallback(
        draftRow?.annualSilOverride ?? formatNumber(row.annualSilValue),
        row.annualSilValue,
      );
      const total = roundToTwo(annualSil + row.anniversaryLeave);
      const monthlyAccrual = roundToTwo(total / 12);
      const accrued =
        row.employee?.employment?.hireDate &&
        row.employee.employment.hireDate > referenceDate
          ? 0
          : roundToTwo(monthlyAccrual * currentMonthNumber);
      const availed = parseNumberOrFallback(
        draftRow?.availed ?? formatNumber(row.availedValue),
        row.availedValue,
      );

      return {
        ...row,
        annualSil,
        total,
        monthlyAccrual,
        accrued,
        availed,
        balance: roundToTwo(accrued - availed),
      };
    });
  }, [computedRows, currentMonthNumber, draftRows, referenceDate]);

  const rowsToPersist = useMemo(() => {
    return trackerRows.reduce<TrackerOverride[]>((rows, row) => {
      const annualSilOverride = isSameNumber(
        row.annualSil,
        row.formulaAnnualSil,
      )
        ? undefined
        : row.annualSil;
      const availed = isSameNumber(row.availed, row.defaultAvailed)
        ? undefined
        : row.availed;

      if (annualSilOverride !== undefined || availed !== undefined) {
        rows.push({
          employeeId: row.employeeId,
          annualSilOverride,
          availed,
        });
      }

      return rows;
    }, []);
  }, [trackerRows]);

  const handleCellChange =
    (employeeId: string, field: keyof DraftRow) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      if (!/^\d*\.?\d*$/.test(nextValue) && nextValue !== "") {
        return;
      }

      setDraftRows((current) => ({
        ...current,
        [employeeId]: {
          annualSilOverride:
            current[employeeId]?.annualSilOverride ??
            formatNumber(
              trackerRows.find((row) => row.employeeId === employeeId)
                ?.annualSilValue ?? 0,
            ),
          availed:
            current[employeeId]?.availed ??
            formatNumber(
              trackerRows.find((row) => row.employeeId === employeeId)
                ?.availedValue ?? 0,
            ),
          [field]: nextValue,
        },
      }));
    };

  const handleResetRow = (employeeId: string) => {
    const row = computedRows.find((item) => item.employeeId === employeeId);
    if (!row) return;

    setDraftRows((current) => ({
      ...current,
      [employeeId]: {
        annualSilOverride: formatNumber(row.formulaAnnualSil),
        availed: formatNumber(row.defaultAvailed),
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateLeaveTracker({
        organizationId: organizationId as Id<"organizations">,
        year: selectedYear,
        rows: rowsToPersist.map((row) => ({
          employeeId: row.employeeId as Id<"employees">,
          annualSilOverride: row.annualSilOverride,
          availed: row.availed,
        })),
      });

      toast({
        title: "Leave tracker updated",
        description: "Tracker values and formulas were saved successfully.",
      });
    } catch (error: unknown) {
      toast({
        title: "Failed to save tracker",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 10; y--) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  if (employeesLoading) {
    return (
      <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-12 text-center text-sm text-[rgb(133,133,133)]">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[rgb(230,230,230)] border-t-brand-purple" />
        <p className="mt-4">Loading employees…</p>
      </div>
    );
  }

  if (!trackerRows.length) {
    return (
      <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-12 text-center text-sm text-[rgb(133,133,133)]">
        No active employees to track.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-[rgb(64,64,64)]">
              Leave tracker formulas
            </p>
          <p className="text-xs text-[rgb(133,133,133)]">
            Annual SIL defaults to {formatNumber(annualSil)} from settings.
            {proratedLeave
              ? " Proration is enabled and uses the 15th-day cutoff."
              : ` Proration is disabled, so the full ${formatNumber(annualSil)} base is used.`}{" "}
            Anniversary leave uses full years since regularization.
          </p>
          <p className="text-xs text-[rgb(133,133,133)]">
            `Monthly Accrual = Total / 12`, `Accrued = Monthly Accrual x current
            month number`, and `Balance = Accrued - Availed`.
          </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[rgb(64,64,64)]">Year</span>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-brand-purple hover:bg-brand-purple-hover text-white"
        >
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "Saving..." : "Save tracker"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[rgb(230,230,230)]">
        <Table>
          <TableHeader>
            <TableRow className="bg-[rgb(250,250,250)] hover:bg-[rgb(250,250,250)]">
              <TableHead>Employees</TableHead>
              <TableHead>Hired Date</TableHead>
              <TableHead>Reg. Date</TableHead>
              <TableHead className="min-w-[120px]">Annual SIL</TableHead>
              <TableHead>Anniv Leave</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Monthly Accrual</TableHead>
              <TableHead>Accrued</TableHead>
              <TableHead className="min-w-[120px]">Availed</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead className="w-[70px] text-right">Reset</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trackerRows.map((row) => (
              <TableRow key={row.employeeId}>
                <TableCell className="font-medium text-[rgb(64,64,64)]">
                  {getEmployeeName(row.employee)}
                </TableCell>
                <TableCell>{formatDate(row.employee?.employment?.hireDate)}</TableCell>
                <TableCell>
                  {formatDate(row.employee?.employment?.regularizationDate)}
                </TableCell>
                <TableCell>
                  <Input
                    value={draftRows[row.employeeId]?.annualSilOverride ?? ""}
                    onChange={handleCellChange(row.employeeId, "annualSilOverride")}
                    className="h-8 border-[rgb(230,230,230)] bg-white text-right"
                    inputMode="decimal"
                  />
                </TableCell>
                <TableCell className="bg-[rgb(248,250,252)] text-right font-medium">
                  {formatNumber(row.anniversaryLeave)}
                </TableCell>
                <TableCell className="bg-[rgb(248,250,252)] text-right font-medium">
                  {formatNumber(row.total)}
                </TableCell>
                <TableCell className="bg-[rgb(248,250,252)] text-right font-medium">
                  {formatNumber(row.monthlyAccrual)}
                </TableCell>
                <TableCell className="bg-[rgb(240,253,244)] text-right font-medium">
                  {formatNumber(row.accrued)}
                </TableCell>
                <TableCell>
                  <Input
                    value={draftRows[row.employeeId]?.availed ?? ""}
                    onChange={handleCellChange(row.employeeId, "availed")}
                    className="h-8 border-[rgb(230,230,230)] bg-white text-right"
                    inputMode="decimal"
                  />
                </TableCell>
                <TableCell className="bg-[rgb(239,246,255)] text-right font-semibold text-brand-purple">
                  {formatNumber(row.balance)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleResetRow(row.employeeId)}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
