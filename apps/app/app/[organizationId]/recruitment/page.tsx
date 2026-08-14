"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { createJob } from "@/actions/recruitment";
import { updateDepartments } from "@/actions/settings";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import { summarizeRecruitmentPipeline } from "@/lib/recruitment/workflow";
import { errorMessage } from "@/lib/recruitment/ui-types";
import { getOrganizationPath } from "@/utils/organization-routing";
import { Briefcase, ChevronRight, Plus, Search } from "lucide-react";
import { RecruitmentOverview } from "./_components/recruitment-overview";

const emptyJobForm = {
  title: "",
  department: "",
  employmentType: "",
  numberOfOpenings: "1",
  description: "",
  requirements: "",
  qualifications: "",
  closingDate: "",
};

export default function RecruitmentPage() {
  const router = useRouter();
  const { effectiveOrganizationId } = useOrganization();
  const { toast } = useToast();
  const jobs = useQuery(
    api.recruitment.getJobs,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const applicants = useQuery(
    api.recruitment.getApplicants,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const settings = useQuery(
    api.settings.getSettings,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const [isJobDialogOpen, setIsJobDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [isCreatingDepartment, setIsCreatingDepartment] = useState(false);
  const [jobForm, setJobForm] = useState(emptyJobForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "open" | "closed" | "on-hold"
  >("all");

  const summary = useMemo(
    () =>
      summarizeRecruitmentPipeline(
        (jobs ?? []).map((job) => ({
          id: job._id,
          status: job.status,
          numberOfOpenings: job.numberOfOpenings,
        })),
        (applicants ?? []).map((applicant) => ({
          jobId: applicant.jobId,
          status: applicant.status,
          appliedDate: applicant.appliedDate,
          pipelineStageHistory: applicant.pipelineStageHistory,
        })),
      ),
    [applicants, jobs],
  );

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (jobs ?? []).filter((job) => {
      const matchesStatus =
        statusFilter === "all" || job.status === statusFilter;
      const matchesQuery =
        !query ||
        `${job.title} ${job.department} ${job.employmentType}`
          .toLocaleLowerCase()
          .includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [jobs, search, statusFilter]);

  const departments = useMemo(
    () =>
      (settings?.departments ?? []).map((department) =>
        typeof department === "string"
          ? { name: department, color: "#9CA3AF" }
          : { name: department.name, color: department.color ?? "#9CA3AF" },
      ),
    [settings?.departments],
  );

  async function createDepartment() {
    if (!effectiveOrganizationId || !newDepartmentName.trim()) return;
    const name = newDepartmentName.trim();
    if (
      departments.some(
        (department) =>
          department.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      toast({ title: "Department already exists", variant: "destructive" });
      return;
    }
    setIsCreatingDepartment(true);
    try {
      await updateDepartments({
        organizationId: effectiveOrganizationId,
        departments: [...departments, { name, color: "#9CA3AF" }],
      });
      setJobForm((current) => ({ ...current, department: name }));
      setNewDepartmentName("");
      toast({ title: "Department created" });
    } catch (error: unknown) {
      toast({
        title: "Unable to create department",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsCreatingDepartment(false);
    }
  }

  async function submitJob(event: React.FormEvent) {
    event.preventDefault();
    if (!effectiveOrganizationId) return;
    setIsSubmitting(true);
    try {
      await createJob({
        organizationId: effectiveOrganizationId,
        title: jobForm.title,
        department: jobForm.department,
        employmentType: jobForm.employmentType,
        numberOfOpenings: Number(jobForm.numberOfOpenings),
        description: jobForm.description,
        requirements: jobForm.requirements.split("\n"),
        qualifications: jobForm.qualifications.split("\n"),
        closingDate: jobForm.closingDate
          ? new Date(`${jobForm.closingDate}T23:59:59`).getTime()
          : undefined,
      });
      setJobForm(emptyJobForm);
      setIsJobDialogOpen(false);
      toast({
        title: "Position created",
        description: "The opening is ready for candidate tracking.",
      });
    } catch (error: unknown) {
      toast({
        title: "Unable to create position",
        description: errorMessage(error, "Please check the position details."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-5 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#28262F]">Recruitment</h1>
            <p className="mt-1 text-sm text-[#77727F]">
              Move every opening from application to approved hire.
            </p>
          </div>
          <Dialog open={isJobDialogOpen} onOpenChange={setIsJobDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#695eff] text-white hover:bg-[#5547e8]">
                <Plus className="mr-2 h-4 w-4" /> Add position
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add position</DialogTitle>
                <DialogDescription>
                  Create a complete opening so candidates enter a reliable
                  pipeline.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitJob} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">
                    Job title <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="title"
                    required
                    value={jobForm.title}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, title: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    Department <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={jobForm.department}
                    onValueChange={(department) =>
                      setJobForm({ ...jobForm, department })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((department) => (
                        <SelectItem
                          key={department.name}
                          value={department.name}
                        >
                          {department.name}
                        </SelectItem>
                      ))}
                      {departments.length === 0 && (
                        <div className="space-y-2 p-2">
                          <Input
                            value={newDepartmentName}
                            onChange={(event) =>
                              setNewDepartmentName(event.target.value)
                            }
                            placeholder="Department name"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="w-full"
                            disabled={
                              isCreatingDepartment || !newDepartmentName.trim()
                            }
                            onClick={createDepartment}
                          >
                            {isCreatingDepartment
                              ? "Creating…"
                              : "Create department"}
                          </Button>
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>
                      Employment type <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={jobForm.employmentType}
                      onValueChange={(employmentType) =>
                        setJobForm({ ...jobForm, employmentType })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          "Full Time",
                          "Part Time",
                          "Contract",
                          "Temporary",
                          "Internship",
                          "Freelance",
                        ].map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openings">
                      Openings <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="openings"
                      type="number"
                      required
                      min="1"
                      value={jobForm.numberOfOpenings}
                      onChange={(event) =>
                        setJobForm({
                          ...jobForm,
                          numberOfOpenings: event.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    rows={4}
                    value={jobForm.description}
                    onChange={(event) =>
                      setJobForm({
                        ...jobForm,
                        description: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="requirements">
                    Requirements{" "}
                    <span className="text-xs font-normal text-[#77727F]">
                      one per line
                    </span>
                  </Label>
                  <Textarea
                    id="requirements"
                    rows={3}
                    value={jobForm.requirements}
                    onChange={(event) =>
                      setJobForm({
                        ...jobForm,
                        requirements: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="qualifications">
                    Qualifications{" "}
                    <span className="text-xs font-normal text-[#77727F]">
                      one per line
                    </span>
                  </Label>
                  <Textarea
                    id="qualifications"
                    rows={3}
                    value={jobForm.qualifications}
                    onChange={(event) =>
                      setJobForm({
                        ...jobForm,
                        qualifications: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="closingDate">Closing date</Label>
                  <Input
                    id="closingDate"
                    type="date"
                    min={new Date(Date.now() + 86_400_000)
                      .toISOString()
                      .slice(0, 10)}
                    value={jobForm.closingDate}
                    onChange={(event) =>
                      setJobForm({
                        ...jobForm,
                        closingDate: event.target.value,
                      })
                    }
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsJobDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      !jobForm.title.trim() ||
                      !jobForm.department ||
                      !jobForm.employmentType
                    }
                  >
                    {isSubmitting ? "Creating…" : "Create position"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <RecruitmentOverview summary={summary} />

        <div className="flex flex-col gap-3 rounded-xl border border-[#E7E5F4] bg-white p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#928C99]" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, department, or employment type"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value: typeof statusFilter) =>
              setStatusFilter(value)
            }
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="on-hold">On hold</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {jobs === undefined ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Card key={index} className="animate-pulse border-[#E7E5F4]">
                <CardContent className="h-24 p-5" />
              </Card>
            ))
          ) : filteredJobs.length > 0 ? (
            filteredJobs.map((job) => {
              const jobApplicants = (applicants ?? []).filter(
                (applicant) => applicant.jobId === job._id,
              );
              const hired = jobApplicants.filter(
                (applicant) => applicant.status === "hired",
              ).length;
              return (
                <Card
                  key={job._id}
                  className="cursor-pointer border-[#E7E5F4] transition hover:-translate-y-0.5 hover:shadow-md"
                  onClick={() =>
                    router.push(
                      getOrganizationPath(
                        effectiveOrganizationId,
                        `/recruitment/${job._id}`,
                      ),
                    )
                  }
                >
                  <CardContent className="flex items-start justify-between gap-4 p-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="rounded-xl bg-[#F1EFFF] p-2.5 text-[#695eff]">
                        <Briefcase className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold text-[#28262F]">
                          {job.title}
                        </h2>
                        <p className="mt-0.5 text-sm text-[#77727F]">
                          {job.department} · {job.employmentType} ·{" "}
                          {job.numberOfOpenings} opening
                          {job.numberOfOpenings === 1 ? "" : "s"}
                        </p>
                        <p className="mt-1 text-xs text-[#77727F]">
                          {jobApplicants.length} applicant
                          {jobApplicants.length === 1 ? "" : "s"} · {hired}/
                          {job.numberOfOpenings} filled
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {job.status === "on-hold" ? "On hold" : job.status}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-[#928C99]" />
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card className="border-dashed border-[#D7D3EA]">
              <CardContent className="py-14 text-center">
                <Briefcase className="mx-auto mb-3 h-10 w-10 text-[#BBB6C4]" />
                <p className="font-medium text-[#5F5967]">
                  {jobs.length === 0
                    ? "No positions yet"
                    : "No positions match these filters"}
                </p>
                <p className="mt-1 text-sm text-[#928C99]">
                  {jobs.length === 0
                    ? "Create an opening to start the hiring pipeline."
                    : "Try a different search or status."}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
