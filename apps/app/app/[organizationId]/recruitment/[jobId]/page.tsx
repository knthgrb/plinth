"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  addApplicantNote,
  createApplicant,
  deleteApplicant,
  deleteJob,
  setJobStatus,
} from "@/actions/recruitment";
import { getFileUrl } from "@/actions/files";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import { uploadFileToStorage } from "@/lib/storage-upload";
import {
  APPLICANT_STAGES,
  formatApplicantStage,
  summarizeRecruitmentPipeline,
  type ApplicantStage,
} from "@/lib/recruitment/workflow";
import {
  errorMessage,
  type RecruitmentColumn,
} from "@/lib/recruitment/ui-types";
import { getOrganizationPath } from "@/utils/organization-routing";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { ApplicantWorkflowPanel } from "../_components/applicant-workflow-panel";
import { ColumnManagementModal } from "../_components/column-management-modal";
import { DynamicApplicantsTable } from "../_components/dynamic-applicants-table";

const defaultColumns: RecruitmentColumn[] = [
  {
    id: "name",
    label: "Name",
    field: "firstName",
    type: "text",
    sortable: true,
    isDefault: true,
  },
  {
    id: "email",
    label: "Email",
    field: "email",
    type: "text",
    sortable: true,
    isDefault: true,
  },
  {
    id: "source",
    label: "Source",
    field: "source",
    type: "text",
    sortable: true,
    isDefault: true,
  },
  {
    id: "appliedDate",
    label: "Applied",
    field: "appliedDate",
    type: "date",
    sortable: true,
    isDefault: true,
  },
  {
    id: "status",
    label: "Stage",
    field: "status",
    type: "badge",
    sortable: true,
    isDefault: true,
  },
];

const emptyApplicantForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  source: "",
  sourceDetails: "",
  portfolioLink: "",
};

function validateResume(file: File): string | null {
  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  if (!allowedTypes.includes(file.type)) return "Use a PDF, DOC, or DOCX file.";
  if (file.size > 10 * 1024 * 1024)
    return "Resume files must be 10 MB or smaller.";
  return null;
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const jobs = useQuery(
    api.recruitment.getJobs,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const applicants = useQuery(
    api.recruitment.getApplicants,
    currentOrganizationId
      ? { organizationId: currentOrganizationId, jobId: jobId as Id<"jobs"> }
      : "skip",
  );
  const settings = useQuery(
    api.settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const members = useQuery(
    api.organizations.getOrganizationMembers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const currentUser = useQuery(
    api.organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const job = jobs?.find((candidate) => candidate._id === jobId);
  const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | ApplicantStage>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [applicantForm, setApplicantForm] = useState(emptyApplicantForm);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const columns = useMemo<RecruitmentColumn[]>(() => {
    const saved = settings?.recruitmentTableColumns ?? [];
    return defaultColumns.map((column) => {
      const savedColumn = saved.find((candidate) => candidate.id === column.id);
      return savedColumn ? { ...column, ...savedColumn } : column;
    });
  }, [settings?.recruitmentTableColumns]);
  const [localColumns, setLocalColumns] = useState<RecruitmentColumn[] | null>(
    null,
  );
  const tableColumns = localColumns ?? columns;

  const filteredApplicants = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (applicants ?? []).filter((applicant) => {
      const matchesStage =
        stageFilter === "all" || applicant.status === stageFilter;
      const matchesQuery =
        !query ||
        `${applicant.firstName} ${applicant.lastName} ${applicant.email} ${applicant.source ?? ""}`
          .toLocaleLowerCase()
          .includes(query);
      return matchesStage && matchesQuery;
    });
  }, [applicants, search, stageFilter]);
  const selectedApplicant = applicants?.find(
    (applicant) => applicant._id === selectedApplicantId,
  );
  const organizationMembers = useMemo(
    () => (members ?? []).filter((member) => member !== null),
    [members],
  );
  const summary = useMemo(
    () =>
      summarizeRecruitmentPipeline(
        job
          ? [
              {
                id: job._id,
                status: job.status,
                numberOfOpenings: job.numberOfOpenings,
              },
            ]
          : [],
        (applicants ?? []).map((applicant) => ({
          jobId: applicant.jobId,
          status: applicant.status,
          appliedDate: applicant.appliedDate,
          pipelineStageHistory: applicant.pipelineStageHistory,
        })),
      ),
    [applicants, job],
  );

  useEffect(() => {
    if (!currentOrganizationId || !selectedApplicant?.resume) {
      setResumeUrl(null);
      return;
    }
    let active = true;
    getFileUrl(currentOrganizationId, selectedApplicant.resume)
      .then((url) => {
        if (active) setResumeUrl(url);
      })
      .catch(() => {
        if (active) setResumeUrl(null);
      });
    return () => {
      active = false;
    };
  }, [currentOrganizationId, selectedApplicant?.resume]);

  useEffect(() => {
    if (jobs !== undefined && !job) {
      router.replace(
        getOrganizationPath(currentOrganizationId, "/recruitment"),
      );
    }
  }, [currentOrganizationId, job, jobs, router]);

  async function submitApplicant(event: React.FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId || !resumeFile) return;
    setIsSubmitting(true);
    try {
      const storageId = await uploadFileToStorage({
        organizationId: currentOrganizationId,
        purpose: "applicant_resume",
        file: resumeFile,
      });
      await createApplicant({
        organizationId: currentOrganizationId,
        jobId,
        firstName: applicantForm.firstName,
        lastName: applicantForm.lastName,
        email: applicantForm.email || undefined,
        phone: applicantForm.phone || undefined,
        source: applicantForm.source || undefined,
        sourceDetails: applicantForm.sourceDetails || undefined,
        portfolioLink: applicantForm.portfolioLink || undefined,
        resume: storageId,
      });
      setApplicantForm(emptyApplicantForm);
      setResumeFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsAddOpen(false);
      toast({
        title: "Applicant added",
        description: "The candidate entered the New stage.",
      });
    } catch (error: unknown) {
      toast({
        title: "Unable to add applicant",
        description: errorMessage(
          error,
          "Please review the candidate details.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateStatus(status: "open" | "closed" | "on-hold") {
    if (!job) return;
    try {
      await setJobStatus(job._id, status);
      toast({ title: "Position updated" });
    } catch (error: unknown) {
      toast({
        title: "Unable to update position",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  }

  async function removeJob() {
    if (!job) return;
    setIsDeleting(true);
    try {
      await deleteJob(job._id);
      router.replace(
        getOrganizationPath(currentOrganizationId, "/recruitment"),
      );
    } catch (error: unknown) {
      toast({
        title: "Unable to delete position",
        description: errorMessage(
          error,
          "Archive positions that already have applicants.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  async function addNote() {
    if (!selectedApplicant || !newNote.trim()) return;
    try {
      await addApplicantNote(selectedApplicant._id, newNote);
      setNewNote("");
    } catch (error: unknown) {
      toast({
        title: "Unable to add note",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  }

  async function removeApplicant() {
    if (!selectedApplicant) return;
    try {
      await deleteApplicant(selectedApplicant._id);
      setSelectedApplicantId(null);
      toast({ title: "Applicant removed" });
    } catch (error: unknown) {
      toast({
        title: "Unable to remove applicant",
        description: errorMessage(
          error,
          "Converted employees cannot be removed.",
        ),
        variant: "destructive",
      });
    }
  }

  if (!job) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-[#77727F]">Loading position…</div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-5 sm:p-8">
        <div>
          <Button
            variant="ghost"
            className="mb-3 -ml-3"
            onClick={() =>
              router.push(
                getOrganizationPath(currentOrganizationId, "/recruitment"),
              )
            }
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to recruitment
          </Button>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold text-[#28262F]">
                  {job.title}
                </h1>
                <Badge variant="outline" className="capitalize">
                  {job.status === "on-hold" ? "On hold" : job.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[#77727F]">
                {job.department} · {job.employmentType} · {job.numberOfOpenings}{" "}
                opening{job.numberOfOpenings === 1 ? "" : "s"}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {job.status !== "open" && (
                  <DropdownMenuItem onClick={() => updateStatus("open")}>
                    <PlayCircle className="mr-2 h-4 w-4" /> Reopen
                  </DropdownMenuItem>
                )}
                {job.status === "open" && (
                  <DropdownMenuItem onClick={() => updateStatus("on-hold")}>
                    <PauseCircle className="mr-2 h-4 w-4" /> Put on hold
                  </DropdownMenuItem>
                )}
                {job.status !== "closed" && (
                  <DropdownMenuItem onClick={() => updateStatus("closed")}>
                    <XCircle className="mr-2 h-4 w-4" /> Close
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={isDeleting}
                  onClick={removeJob}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete empty position
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Applicants", value: summary.totalApplicants },
            { label: "Active", value: summary.activeCandidates },
            { label: "Awaiting decision", value: summary.awaitingDecision },
            { label: "Needs attention", value: summary.staleCandidates },
          ].map((metric) => (
            <Card key={metric.label} className="border-[#E7E5F4]">
              <CardContent className="p-4">
                <p className="text-2xl font-semibold">{metric.value}</p>
                <p className="text-xs text-[#77727F]">{metric.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {(job.description ||
          job.requirements.length > 0 ||
          job.qualifications.length > 0) && (
          <Card className="border-[#E7E5F4]">
            <CardHeader>
              <CardTitle className="text-base">Position brief</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-3">
              {job.description && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#77727F]">
                    Description
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {job.description}
                  </p>
                </div>
              )}
              {job.requirements.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#77727F]">
                    Requirements
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {job.requirements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {job.qualifications.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#77727F]">
                    Qualifications
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {job.qualifications.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-[#E7E5F4]">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Candidate workspace</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsColumnModalOpen(true)}
                >
                  <Settings className="mr-2 h-4 w-4" /> Columns
                </Button>
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" /> Add applicant
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>Add applicant</DialogTitle>
                      <DialogDescription>
                        Add a sourced candidate with resume evidence.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submitApplicant} className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>First name *</Label>
                          <Input
                            required
                            value={applicantForm.firstName}
                            onChange={(event) =>
                              setApplicantForm({
                                ...applicantForm,
                                firstName: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Last name *</Label>
                          <Input
                            required
                            value={applicantForm.lastName}
                            onChange={(event) =>
                              setApplicantForm({
                                ...applicantForm,
                                lastName: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={applicantForm.email}
                            onChange={(event) =>
                              setApplicantForm({
                                ...applicantForm,
                                email: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Phone</Label>
                          <Input
                            value={applicantForm.phone}
                            onChange={(event) =>
                              setApplicantForm({
                                ...applicantForm,
                                phone: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Source</Label>
                          <Input
                            placeholder="Referral, LinkedIn, careers page"
                            value={applicantForm.source}
                            onChange={(event) =>
                              setApplicantForm({
                                ...applicantForm,
                                source: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Source details</Label>
                          <Input
                            placeholder="Referrer or campaign"
                            value={applicantForm.sourceDetails}
                            onChange={(event) =>
                              setApplicantForm({
                                ...applicantForm,
                                sourceDetails: event.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Portfolio link</Label>
                        <Input
                          type="url"
                          value={applicantForm.portfolioLink}
                          onChange={(event) =>
                            setApplicantForm({
                              ...applicantForm,
                              portfolioLink: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Resume *</Label>
                        <Input
                          ref={fileInputRef}
                          type="file"
                          required
                          accept=".pdf,.doc,.docx"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const validation = validateResume(file);
                            if (validation) {
                              toast({
                                title: validation,
                                variant: "destructive",
                              });
                              event.target.value = "";
                              return;
                            }
                            setResumeFile(file);
                          }}
                        />
                        {resumeFile && (
                          <p className="text-xs text-[#77727F]">
                            <Upload className="mr-1 inline h-3 w-3" />
                            {resumeFile.name}
                          </p>
                        )}
                      </div>
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsAddOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={isSubmitting || !resumeFile}
                        >
                          {isSubmitting ? "Adding…" : "Add applicant"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#928C99]" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search candidate, email, or source"
                />
              </div>
              <Select
                value={stageFilter}
                onValueChange={(value: typeof stageFilter) =>
                  setStageFilter(value)
                }
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {APPLICANT_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {formatApplicantStage(stage)} (
                      {summary.stageCounts[stage]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <DynamicApplicantsTable
              applicants={filteredApplicants}
              columns={tableColumns}
              onRowClick={(applicant) => setSelectedApplicantId(applicant._id)}
            />
          </CardContent>
        </Card>
        <ColumnManagementModal
          isOpen={isColumnModalOpen}
          onOpenChange={setIsColumnModalOpen}
          columns={tableColumns}
          onColumnsChange={setLocalColumns}
        />
      </div>

      <Sheet
        open={Boolean(selectedApplicant)}
        onOpenChange={(open) => !open && setSelectedApplicantId(null)}
      >
        {selectedApplicant && (
          <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle>
                {selectedApplicant.firstName} {selectedApplicant.lastName}
              </SheetTitle>
              <SheetDescription>
                {selectedApplicant.email || "No email"} · Applied{" "}
                {format(new Date(selectedApplicant.appliedDate), "MMM d, yyyy")}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-[#77727F]">Source</p>
                  <p className="text-sm font-medium">
                    {selectedApplicant.source || "Not recorded"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#77727F]">Phone</p>
                  <p className="text-sm font-medium">
                    {selectedApplicant.phone || "Not recorded"}
                  </p>
                </div>
                {selectedApplicant.portfolioLink && (
                  <a
                    href={selectedApplicant.portfolioLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-[#695eff] hover:underline"
                  >
                    Portfolio <ExternalLink className="inline h-3 w-3" />
                  </a>
                )}
                {resumeUrl && (
                  <a
                    href={resumeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-[#695eff] hover:underline"
                  >
                    <FileText className="mr-1 inline h-3 w-3" /> Resume{" "}
                    <ExternalLink className="inline h-3 w-3" />
                  </a>
                )}
              </div>
              <ApplicantWorkflowPanel
                applicant={selectedApplicant}
                job={job}
                members={organizationMembers}
                canApproveOffer={
                  currentUser?.role === "owner" || currentUser?.role === "admin"
                }
              />
              <section>
                <h3 className="text-sm font-semibold">Notes</h3>
                <div className="mt-3 space-y-2">
                  {selectedApplicant.notes.map((note, index) => (
                    <div
                      key={`${note.date}-${index}`}
                      className="rounded-lg bg-[#F7F6FA] p-3"
                    >
                      <p className="text-xs text-[#928C99]">
                        {format(new Date(note.date), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">
                        {note.content}
                      </p>
                    </div>
                  ))}
                  {selectedApplicant.notes.length === 0 && (
                    <p className="text-sm text-[#928C99]">No notes yet.</p>
                  )}
                </div>
                <Textarea
                  className="mt-3"
                  rows={2}
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                  placeholder="Add decision context or follow-up"
                />
                <Button
                  className="mt-2"
                  size="sm"
                  disabled={!newNote.trim()}
                  onClick={addNote}
                >
                  Add note
                </Button>
              </section>
              <Button
                variant="outline"
                className="w-full text-red-600"
                onClick={removeApplicant}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Remove applicant
              </Button>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </MainLayout>
  );
}
