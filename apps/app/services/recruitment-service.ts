import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class RecruitmentService {
  static async createJob(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).recruitment.createJob, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
    });
  }

  static async updateJob(
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).recruitment.updateJob, {
      jobId: jobId as Id<"jobs">,
      ...data,
    });
  }

  static async updateApplicantStatus(
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).recruitment.updateApplicantStatus,
      {
        applicantId: applicantId as Id<"applicants">,
        status,
      }
    );
  }

  static async addApplicantNote(applicantId: string, content: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).recruitment.addApplicantNote,
      {
        applicantId: applicantId as Id<"applicants">,
        content,
      }
    );
  }

  static async scheduleInterview(data: {
    applicantId: string;
    date: number;
    type: string;
    interviewer: string;
    remarks?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).recruitment.scheduleInterview,
      {
        ...data,
        applicantId: data.applicantId as Id<"applicants">,
        interviewer: data.interviewer as Id<"users">,
      }
    );
  }

  static async convertApplicantToEmployee(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).recruitment.convertApplicantToEmployee,
      {
        ...data,
        applicantId: data.applicantId as Id<"applicants">,
      }
    );
  }

  static async getApplicant(applicantId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).recruitment.getApplicant, {
      applicantId: applicantId as Id<"applicants">,
    });
  }

  static async createApplicant(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).recruitment.createApplicantByHR,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        jobId: data.jobId as Id<"jobs">,
        resume: data.resume as Id<"_storage">,
      }
    );
  }

  static async updateApplicant(
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).recruitment.updateApplicant,
      {
        applicantId: applicantId as Id<"applicants">,
        ...data,
        resume: data.resume as Id<"_storage"> | undefined,
      }
    );
  }

  static async deleteJob(jobId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).recruitment.deleteJob, {
      jobId: jobId as Id<"jobs">,
    });
  }

  static async archiveJob(jobId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).recruitment.updateJob, {
      jobId: jobId as Id<"jobs">,
      status: "closed",
    });
  }

  static async deleteApplicant(applicantId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).recruitment.deleteApplicant,
      {
        applicantId: applicantId as Id<"applicants">,
      }
    );
  }
}
