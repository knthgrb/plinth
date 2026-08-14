"use server";

import type { ApplicantStage } from "@/lib/recruitment/workflow";
import {
  RecruitmentService,
  type ApplicantInput,
  type ApplicantUpdate,
  type EmployeeConversionInput,
  type JobInput,
} from "@/services/recruitment-service";

export async function createJob(data: JobInput) {
  return RecruitmentService.createJob(data);
}

export async function updateJob(
  jobId: string,
  data: Omit<Partial<JobInput>, "organizationId"> & {
    status?: "open" | "closed" | "on-hold";
  },
) {
  return RecruitmentService.updateJob(jobId, data);
}

export async function updateApplicantStatus(
  applicantId: string,
  status: ApplicantStage,
  rejectionReason?: string,
) {
  return RecruitmentService.updateApplicantStatus(
    applicantId,
    status,
    rejectionReason,
  );
}

export async function addApplicantNote(applicantId: string, content: string) {
  return RecruitmentService.addApplicantNote(applicantId, content);
}

export async function scheduleInterview(data: {
  applicantId: string;
  date: number;
  type: string;
  interviewer: string;
  interviewers?: string[];
  remarks?: string;
}) {
  return RecruitmentService.scheduleInterview(data);
}

export async function convertApplicantToEmployee(
  data: EmployeeConversionInput,
) {
  return RecruitmentService.convertApplicantToEmployee(data);
}

export async function getApplicant(applicantId: string) {
  return RecruitmentService.getApplicant(applicantId);
}

export async function createApplicant(data: ApplicantInput) {
  return RecruitmentService.createApplicant(data);
}

export async function updateApplicant(
  applicantId: string,
  data: ApplicantUpdate,
) {
  return RecruitmentService.updateApplicant(applicantId, data);
}

export async function deleteJob(jobId: string) {
  return RecruitmentService.deleteJob(jobId);
}

export async function setJobStatus(
  jobId: string,
  status: "open" | "closed" | "on-hold",
) {
  return RecruitmentService.setJobStatus(jobId, status);
}

export async function archiveJob(jobId: string) {
  return RecruitmentService.setJobStatus(jobId, "closed");
}

export async function deleteApplicant(applicantId: string) {
  return RecruitmentService.deleteApplicant(applicantId);
}

export async function addApplicantScorecard(data: {
  applicantId: string;
  criteria: { label: string; score: number; notes?: string }[];
  recommendation?: string;
}) {
  return RecruitmentService.addApplicantScorecard(data);
}

export async function requestOfferApproval(data: {
  applicantId: string;
  notes?: string;
}) {
  return RecruitmentService.requestOfferApproval(data);
}

export async function approveOffer(data: {
  applicantId: string;
  approved: boolean;
  notes?: string;
}) {
  return RecruitmentService.approveOffer(data);
}
