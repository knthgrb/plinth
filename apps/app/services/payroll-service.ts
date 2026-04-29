import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { ChatService } from "./chat-service";
import { EmployeesService } from "./employees-service";
import { sendEmail } from "@/lib/email";
import { renderPayslipPdfBuffer } from "@/lib/payslip-pdf";
import { buildPayslipEmailContent } from "@/lib/payslip-email-templates";
import {
  formatManilaNumericDate,
  formatManilaShortDate,
} from "@/lib/manila-date";

export class PayrollService {
  static async createPayrollRun(data: {
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
        taxable?: boolean;
      }>;
    }>;
  }) {
    const convex = await getAuthedConvexClient();
    const { nightDiffPercent, ...restData } = data;
    return await (convex.mutation as any)(
      (api as any).payroll.createPayrollRun,
      {
        ...restData,
        organizationId: data.organizationId as Id<"organizations">,
        employeeIds: data.employeeIds as Id<"employees">[],
        deductionsEnabled: data.deductionsEnabled,
        manualDeductions: data.manualDeductions?.map((md) => ({
          employeeId: md.employeeId as Id<"employees">,
          deductions: md.deductions,
        })),
        governmentDeductionSettings: data.governmentDeductionSettings?.map(
          (gs) => ({
            employeeId: gs.employeeId as Id<"employees">,
            sss: gs.sss,
            pagibig: gs.pagibig,
            philhealth: gs.philhealth,
            tax: gs.tax,
          })
        ),
        incentives: data.incentives?.map((inc) => ({
          employeeId: inc.employeeId as Id<"employees">,
          incentives: inc.incentives,
        })),
      }
    );
  }

  static async computeEmployeePayroll(data: {
    employeeId: string;
    cutoffStart: number;
    cutoffEnd: number;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.computeEmployeePayroll,
      {
        employeeId: data.employeeId as Id<"employees">,
        cutoffStart: data.cutoffStart,
        cutoffEnd: data.cutoffEnd,
      }
    );
  }

  static async computePayrollPreviewBatch(data: {
    organizationId: string;
    cutoffStart: number;
    cutoffEnd: number;
    employeeIds: string[];
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
        taxable?: boolean;
      }>;
    }>;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.computePayrollPreviewBatch,
      {
        organizationId: data.organizationId as Id<"organizations">,
        cutoffStart: data.cutoffStart,
        cutoffEnd: data.cutoffEnd,
        employeeIds: data.employeeIds as Id<"employees">[],
        deductionsEnabled: data.deductionsEnabled,
        manualDeductions: data.manualDeductions?.map((entry) => ({
          employeeId: entry.employeeId as Id<"employees">,
          deductions: entry.deductions,
        })),
        governmentDeductionSettings: data.governmentDeductionSettings?.map(
          (entry) => ({
            employeeId: entry.employeeId as Id<"employees">,
            sss: entry.sss,
            pagibig: entry.pagibig,
            philhealth: entry.philhealth,
            tax: entry.tax,
          }),
        ),
        incentives: data.incentives?.map((entry) => ({
          employeeId: entry.employeeId as Id<"employees">,
          incentives: entry.incentives,
        })),
      },
    );
  }

  static async getPayslip(payslipId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).payroll.getPayslip, {
      payslipId: payslipId as Id<"payslips">,
    });
  }

  static async getEmployeePayslips(employeeId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.getEmployeePayslips,
      {
        employeeId: employeeId as Id<"employees">,
      }
    );
  }

  static async getPayrollRuns(
    organizationId: string,
    options?: { runType?: "regular" | "13th_month"; year?: number }
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).payroll.getPayrollRuns, {
      organizationId: organizationId as Id<"organizations">,
      runType: options?.runType,
      year: options?.year,
    });
  }

  static async compute13thMonthAmounts(data: {
    organizationId: string;
    year: number;
    employeeIds?: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.compute13thMonthAmounts,
      {
        organizationId: data.organizationId as Id<"organizations">,
        year: data.year,
        employeeIds: data.employeeIds?.map((id) => id as Id<"employees">),
      }
    );
  }

  static async create13thMonthRun(data: {
    organizationId: string;
    year: number;
    employeeIds: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.create13thMonthRun,
      {
        organizationId: data.organizationId as Id<"organizations">,
        year: data.year,
        employeeIds: data.employeeIds as Id<"employees">[],
      }
    );
  }

  static async createLeaveConversionRun(data: {
    organizationId: string;
    year: number;
    employeeIds: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.createLeaveConversionRun,
      {
        organizationId: data.organizationId as Id<"organizations">,
        year: data.year,
        employeeIds: data.employeeIds as Id<"employees">[],
      }
    );
  }

  static async getPayslipsByPayrollRun(payrollRunId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.getPayslipsByPayrollRun,
      {
        payrollRunId: payrollRunId as Id<"payrollRuns">,
      }
    );
  }

  static async getPayslipListByPayrollRun(payrollRunId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.getPayslipListByPayrollRun,
      {
        payrollRunId: payrollRunId as Id<"payrollRuns">,
      }
    );
  }

  static async sendPayslipNotification(
    payslipId: string,
    method: "email" | "chat"
  ) {
    const convex = await getAuthedConvexClient();
    const result = await (convex.mutation as any)(
      (api as any).payroll.sendPayslipNotification,
      {
        payslipId: payslipId as Id<"payslips">,
        method,
      }
    );

    const formatPayslipPeriod = (payslip: any): string => {
      const start = payslip?.periodStart;
      const end = payslip?.periodEnd;
      if (typeof start === "number" && typeof end === "number") {
        return `${formatManilaNumericDate(start)} to ${formatManilaNumericDate(end)}`;
      }
      return String(payslip?.period ?? "payroll");
    };

    // If method is chat, send via chat system
    if (method === "chat" && result.employeeId) {
      const payslip = await this.getPayslip(payslipId);
      const payslipPeriod = formatPayslipPeriod(payslip);
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const payslipUrl = `${baseUrl}/payslips?payslipId=${payslipId}`;

      await ChatService.sendMessageToEmployee({
        organizationId: payslip.organizationId,
        employeeId: result.employeeId,
        content: `Your payslip for ${payslipPeriod} is ready. View it here: ${payslipUrl}`,
        messageType: "system",
      });
    }

    // If method is email, send via email system
    if (method === "email" && result.employeeId) {
      const payslip = await this.getPayslip(payslipId);
      const payslipPeriod = formatPayslipPeriod(payslip);
      const employee = await EmployeesService.getEmployee(result.employeeId);

      if (employee?.personalInfo?.email) {
        const baseUrl =
          process.env.NEXT_PUBLIC_SITE_URL ||
          process.env.SITE_URL ||
          "http://localhost:3000";
        const payslipUrl = `${baseUrl}/payslips?payslipId=${payslipId}`;

        try {
          await sendEmail({
            to: employee.personalInfo.email,
            subject: `Your Payslip for ${payslipPeriod}`,
            html: `
              <h2>Your Payslip is Ready</h2>
              <p>Hello ${employee.personalInfo.firstName},</p>
              <p>Your payslip for the period ${payslipPeriod} is now available.</p>
              <p><strong>Gross Pay:</strong> ₱${payslip.grossPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}</p>
              <p><strong>Net Pay:</strong> ₱${payslip.netPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}</p>
              <p><a href="${payslipUrl}">View Full Payslip</a></p>
            `,
            text: `Your payslip for ${payslipPeriod} is ready. Gross Pay: ₱${payslip.grossPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}, Net Pay: ₱${payslip.netPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}. View it at: ${payslipUrl}`,
          });
        } catch (emailError: any) {
          console.error("Failed to send email:", emailError);
          throw new Error("Failed to send email notification");
        }
      } else {
        throw new Error("Employee email not found");
      }
    }

    return result;
  }

  static async updatePayslip(data: {
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
      taxable?: boolean;
    }>;
    nonTaxableAllowance?: number;
    variableEarnings?: {
      holidayPay: number;
      nightDiffPay: number;
      restDayPay: number;
      overtimeRegular: number;
      overtimeRestDay: number;
      overtimeRestDayExcess: number;
      overtimeSpecialHoliday: number;
      overtimeSpecialHolidayExcess: number;
      overtimeLegalHoliday: number;
      overtimeLegalHolidayExcess: number;
    };
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).payroll.updatePayslip, {
      payslipId: data.payslipId as Id<"payslips">,
      deductions: data.deductions,
      incentives: data.incentives,
      nonTaxableAllowance: data.nonTaxableAllowance,
      variableEarnings: data.variableEarnings,
    });
  }

  static async updatePayrollRunStatus(
    payrollRunId: string,
    status: "draft" | "finalized" | "paid" | "archived" | "cancelled"
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.updatePayrollRunStatus,
      {
        payrollRunId: payrollRunId as Id<"payrollRuns">,
        status,
      }
    );
  }

  /**
   * After a run is finalized: email password-protected payslip PDFs only to employees
   * who have a Plinth account in this organization.
   */
  static async sendFinalizedPayrollPayslipEmails(payrollRunId: string): Promise<{
    sent: number;
    withoutAccountCount: number;
    errors: string[];
  }> {
    const convex = await getAuthedConvexClient();
    const recipients = await (convex.query as any)(
      (api as any).payroll.getPayrollFinalizePayslipRecipients,
      { payrollRunId: payrollRunId as Id<"payrollRuns"> },
    );
    if (!recipients) {
      throw new Error("Could not load payslip recipients");
    }
    if (recipients.runStatus !== "finalized") {
      throw new Error("Payroll run must be finalized before sending payslip emails.");
    }

    const payslips = await (convex.query as any)(
      (api as any).payroll.getPayslipsByPayrollRun,
      { payrollRunId: payrollRunId as Id<"payrollRuns"> },
    );

    let sent = 0;
    const errors: string[] = [];

    for (const row of recipients.withAccount as Array<{
      employeeId: string;
      name: string;
      email: string;
    }>) {
      const payslip = payslips.find(
        (p: any) => String(p.employeeId) === String(row.employeeId),
      );
      if (!payslip?.employee) {
        errors.push(`${row.name}: missing payslip data`);
        continue;
      }
      try {
        const period = `${formatManilaNumericDate(recipients.cutoffStart)} to ${formatManilaNumericDate(recipients.cutoffEnd)}`;
        const safePeriod = `${formatManilaShortDate(recipients.cutoffStart)}-${formatManilaShortDate(recipients.cutoffEnd)}`
          .replace(/[^a-zA-Z0-9-_]+/g, "_")
          .slice(0, 48);
        const pdf = await renderPayslipPdfBuffer({
          payslip,
          employee: payslip.employee,
          organizationName: recipients.organizationName,
          cutoffStart: recipients.cutoffStart,
          cutoffEnd: recipients.cutoffEnd,
        });
        const { subject, html, text } = buildPayslipEmailContent(
          payslip.employee.personalInfo.firstName,
          period,
        );
        await sendEmail({
          to: row.email,
          subject,
          html,
          text,
          attachments: [
            {
              filename: `payslip-${safePeriod}-${row.employeeId}.pdf`,
              content: pdf,
              type: "application/pdf",
            },
          ],
        });
        sent += 1;
      } catch (e: any) {
        errors.push(`${row.name}: ${e?.message ?? "send failed"}`);
      }
    }

    return {
      sent,
      withoutAccountCount: (recipients.withoutAccount as unknown[]).length,
      errors,
    };
  }

  static async deletePayrollRun(payrollRunId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.deletePayrollRun,
      {
        payrollRunId: payrollRunId as Id<"payrollRuns">,
      }
    );
  }

  static async deletePayrollRuns(payrollRunIds: string[]) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.deletePayrollRuns,
      {
        payrollRunIds: payrollRunIds as Id<"payrollRuns">[],
      }
    );
  }

  static async updatePayrollRun(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.updatePayrollRun,
      {
        payrollRunId: data.payrollRunId as Id<"payrollRuns">,
        cutoffStart: data.cutoffStart,
        cutoffEnd: data.cutoffEnd,
        employeeIds: data.employeeIds?.map((id) => id as Id<"employees">),
        deductionsEnabled: data.deductionsEnabled,
        manualDeductions: data.manualDeductions?.map((md) => ({
          employeeId: md.employeeId as Id<"employees">,
          deductions: md.deductions,
        })),
        governmentDeductionSettings: data.governmentDeductionSettings?.map(
          (gs) => ({
            employeeId: gs.employeeId as Id<"employees">,
            sss: gs.sss,
            pagibig: gs.pagibig,
            philhealth: gs.philhealth,
            tax: gs.tax,
          })
        ),
        incentives: data.incentives?.map((inc) => ({
          employeeId: inc.employeeId as Id<"employees">,
          incentives: inc.incentives,
        })),
      }
    );
  }

  static async getPayslipMessages(payslipId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.getPayslipMessages,
      {
        payslipId: payslipId as Id<"payslips">,
      }
    );
  }

  static async getPayrollRunSummary(payrollRunId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).payroll.getPayrollRunSummary,
      {
        payrollRunId: payrollRunId as Id<"payrollRuns">,
      }
    );
  }

  static async addPayrollRunNote(data: {
    payrollRunId: string;
    employeeId: string;
    date: number;
    note: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.addPayrollRunNote,
      {
        payrollRunId: data.payrollRunId as Id<"payrollRuns">,
        employeeId: data.employeeId as Id<"employees">,
        date: data.date,
        note: data.note,
      }
    );
  }
}
