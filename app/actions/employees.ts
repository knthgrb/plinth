"use server";

import { EmployeesService } from "@/services/employees-service";
import { ChatService } from "@/services/chat-service";

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
