"use client";

import { useMemo } from "react";
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
  calculateLeaveTrackerAccrual,
  getLeaveTrackerAccrualMonth,
} from "@/utils/leave-tracker-calculations";
import {
  calculateAnnualLeaveBase,
  calculateAnniversaryLeave,
  getConvertibleLeaveDays,
  type LeaveAccrualFrequency,
} from "@/utils/leave-policy-calculations";

type ResignedEmployee = {
  _id: string;
  personalInfo?: {
    firstName?: string;
    lastName?: string;
  };
  employment?: {
    employeeId?: string;
    hireDate?: number;
    regularizationDate?: number | null;
    status?: string;
  };
  leaveCredits?: {
    vacation?: { used?: number };
    sick?: { used?: number };
    custom?: Array<{ type: string; used?: number }>;
  };
};

type LeaveTypeSetting = {
  type: string;
  name: string;
  defaultCredits: number;
  isAnniversary?: boolean;
};

type ResignedLeaveConversionTabProps = {
  employees: ResignedEmployee[];
  annualSil: number;
  proratedLeave: boolean;
  leaveTrackerMode: "general" | "by_type";
  leaveTypes: LeaveTypeSetting[];
  enableAnniversaryLeave: boolean;
  anniversaryLeaveMaxDays: number;
  grantLeaveUponRegularization: boolean;
  paidLeaveRequiresRegularization: boolean;
  leaveAccrualFrequency: LeaveAccrualFrequency;
  maxConvertibleLeaveDays: number;
};

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function formatNumber(value: number) {
  return roundToTwo(value).toFixed(2);
}

function getEmployeeName(employee: ResignedEmployee) {
  return (
    `${employee.personalInfo?.lastName ?? ""}, ${employee.personalInfo?.firstName ?? ""}`.trim() ||
    "Employee"
  );
}

function getUsedForType(employee: ResignedEmployee, typeKey: string) {
  if (typeKey === "vacation") return employee.leaveCredits?.vacation?.used ?? 0;
  if (typeKey === "sick") return employee.leaveCredits?.sick?.used ?? 0;
  const custom = employee.leaveCredits?.custom?.find(
    (entry) => entry.type === typeKey,
  );
  return custom?.used ?? 0;
}

export function ResignedLeaveConversionTab({
  employees,
  annualSil,
  proratedLeave,
  leaveTrackerMode,
  leaveTypes,
  enableAnniversaryLeave,
  anniversaryLeaveMaxDays,
  grantLeaveUponRegularization,
  paidLeaveRequiresRegularization,
  leaveAccrualFrequency,
  maxConvertibleLeaveDays,
}: ResignedLeaveConversionTabProps) {
  const referenceDate = useMemo(() => new Date(), []);
  const accrualMonth = getLeaveTrackerAccrualMonth(
    referenceDate.getFullYear(),
    referenceDate,
  );
  const configuredTypes = useMemo(
    () => leaveTypes.filter((type) => !type.isAnniversary),
    [leaveTypes],
  );
  const rows = useMemo(() => {
    return employees
      .filter((employee) => employee.employment?.status === "resigned")
      .map((employee) => {
        const hireDate = employee.employment?.hireDate;
        const regularizationDate =
          employee.employment?.regularizationDate ?? undefined;
        const anniversaryStartDate = grantLeaveUponRegularization
          ? regularizationDate
          : hireDate;
        const anniversaryLeave = calculateAnniversaryLeave({
          enabled: enableAnniversaryLeave,
          maxDays: anniversaryLeaveMaxDays,
          startDate:
            paidLeaveRequiresRegularization && !regularizationDate
              ? undefined
              : anniversaryStartDate,
          referenceDate: referenceDate.getTime(),
        });

        const baseEntitlement =
          leaveTrackerMode === "by_type"
            ? configuredTypes.reduce((sum, type) => {
                return (
                  sum +
                  calculateAnnualLeaveBase({
                    annualLeave: Number(type.defaultCredits || 0),
                    hireDate,
                    regularizationDate,
                    referenceDate: referenceDate.getTime(),
                    proratedLeave,
                    grantLeaveUponRegularization,
                    paidLeaveRequiresRegularization,
                  })
                );
              }, 0)
            : calculateAnnualLeaveBase({
                annualLeave: annualSil,
                hireDate,
                regularizationDate,
                referenceDate: referenceDate.getTime(),
                proratedLeave,
                grantLeaveUponRegularization,
                paidLeaveRequiresRegularization,
              });
        const total = roundToTwo(baseEntitlement + anniversaryLeave);
        const accrued = calculateLeaveTrackerAccrual({
          total,
          accrualMonth,
          accrualFrequency: leaveAccrualFrequency,
        }).accrued;
        const used =
          leaveTrackerMode === "by_type"
            ? configuredTypes.reduce(
                (sum, type) => sum + getUsedForType(employee, type.type),
                0,
              )
            : (employee.leaveCredits?.vacation?.used ?? 0) +
              (employee.leaveCredits?.sick?.used ?? 0);
        const balance = Math.max(0, roundToTwo(accrued - used));

        return {
          employee,
          accrued,
          used,
          balance,
          convertible: getConvertibleLeaveDays(
            balance,
            maxConvertibleLeaveDays,
          ),
        };
      })
      .sort((left, right) =>
        getEmployeeName(left.employee).localeCompare(
          getEmployeeName(right.employee),
        ),
      );
  }, [
    accrualMonth,
    annualSil,
    anniversaryLeaveMaxDays,
    configuredTypes,
    employees,
    enableAnniversaryLeave,
    grantLeaveUponRegularization,
    leaveAccrualFrequency,
    leaveTrackerMode,
    maxConvertibleLeaveDays,
    paidLeaveRequiresRegularization,
    proratedLeave,
    referenceDate,
  ]);

  return (
    <Card className="border-[rgb(230,230,230)] shadow-sm overflow-hidden">
      <CardHeader className="pb-4 pt-6">
        <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
          Resigned leave conversion
        </CardTitle>
        <p className="text-sm text-[rgb(133,133,133)] mt-1">
          Remaining convertible leave for resigned employees.
        </p>
      </CardHeader>
      <CardContent className="pt-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Employee ID</TableHead>
              <TableHead className="text-right">Accrued</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Convertible</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-500">
                  No resigned employees found
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.employee._id}>
                  <TableCell className="font-medium text-[rgb(64,64,64)]">
                    {getEmployeeName(row.employee)}
                  </TableCell>
                  <TableCell>
                    {row.employee.employment?.employeeId ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.accrued)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.used)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(row.balance)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-brand-purple tabular-nums">
                    {formatNumber(row.convertible)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
