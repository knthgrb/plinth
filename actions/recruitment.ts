"use server";

import { RecruitmentService } from "@/services/recruitment-service";

export async function createJob(data: {
  organizationId: string;
  title?: string;
  department?: string;
  employmentType?: string;
  numberOfOpenings?: number;
  description?: string;
  requirements?: string[];
  qualifications?: string[];
  salaryRange?: { min: number; max: number };
  closingDate?: number;
}) {
  return RecruitmentService.createJob(data);
}

export async function updateJob(
  jobId: string,
  data: {
    title?: string;
    department?: string;
    position?: string;
    employmentType?: string;
    numberOfOpenings?: number;
    description?: string;
    requirements?: string[];
    qualifications?: string[];
    salaryRange?: { min: number; max: number };
    status?: "open" | "closed" | "on-hold";
    closingDate?: number;
  }
) {
  return RecruitmentService.updateJob(jobId, data);
}

export async function updateApplicantStatus(
  applicantId: string,
  status:
    | "new"
    | "screening"
    | "interview"
    | "assessment"
    | "offer"
    | "hired"
    | "rejected"
) {
  return RecruitmentService.updateApplicantStatus(applicantId, status);
}

export async function addApplicantNote(applicantId: string, content: string) {
  return RecruitmentService.addApplicantNote(applicantId, content);
}

export async function scheduleInterview(data: {
  applicantId: string;
  date: number;
  type: string;
  interviewer: string;
  remarks?: string;
}) {
  return RecruitmentService.scheduleInterview(data);
}

export async function convertApplicantToEmployee(data: {
  applicantId: string;
  employeeData: {
    employeeId: string;
    position: string;
    department: string;
    employmentType: "regular" | "probationary" | "contractual" | "part-time";
    hireDate: number;
    basicSalary: number;
    salaryType: "monthly" | "daily" | "hourly";
  };
}) {
  return RecruitmentService.convertApplicantToEmployee(data);
}

export async function getApplicant(applicantId: string) {
  return RecruitmentService.getApplicant(applicantId);
}

export async function createApplicant(data: {
  organizationId: string;
  jobId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  resume: string; // storage ID
  coverLetter?: string;
  googleMeetLink?: string;
  interviewVideoLink?: string;
  portfolioLink?: string;
}) {
  return RecruitmentService.createApplicant(data);
}

export async function updateApplicant(
  applicantId: string,
  data: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    resume?: string; // storage ID
    coverLetter?: string;
    googleMeetLink?: string;
    interviewVideoLink?: string;
    portfolioLink?: string;
  }
) {
  return RecruitmentService.updateApplicant(applicantId, data);
}

export async function deleteJob(jobId: string) {
  return RecruitmentService.deleteJob(jobId);
}

export async function archiveJob(jobId: string) {
  return RecruitmentService.archiveJob(jobId);
}

export async function deleteApplicant(applicantId: string) {
  return RecruitmentService.deleteApplicant(applicantId);
}
