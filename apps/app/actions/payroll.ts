"use server";

import { PayrollService } from "@/services/payroll-service";

export async function createPayrollRun(data: {
  organizationId: string;
  cutoffStart: number;
  cutoffEnd: number;
  employeeIds: string[];
  deductionsEnabled?: boolean;
  nightDiffPercent?: number;
  manualDeductions?: Array<{
    employeeId: string;
    deductions: Array<{
      name: string;
      amount: number;
      type: string;
    }>;
  }>;
  governmentDeductionSettings?: Array<{
    employeeId: string;
    sss: { enabled: boolean; frequency: "full" | "half" };
    pagibig: { enabled: boolean; frequency: "full" | "half" };
    philhealth: { enabled: boolean; frequency: "full" | "half" };
    tax: { enabled: boolean; frequency: "full" | "half" };
  }>;
  incentives?: Array<{
    employeeId: string;
    incentives: Array<{
      name: string;
      amount: number;
      type: string;
    }>;
  }>;
}) {
  return PayrollService.createPayrollRun(data);
}

export async function computeEmployeePayroll(data: {
  employeeId: string;
  cutoffStart: number;
  cutoffEnd: number;
}) {
  return PayrollService.computeEmployeePayroll(data);
}

export async function getPayslip(payslipId: string) {
  return PayrollService.getPayslip(payslipId);
}

export async function getEmployeePayslips(employeeId: string) {
  return PayrollService.getEmployeePayslips(employeeId);
}

export async function getPayrollRuns(organizationId: string) {
  return PayrollService.getPayrollRuns(organizationId);
}

export async function getPayslipsByPayrollRun(payrollRunId: string) {
  return PayrollService.getPayslipsByPayrollRun(payrollRunId);
}

export async function sendPayslipNotification(
  payslipId: string,
  method: "email" | "chat"
) {
  return PayrollService.sendPayslipNotification(payslipId, method);
}

export async function updatePayslip(data: {
  payslipId: string;
  deductions?: Array<{
    name: string;
    amount: number;
    type: string;
  }>;
  incentives?: Array<{
    name: string;
    amount: number;
    type: string;
  }>;
  nonTaxableAllowance?: number;
}) {
  return PayrollService.updatePayslip(data);
}

export async function updatePayrollRunStatus(
  payrollRunId: string,
  status: "draft" | "finalized" | "paid" | "archived" | "cancelled"
) {
  return PayrollService.updatePayrollRunStatus(payrollRunId, status);
}

export async function deletePayrollRun(payrollRunId: string) {
  return PayrollService.deletePayrollRun(payrollRunId);
}

export async function updatePayrollRun(data: {
  payrollRunId: string;
  cutoffStart?: number;
  cutoffEnd?: number;
  employeeIds?: string[];
  deductionsEnabled?: boolean;
  manualDeductions?: Array<{
    employeeId: string;
    deductions: Array<{
      name: string;
      amount: number;
      type: string;
    }>;
  }>;
  governmentDeductionSettings?: Array<{
    employeeId: string;
    sss: { enabled: boolean; frequency: "full" | "half" };
    pagibig: { enabled: boolean; frequency: "full" | "half" };
    philhealth: { enabled: boolean; frequency: "full" | "half" };
    tax: { enabled: boolean; frequency: "full" | "half" };
  }>;
  incentives?: Array<{
    employeeId: string;
    incentives: Array<{
      name: string;
      amount: number;
      type: string;
    }>;
  }>;
}) {
  return PayrollService.updatePayrollRun(data);
}

export async function getPayslipMessages(payslipId: string) {
  return PayrollService.getPayslipMessages(payslipId);
}

export async function getPayrollRunSummary(payrollRunId: string) {
  return PayrollService.getPayrollRunSummary(payrollRunId);
}

export async function addPayrollRunNote(data: {
  payrollRunId: string;
  employeeId: string;
  date: number;
  note: string;
}) {
  return PayrollService.addPayrollRunNote(data);
}
