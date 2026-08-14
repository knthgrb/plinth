import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import type { ApplicantStage } from "@/lib/recruitment/workflow";

export interface JobInput {
  organizationId: string;
  title?: string;
  department?: string;
  position?: string;
  employmentType?: string;
  numberOfOpenings?: number;
  description?: string;
  requirements?: string[];
  qualifications?: string[];
  salaryRange?: { min: number; max: number };
  closingDate?: number;
}

export interface ApplicantInput {
  organizationId: string;
  jobId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  resume: string;
  coverLetter?: string;
  source?: string;
  sourceDetails?: string;
  googleMeetLink?: string;
  interviewVideoLink?: string;
  portfolioLink?: string;
}

export interface ApplicantUpdate {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  resume?: string;
  coverLetter?: string;
  source?: string;
  sourceDetails?: string;
  googleMeetLink?: string;
  interviewVideoLink?: string;
  portfolioLink?: string;
}

export interface EmployeeConversionInput {
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
}

export class RecruitmentService {
  static async createJob(data: JobInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.createJob, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
    });
  }

  static async updateJob(
    jobId: string,
    data: Omit<Partial<JobInput>, "organizationId"> & {
      status?: "open" | "closed" | "on-hold";
    },
  ) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.updateJob, {
      jobId: jobId as Id<"jobs">,
      ...data,
    });
  }

  static async updateApplicantStatus(
    applicantId: string,
    status: ApplicantStage,
    rejectionReason?: string,
  ) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.updateApplicantStatus, {
      applicantId: applicantId as Id<"applicants">,
      status,
      rejectionReason,
    });
  }

  static async addApplicantNote(applicantId: string, content: string) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.addApplicantNote, {
      applicantId: applicantId as Id<"applicants">,
      content,
    });
  }

  static async scheduleInterview(data: {
    applicantId: string;
    date: number;
    type: string;
    interviewer: string;
    interviewers?: string[];
    remarks?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.scheduleInterview, {
      ...data,
      applicantId: data.applicantId as Id<"applicants">,
      interviewer: data.interviewer as Id<"users">,
      interviewers: data.interviewers?.map(
        (interviewer) => interviewer as Id<"users">,
      ),
    });
  }

  static async convertApplicantToEmployee(data: EmployeeConversionInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.convertApplicantToEmployee, {
      ...data,
      applicantId: data.applicantId as Id<"applicants">,
    });
  }

  static async getApplicant(applicantId: string) {
    const convex = await getAuthedConvexClient();
    return convex.query(api.recruitment.getApplicant, {
      applicantId: applicantId as Id<"applicants">,
    });
  }

  static async createApplicant(data: ApplicantInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.createApplicantByHR, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
      jobId: data.jobId as Id<"jobs">,
      resume: data.resume as Id<"_storage">,
    });
  }

  static async updateApplicant(applicantId: string, data: ApplicantUpdate) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.updateApplicant, {
      applicantId: applicantId as Id<"applicants">,
      ...data,
      resume: data.resume as Id<"_storage"> | undefined,
    });
  }

  static async addApplicantScorecard(data: {
    applicantId: string;
    criteria: { label: string; score: number; notes?: string }[];
    overallScore: number;
    recommendation?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.addApplicantScorecard, {
      ...data,
      applicantId: data.applicantId as Id<"applicants">,
    });
  }

  static async requestOfferApproval(data: {
    applicantId: string;
    notes?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.requestOfferApproval, {
      applicantId: data.applicantId as Id<"applicants">,
      notes: data.notes,
    });
  }

  static async approveOffer(data: {
    applicantId: string;
    approved: boolean;
    notes?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.approveOffer, {
      applicantId: data.applicantId as Id<"applicants">,
      approved: data.approved,
      notes: data.notes,
    });
  }

  static async deleteJob(jobId: string) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.deleteJob, {
      jobId: jobId as Id<"jobs">,
    });
  }

  static async setJobStatus(
    jobId: string,
    status: "open" | "closed" | "on-hold",
  ) {
    return this.updateJob(jobId, { status });
  }

  static async deleteApplicant(applicantId: string) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.recruitment.deleteApplicant, {
      applicantId: applicantId as Id<"applicants">,
    });
  }
}
