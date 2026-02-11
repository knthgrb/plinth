"use server";

import { EmployeesService } from "@/services/employees-service";
import { ChatService } from "@/services/chat-service";
import { InvitationsService } from "@/services/invitations-service";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function createEmployee(data: {
  organizationId: string;
  personalInfo: {
    firstName: string;
    lastName: string;
    middleName?: string;
    email: string;
    phone?: string;
    address?: string;
    dateOfBirth?: number;
    civilStatus?: string;
    emergencyContact?: {
      name: string;
      relationship: string;
      phone: string;
    };
  };
  employment: {
    employeeId: string;
    position: string;
    department: string;
    employmentType: "regular" | "probationary" | "contractual" | "part-time";
    hireDate: number;
    regularizationDate?: number;
    status: "active" | "inactive" | "resigned" | "terminated";
  };
  compensation: {
    basicSalary: number;
    allowance?: number;
    salaryType: "monthly" | "daily" | "hourly";
    bankDetails?: {
      bankName: string;
      accountNumber: string;
      accountName: string;
    };
    regularHolidayRate?: number;
    specialHolidayRate?: number;
  };
  schedule: {
    defaultSchedule: {
      monday: { in: string; out: string; isWorkday: boolean };
      tuesday: { in: string; out: string; isWorkday: boolean };
      wednesday: { in: string; out: string; isWorkday: boolean };
      thursday: { in: string; out: string; isWorkday: boolean };
      friday: { in: string; out: string; isWorkday: boolean };
      saturday: { in: string; out: string; isWorkday: boolean };
      sunday: { in: string; out: string; isWorkday: boolean };
    };
    scheduleOverrides?: Array<{
      date: number;
      in: string;
      out: string;
      reason: string;
    }>;
  };
}) {
  return EmployeesService.createEmployee(data);
}

export async function updateEmployee(
  employeeId: string,
  data: {
    personalInfo?: {
      firstName?: string;
      lastName?: string;
      middleName?: string;
      email?: string;
      phone?: string;
      address?: string;
      dateOfBirth?: number;
      civilStatus?: string;
      emergencyContact?: {
        name: string;
        relationship: string;
        phone: string;
      };
    };
    employment?: {
      employeeId?: string;
      position?: string;
      department?: string;
      employmentType?: "regular" | "probationary" | "contractual" | "part-time";
      hireDate?: number;
      regularizationDate?: number;
      status?: "active" | "inactive" | "resigned" | "terminated";
    };
    compensation?: {
      basicSalary?: number;
      allowance?: number;
      salaryType?: "monthly" | "daily" | "hourly";
      bankDetails?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
      };
      regularHolidayRate?: number;
      specialHolidayRate?: number;
    };
    schedule?: {
      defaultSchedule?: {
        monday?: { in: string; out: string; isWorkday: boolean };
        tuesday?: { in: string; out: string; isWorkday: boolean };
        wednesday?: { in: string; out: string; isWorkday: boolean };
        thursday?: { in: string; out: string; isWorkday: boolean };
        friday?: { in: string; out: string; isWorkday: boolean };
        saturday?: { in: string; out: string; isWorkday: boolean };
        sunday?: { in: string; out: string; isWorkday: boolean };
      };
      scheduleOverrides?: Array<{
        date: number;
        in: string;
        out: string;
        reason: string;
      }>;
    };
    customFields?: Record<string, any>;
  }
) {
  return EmployeesService.updateEmployee(employeeId, data);
}

export async function getEmployee(employeeId: string) {
  return EmployeesService.getEmployee(employeeId);
}

// Get user ID from employee ID
export async function getUserByEmployeeId(data: {
  organizationId: string;
  employeeId: string;
}) {
  return ChatService.getUserByEmployeeId(data);
}

// Check if employee has a user account
export async function checkEmployeeHasUserAccount(data: {
  organizationId: string;
  employeeId: string;
}) {
  const convex = await getAuthedConvexClient();
  return await (convex.query as any)(
    (api as any).employees.employeeHasUserAccount,
    {
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
    }
  );
}

// Create user account for employee and send invitation
export async function createUserForEmployee(data: {
  organizationId: string;
  employeeId: string;
  role: "admin" | "hr" | "accounting" | "employee";
}) {
  const convex = await getAuthedConvexClient();

  // Create invitation in Convex (this creates the invitation record)
  const result = await (convex.mutation as any)(
    (api as any).invitations.createUserForEmployee,
    {
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
      role: data.role,
    }
  );

  // Get invitation details to send email
  const invitation = await (convex.query as any)(
    (api as any).invitations.getInvitationById,
    { invitationId: result.invitationId as Id<"invitations"> }
  );

  if (invitation) {
    // Generate invitation link
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      "http://localhost:3000";
    const invitationLink = `${baseUrl}/invite/accept?token=${invitation.token}`;

    // Send email directly (invitation is already created)
    const { generateInvitationEmail } =
      await import("@/helpers/email-templates");
    const { sendEmail } = await import("@/lib/email");

    const emailContent = generateInvitationEmail(
      invitation.organization.name,
      invitation.inviter.name || invitation.inviter.email,
      invitation.role,
      invitationLink
    );

    try {
      await sendEmail({
        to: result.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    } catch (error: any) {
      console.error("Failed to send invitation email:", error);
      // Don't throw - invitation is created, email failure is logged
    }
  }

  return { success: true, invitationId: result.invitationId };
}

// Delete employee
export async function deleteEmployee(employeeId: string) {
  return EmployeesService.deleteEmployee(employeeId);
}

export async function addRequirement(data: {
  employeeId: string;
  requirement: {
    type: string;
    status: "pending" | "submitted" | "verified";
    file?: string;
    submittedDate?: number;
    expiryDate?: number;
  };
}) {
  return EmployeesService.addRequirement(data);
}

export async function updateRequirementStatus(data: {
  employeeId: string;
  requirementIndex: number;
  status: "pending" | "submitted" | "verified";
}) {
  return EmployeesService.updateRequirementStatus(data);
}

export async function setEmployeeRequirementsComplete(data: {
  employeeId: string;
  complete: boolean;
}) {
  return EmployeesService.setEmployeeRequirementsComplete(data);
}

export async function updateRequirementFile(data: {
  employeeId: string;
  requirementIndex: number;
  file: string;
}) {
  return EmployeesService.updateRequirementFile(data);
}

export async function removeRequirement(data: {
  employeeId: string;
  requirementIndex: number;
}) {
  return EmployeesService.removeRequirement(data);
}

export async function getEmployeeRequirements(employeeId: string) {
  return EmployeesService.getEmployeeRequirements(employeeId);
}
