import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { ChatService } from "./chat-service";
import { EmployeesService } from "./employees-service";
import { sendEmail } from "@/lib/email";

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

  static async getPayrollRuns(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).payroll.getPayrollRuns, {
      organizationId: organizationId as Id<"organizations">,
    });
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

    // If method is chat, send via chat system
    if (method === "chat" && result.employeeId) {
      const payslip = await this.getPayslip(payslipId);
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const payslipUrl = `${baseUrl}/payslips?payslipId=${payslipId}`;

      await ChatService.sendMessageToEmployee({
        organizationId: payslip.organizationId,
        employeeId: result.employeeId,
        content: `Your payslip for ${payslip.period} is ready. View it here: ${payslipUrl}`,
        messageType: "system",
      });
    }

    // If method is email, send via email system
    if (method === "email" && result.employeeId) {
      const payslip = await this.getPayslip(payslipId);
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
            subject: `Your Payslip for ${payslip.period}`,
            html: `
              <h2>Your Payslip is Ready</h2>
              <p>Hello ${employee.personalInfo.firstName},</p>
              <p>Your payslip for the period ${payslip.period} is now available.</p>
              <p><strong>Gross Pay:</strong> ₱${payslip.grossPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}</p>
              <p><strong>Net Pay:</strong> ₱${payslip.netPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}</p>
              <p><a href="${payslipUrl}">View Full Payslip</a></p>
            `,
            text: `Your payslip for ${payslip.period} is ready. Gross Pay: ₱${payslip.grossPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}, Net Pay: ₱${payslip.netPay?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}. View it at: ${payslipUrl}`,
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
    }>;
    nonTaxableAllowance?: number;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).payroll.updatePayslip, {
      payslipId: data.payslipId as Id<"payslips">,
      deductions: data.deductions,
      incentives: data.incentives,
      nonTaxableAllowance: data.nonTaxableAllowance,
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

  static async deletePayrollRun(payrollRunId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).payroll.deletePayrollRun,
      {
        payrollRunId: payrollRunId as Id<"payrollRuns">,
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
