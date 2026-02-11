"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  ArrowLeft,
  Download,
  MoreHorizontal,
  Trash2,
  Archive,
  FileText,
  Upload,
  Link as LinkIcon,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  createApplicant,
  updateApplicant,
  updateApplicantStatus,
  addApplicantNote,
  deleteApplicant,
  deleteJob,
  archiveJob,
} from "@/actions/recruitment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateUploadUrl, getFileUrl } from "@/actions/files";
import { useOrganization } from "@/hooks/organization-context";
import { useRouter } from "next/navigation";
import { getOrganizationPath } from "@/utils/organization-routing";
import { useState, useRef, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DynamicApplicantsTable } from "../_components/dynamic-applicants-table";
import { ColumnManagementModal } from "../_components/column-management-modal";
import { Settings } from "lucide-react";

interface Column {
  id: string;
  label: string;
  field: string;
  type: "text" | "number" | "date" | "badge" | "link";
  sortable?: boolean;
  width?: string;
  customField?: boolean;
  isDefault?: boolean;
  hidden?: boolean;
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const resolvedParams = use(params);
  const jobId = resolvedParams.jobId;
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();

  const jobs = useQuery(
    (api as any).recruitment.getJobs,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const applicants = useQuery(
    (api as any).recruitment.getApplicants,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const selectedJob = jobs?.find((job: any) => job._id === jobId);
  const jobApplicants = applicants?.filter((a: any) => a.jobId === jobId) || [];

  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [tableColumns, setTableColumns] = useState<any[]>([]);

  // Initialize columns from settings or use defaults
  useEffect(() => {
    const DEFAULT_COLUMNS: Column[] = [
      {
        id: "name",
        label: "Name",
        field: "firstName",
        type: "text",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "email",
        label: "Email",
        field: "email",
        type: "text",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "phone",
        label: "Phone",
        field: "phone",
        type: "text",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "expectedSalary",
        label: "Expected Salary",
        field: "custom.expectedSalary",
        type: "number",
        sortable: true,
        width: "150px",
        customField: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "googleMeetLink",
        label: "Google Meet link",
        field: "googleMeetLink",
        type: "link",
        sortable: true,
        width: "120px",
        isDefault: true,
        hidden: false,
      },
      {
        id: "resume",
        label: "Resume",
        field: "resume",
        type: "text",
        sortable: true,
        width: "100px",
        isDefault: true,
        hidden: false,
      },
      {
        id: "notes",
        label: "Notes",
        field: "notes",
        type: "text",
        sortable: true,
        width: "100px",
        isDefault: true,
        hidden: false,
      },
      {
        id: "appliedDate",
        label: "Applied Date",
        field: "appliedDate",
        type: "date",
        sortable: true,
        width: "120px",
        isDefault: true,
        hidden: false,
      },
      {
        id: "status",
        label: "Status",
        field: "status",
        type: "badge",
        sortable: true,
        width: "120px",
        isDefault: true,
        hidden: false,
      },
    ];

    if (settings?.recruitmentTableColumns) {
      // Merge saved columns with defaults - ensure all defaults are present
      const savedColumns = settings.recruitmentTableColumns.filter(
        (c: Column) => !c.isDefault
      );
      const savedDefaultColumns = settings.recruitmentTableColumns.filter(
        (c: Column) => c.isDefault
      );

      // Merge defaults with saved defaults (preserve hidden state)
      const mergedDefaults = DEFAULT_COLUMNS.map((def) => {
        const saved = savedDefaultColumns.find((c: Column) => c.id === def.id);
        return saved ? { ...def, ...saved } : def;
      });

      setTableColumns([...mergedDefaults, ...savedColumns]);
    } else {
      setTableColumns(DEFAULT_COLUMNS);
    }
  }, [settings]);

  const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(
    null
  );
  const [isApplicantDialogOpen, setIsApplicantDialogOpen] = useState(false);
  const [applicantFormData, setApplicantFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    googleMeetLink: "",
    interviewVideoLink: "",
    portfolioLink: "",
  });

  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUrl, setResumeUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingFromUrl, setIsUploadingFromUrl] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteApplicantConfirmOpen, setDeleteApplicantConfirmOpen] =
    useState(false);
  const [isDeletingApplicant, setIsDeletingApplicant] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [editingLinks, setEditingLinks] = useState({
    googleMeetLink: "",
    interviewVideoLink: "",
    portfolioLink: "",
  });
  const [isSavingLinks, setIsSavingLinks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const sidePanelFileInputRef = useRef<HTMLInputElement>(null);
  const sidePanelDropZoneRef = useRef<HTMLDivElement>(null);
  const [sidePanelResumeFile, setSidePanelResumeFile] = useState<File | null>(
    null
  );
  const [sidePanelResumeUrl, setSidePanelResumeUrl] = useState("");

  // Get resume URL for selected applicant
  const [resumeUrlForView, setResumeUrlForView] = useState<string | null>(null);

  // Move all useCallback hooks before early returns
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      const validTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];

      if (!validTypes.includes(file.type)) {
        alert("Please upload a PDF, DOC, or DOCX file.");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        alert("File size must be less than 10MB.");
        return;
      }

      setResumeFile(file);
      setResumeUrl("");
    }
  }, []);

  const selectedApplicant = applicants?.find(
    (applicant: any) => applicant._id === selectedApplicantId
  );

  // Initialize editing links when selectedApplicant changes
  useEffect(() => {
    if (selectedApplicant) {
      setEditingLinks({
        googleMeetLink: selectedApplicant.googleMeetLink || "",
        interviewVideoLink: selectedApplicant.interviewVideoLink || "",
        portfolioLink: selectedApplicant.portfolioLink || "",
      });
    }
  }, [selectedApplicant]);

  useEffect(() => {
    if (selectedApplicant?.resume) {
      getFileUrl(selectedApplicant.resume)
        .then((url) => setResumeUrlForView(url))
        .catch(() => setResumeUrlForView(null));
    } else {
      setResumeUrlForView(null);
    }
  }, [selectedApplicant?.resume]);

  // Redirect to list if job is deleted (not found after jobs have loaded)
  useEffect(() => {
    if (jobs !== undefined && !selectedJob) {
      // Jobs have loaded but job not found - it's been deleted
      router.push(getOrganizationPath(currentOrganizationId, "/recruitment"));
    }
  }, [jobs, selectedJob, router]);

  // Show loading state while jobs are loading
  if (jobs === undefined) {
    return (
      <MainLayout>
        <div className="p-8">
          <div className="mb-6">
            <Button
              variant="ghost"
              onClick={() =>
                router.push(
                  getOrganizationPath(currentOrganizationId, "/recruitment")
                )
              }
              className="mb-4"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to positions
            </Button>
            <p className="text-[rgb(133,133,133)]">Loading...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  // If job is deleted (not found after jobs loaded), show redirecting message
  // The useEffect will handle the redirect
  if (!selectedJob) {
    return (
      <MainLayout>
        <div className="p-8">
          <div className="mb-6">
            <Button
              variant="ghost"
              onClick={() =>
                router.push(
                  getOrganizationPath(currentOrganizationId, "/recruitment")
                )
              }
              className="mb-4"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to positions
            </Button>
            <p className="text-[rgb(133,133,133)]">
              Position not found. Redirecting...
            </p>
          </div>
        </div>
      </MainLayout>
    );
  }

  const handleFileSelect = (file: File) => {
    const validTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!validTypes.includes(file.type)) {
      alert("Please upload a PDF, DOC, or DOCX file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("File size must be less than 10MB.");
      return;
    }

    setResumeFile(file);
    setResumeUrl("");
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const uploadFileFromUrl = async (url: string): Promise<string> => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch file from URL");

      const blob = await response.blob();
      const contentType = blob.type;

      const validTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (!validTypes.includes(contentType)) {
        throw new Error("Invalid file type. Please use PDF, DOC, or DOCX.");
      }

      if (blob.size > 10 * 1024 * 1024) {
        throw new Error("File size must be less than 10MB.");
      }

      const uploadUrl = await generateUploadUrl();
      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: blob,
      });

      if (!uploadResult.ok) {
        throw new Error("Failed to upload file");
      }

      const responseText = await uploadResult.text();
      let storageId: string;
      try {
        const jsonResponse = JSON.parse(responseText);
        storageId = jsonResponse.storageId || jsonResponse;
      } catch {
        storageId = responseText;
      }
      return storageId.trim().replace(/^["']|["']$/g, "");
    } catch (error: any) {
      throw new Error(error.message || "Failed to upload file from URL");
    }
  };

  const handleUrlPaste = async (url: string) => {
    if (!url.trim()) return;

    setIsUploadingFromUrl(true);
    try {
      const storageId = await uploadFileFromUrl(url);
      setResumeUrl("");
      if (selectedApplicantId) {
        await updateApplicant(selectedApplicantId, { resume: storageId });
        window.location.reload();
      } else {
        setResumeFile(null);
        alert("File uploaded! Please complete the form and submit.");
      }
    } catch (error: any) {
      alert(error.message || "Failed to upload file from URL");
    } finally {
      setIsUploadingFromUrl(false);
    }
  };

  const handleApplicantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !jobId) return;
    if (!resumeFile && !resumeUrl.trim()) {
      alert("Please upload a resume file or provide a file URL.");
      return;
    }

    setIsUploading(true);
    try {
      let storageId: string;

      if (resumeFile) {
        const uploadUrl = await generateUploadUrl();
        const uploadResult = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": resumeFile.type },
          body: resumeFile,
        });

        if (!uploadResult.ok) {
          throw new Error("Failed to upload resume");
        }

        const responseText = await uploadResult.text();
        try {
          const jsonResponse = JSON.parse(responseText);
          storageId = jsonResponse.storageId || jsonResponse;
        } catch {
          storageId = responseText;
        }
        storageId = storageId.trim().replace(/^["']|["']$/g, "");
      } else if (resumeUrl.trim()) {
        storageId = await uploadFileFromUrl(resumeUrl.trim());
      } else {
        throw new Error("No resume provided");
      }

      await createApplicant({
        organizationId: currentOrganizationId,
        jobId: jobId,
        firstName: applicantFormData.firstName,
        lastName: applicantFormData.lastName,
        email: applicantFormData.email || undefined,
        phone: applicantFormData.phone || undefined,
        resume: storageId,
        googleMeetLink: applicantFormData.googleMeetLink || undefined,
        interviewVideoLink: applicantFormData.interviewVideoLink || undefined,
        portfolioLink: applicantFormData.portfolioLink || undefined,
      });

      setIsApplicantDialogOpen(false);
      setApplicantFormData({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        googleMeetLink: "",
        interviewVideoLink: "",
        portfolioLink: "",
      });
      setResumeFile(null);
      setResumeUrl("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      window.location.reload();
    } catch (error: any) {
      console.error("Error creating applicant:", error);
      alert(error.message || "Failed to add applicant. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteJob = async () => {
    if (!jobId) return;
    setIsDeleting(true);
    try {
      await deleteJob(jobId);
      setDeleteConfirmOpen(false);
      // Immediately redirect to prevent rendering issues
      router.push(getOrganizationPath(currentOrganizationId, "/recruitment"));
      router.refresh(); // Force refresh to update the jobs list
    } catch (error: any) {
      alert(error.message || "Failed to delete job. Please try again.");
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  const handleArchiveJob = async () => {
    if (!jobId) return;
    setIsArchiving(true);
    try {
      await archiveJob(jobId);
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to archive job. Please try again.");
    } finally {
      setIsArchiving(false);
    }
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedApplicantId) return;
    setIsUpdatingStatus(true);
    try {
      await updateApplicantStatus(
        selectedApplicantId,
        status as
          | "new"
          | "screening"
          | "interview"
          | "assessment"
          | "offer"
          | "hired"
          | "rejected"
      );
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to update status. Please try again.");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSaveRejection = async () => {
    if (!selectedApplicantId || !declineReason.trim()) return;
    setIsAddingNote(true);
    try {
      await addApplicantNote(
        selectedApplicantId,
        `Reason for rejection: ${declineReason.trim()}`
      );
      setDeclineReason("");
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to save reason. Please try again.");
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleSaveLinks = async () => {
    if (!selectedApplicantId) return;
    setIsSavingLinks(true);
    try {
      await updateApplicant(selectedApplicantId, {
        googleMeetLink: editingLinks.googleMeetLink.trim() || undefined,
        interviewVideoLink: editingLinks.interviewVideoLink.trim() || undefined,
        portfolioLink: editingLinks.portfolioLink.trim() || undefined,
      });
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to save links. Please try again.");
    } finally {
      setIsSavingLinks(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedApplicantId || !newNote.trim()) return;
    setIsAddingNote(true);
    try {
      await addApplicantNote(selectedApplicantId, newNote.trim());
      setNewNote("");
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to add note. Please try again.");
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleDeleteApplicant = async () => {
    if (!selectedApplicantId) return;
    setIsDeletingApplicant(true);
    try {
      await deleteApplicant(selectedApplicantId);
      setDeleteApplicantConfirmOpen(false);
      setSelectedApplicantId(null);
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to delete applicant. Please try again.");
      setIsDeletingApplicant(false);
      setDeleteApplicantConfirmOpen(false);
    }
  };

  const handleUpdateApplicantResume = async (file?: File, url?: string) => {
    if (!selectedApplicantId) return;

    setIsUploading(true);
    try {
      let storageId: string;

      if (file) {
        const uploadUrl = await generateUploadUrl();
        const uploadResult = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!uploadResult.ok) {
          throw new Error("Failed to upload resume");
        }

        const responseText = await uploadResult.text();
        try {
          const jsonResponse = JSON.parse(responseText);
          storageId = jsonResponse.storageId || jsonResponse;
        } catch {
          storageId = responseText;
        }
        storageId = storageId.trim().replace(/^["']|["']$/g, "");
      } else if (url) {
        storageId = await uploadFileFromUrl(url);
      } else {
        throw new Error("No resume provided");
      }

      await updateApplicant(selectedApplicantId, { resume: storageId });
      setSidePanelResumeFile(null);
      setSidePanelResumeUrl("");
      if (sidePanelFileInputRef.current) {
        sidePanelFileInputRef.current.value = "";
      }
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to update resume. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() =>
              router.push(
                getOrganizationPath(currentOrganizationId, "/recruitment")
              )
            }
            className="mb-4 text-[rgb(64,64,64)] hover:bg-[rgb(250,250,250)]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to positions
          </Button>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-[rgb(64,64,64)]">
                {selectedJob.title || "Untitled position"}
              </h1>
              <p className="text-sm text-[rgb(133,133,133)] mt-1">
                {typeof selectedJob.department === "string"
                  ? selectedJob.department
                  : ((selectedJob.department as { name?: string })?.name ??
                    "—")}
                {selectedJob.employmentType &&
                  ` • ${selectedJob.employmentType}`}
                {selectedJob.numberOfOpenings != null &&
                  selectedJob.numberOfOpenings > 0 &&
                  ` • ${selectedJob.numberOfOpenings} opening${selectedJob.numberOfOpenings !== 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant="outline"
                className={
                  selectedJob.status === "open"
                    ? "bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none capitalize"
                    : "bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200 rounded-md focus:ring-0 focus:ring-offset-0 transition-none capitalize"
                }
              >
                {selectedJob.status === "open" ? "Open" : "Archived"}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {selectedJob.status === "open" && (
                    <DropdownMenuItem
                      onClick={handleArchiveJob}
                      disabled={isArchiving}
                    >
                      <Archive className="h-4 w-4 mr-2" />
                      Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={isDeleting}
                    className="text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <Card className="mb-6 border border-[#DDDDDD] rounded-xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
              Position details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {selectedJob.description &&
                selectedJob.description.trim() !== "" && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Description
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      {selectedJob.description}
                    </p>
                  </div>
                )}
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Number of Openings
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedJob.numberOfOpenings}
                </p>
              </div>
              {selectedJob.requirements &&
                selectedJob.requirements.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Requirements
                    </p>
                    <ul className="text-sm text-gray-600 mt-1 list-disc list-inside">
                      {selectedJob.requirements.map(
                        (req: string, idx: number) => (
                          <li key={idx}>{req}</li>
                        )
                      )}
                    </ul>
                  </div>
                )}
              {selectedJob.qualifications &&
                selectedJob.qualifications.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Qualifications
                    </p>
                    <ul className="text-sm text-gray-600 mt-1 list-disc list-inside">
                      {selectedJob.qualifications.map(
                        (qual: string, idx: number) => (
                          <li key={idx}>{qual}</li>
                        )
                      )}
                    </ul>
                  </div>
                )}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-[#DDDDDD] rounded-xl">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
                Applicants ({jobApplicants.length})
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsColumnModalOpen(true)}
                  className="h-8 border-[rgb(230,230,230)]"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Manage columns
                </Button>
                <Dialog
                  open={isApplicantDialogOpen}
                  onOpenChange={setIsApplicantDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      className="h-8 bg-[#695eff] hover:bg-[#5547e8] text-white"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add applicant
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Add applicant</DialogTitle>
                      <DialogDescription>
                        Add an applicant to this position.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleApplicantSubmit}>
                      <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="firstName">First Name *</Label>
                            <Input
                              id="firstName"
                              value={applicantFormData.firstName}
                              onChange={(e) =>
                                setApplicantFormData({
                                  ...applicantFormData,
                                  firstName: e.target.value,
                                })
                              }
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="lastName">Last Name *</Label>
                            <Input
                              id="lastName"
                              value={applicantFormData.lastName}
                              onChange={(e) =>
                                setApplicantFormData({
                                  ...applicantFormData,
                                  lastName: e.target.value,
                                })
                              }
                              required
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="email">Email (Optional)</Label>
                            <Input
                              id="email"
                              type="email"
                              value={applicantFormData.email}
                              onChange={(e) =>
                                setApplicantFormData({
                                  ...applicantFormData,
                                  email: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="phone">Phone (Optional)</Label>
                            <Input
                              id="phone"
                              type="tel"
                              value={applicantFormData.phone}
                              onChange={(e) =>
                                setApplicantFormData({
                                  ...applicantFormData,
                                  phone: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="googleMeetLink">
                            Google Meet Link (Optional)
                          </Label>
                          <Input
                            id="googleMeetLink"
                            type="url"
                            placeholder="https://meet.google.com/..."
                            value={applicantFormData.googleMeetLink}
                            onChange={(e) =>
                              setApplicantFormData({
                                ...applicantFormData,
                                googleMeetLink: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="interviewVideoLink">
                            Interview Video Link (Optional)
                          </Label>
                          <Input
                            id="interviewVideoLink"
                            type="url"
                            placeholder="https://youtube.com/... or https://vimeo.com/..."
                            value={applicantFormData.interviewVideoLink}
                            onChange={(e) =>
                              setApplicantFormData({
                                ...applicantFormData,
                                interviewVideoLink: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="portfolioLink">
                            Portfolio Link (Optional)
                          </Label>
                          <Input
                            id="portfolioLink"
                            type="url"
                            placeholder="https://portfolio.example.com"
                            value={applicantFormData.portfolioLink}
                            onChange={(e) =>
                              setApplicantFormData({
                                ...applicantFormData,
                                portfolioLink: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="resume">
                            Resume * (PDF, DOC, DOCX - Max 10MB)
                          </Label>
                          <div
                            ref={dropZoneRef}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                              isDragging
                                ? "border-purple-500 bg-purple-50"
                                : "border-gray-300 hover:border-gray-400"
                            }`}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                              onChange={handleFileInputChange}
                              className="hidden"
                            />
                            {resumeFile ? (
                              <div className="flex items-center justify-center gap-2">
                                <FileText className="h-5 w-5 text-purple-600" />
                                <span className="text-sm font-medium text-gray-700">
                                  {resumeFile.name}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setResumeFile(null);
                                    if (fileInputRef.current) {
                                      fileInputRef.current.value = "";
                                    }
                                  }}
                                  className="ml-2 text-gray-400 hover:text-gray-600"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div>
                                <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                                <p className="text-sm text-gray-600">
                                  Drag and drop your resume here, or click to
                                  browse
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  PDF, DOC, DOCX up to 10MB
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="resumeUrl">
                            Or paste a file URL to upload automatically
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="resumeUrl"
                              ref={urlInputRef}
                              type="url"
                              placeholder="https://example.com/resume.pdf"
                              value={resumeUrl}
                              onChange={(e) => setResumeUrl(e.target.value)}
                              onPaste={(e) => {
                                const pastedUrl =
                                  e.clipboardData.getData("text");
                                if (pastedUrl && pastedUrl.startsWith("http")) {
                                  setTimeout(() => {
                                    handleUrlPaste(pastedUrl);
                                  }, 100);
                                }
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                if (resumeUrl.trim()) {
                                  handleUrlPaste(resumeUrl.trim());
                                }
                              }}
                              disabled={isUploadingFromUrl || !resumeUrl.trim()}
                            >
                              <LinkIcon className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setIsApplicantDialogOpen(false);
                            setResumeFile(null);
                            setResumeUrl("");
                            if (fileInputRef.current) {
                              fileInputRef.current.value = "";
                            }
                          }}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={isUploading}>
                          {isUploading ? "Adding..." : "Add Applicant"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {jobApplicants.length > 0 ? (
              <DynamicApplicantsTable
                applicants={jobApplicants}
                columns={tableColumns}
                onRowClick={(applicant) =>
                  setSelectedApplicantId(applicant._id)
                }
                pageSize={20}
              />
            ) : (
              <p className="text-sm text-gray-500 italic text-center py-8">
                No applicants yet for this job posting.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Column Management Modal */}
        <ColumnManagementModal
          isOpen={isColumnModalOpen}
          onOpenChange={setIsColumnModalOpen}
          columns={tableColumns}
          onColumnsChange={setTableColumns}
        />
      </div>

      {/* Applicant Detail Side Panel */}
      <Sheet
        open={!!selectedApplicantId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedApplicantId(null);
            setSidePanelResumeFile(null);
            setSidePanelResumeUrl("");
            setDeclineReason("");
            setNewNote("");
            setEditingLinks({
              googleMeetLink: "",
              interviewVideoLink: "",
              portfolioLink: "",
            });
          } else if (selectedApplicant) {
            // Initialize editing links when panel opens
            setEditingLinks({
              googleMeetLink: selectedApplicant.googleMeetLink || "",
              interviewVideoLink: selectedApplicant.interviewVideoLink || "",
              portfolioLink: selectedApplicant.portfolioLink || "",
            });
          }
        }}
      >
        {selectedApplicant && (
          <SheetContent
            className="w-full sm:max-w-2xl overflow-y-auto"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader>
              <SheetTitle>
                {selectedApplicant.firstName} {selectedApplicant.lastName}
              </SheetTitle>
              <SheetDescription>
                Applicant Details • {selectedJob.title}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Applicant Info Panel */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Applicant Information
                </h3>
                <div className="space-y-3">
                  {tableColumns
                    .filter(
                      (col) =>
                        col.field !== "status" && !col.field.includes("Link")
                    )
                    .map((column) => {
                      const getFieldValue = (field: string): any => {
                        if (field.startsWith("custom.")) {
                          const customFieldKey = field.replace("custom.", "");
                          return (
                            selectedApplicant.customFields?.[customFieldKey] ||
                            null
                          );
                        }
                        if (field === "name" || field === "firstName") {
                          return `${selectedApplicant.firstName} ${selectedApplicant.lastName}`;
                        }
                        const parts = field.split(".");
                        let value: any = selectedApplicant;
                        for (const part of parts) {
                          value = value?.[part];
                          if (value === undefined || value === null)
                            return null;
                        }
                        return value;
                      };

                      const formatValue = (value: any, col: Column): string => {
                        if (value === null || value === undefined) return "—";
                        if (col.type === "number") {
                          if (
                            col.field.includes("Salary") ||
                            col.field.includes("salary")
                          ) {
                            return new Intl.NumberFormat("en-PH", {
                              style: "currency",
                              currency: "PHP",
                            }).format(Number(value));
                          }
                          return String(value);
                        }
                        if (col.type === "date" && typeof value === "number") {
                          return format(new Date(value), "MMM dd, yyyy");
                        }
                        return String(value);
                      };

                      const value = getFieldValue(column.field);
                      return (
                        <div key={column.id} className="space-y-1">
                          <div className="text-xs font-medium text-gray-500">
                            {column.label}
                          </div>
                          <div className="text-sm text-gray-900">
                            {formatValue(value, column)}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Contact Information
                </h3>
                <div className="space-y-2">
                  {selectedApplicant.email && (
                    <div>
                      <p className="text-xs text-gray-500">Email</p>
                      <p className="text-sm text-gray-900">
                        {selectedApplicant.email}
                      </p>
                    </div>
                  )}
                  {selectedApplicant.phone && (
                    <div>
                      <p className="text-xs text-gray-500">Phone</p>
                      <p className="text-sm text-gray-900">
                        {selectedApplicant.phone}
                      </p>
                    </div>
                  )}
                  {/* Links Section */}
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="text-xs font-semibold text-gray-700 mb-3">
                      Links
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="editGoogleMeet" className="text-xs">
                          Google Meet Link
                        </Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            id="editGoogleMeet"
                            type="url"
                            placeholder="https://meet.google.com/..."
                            value={editingLinks.googleMeetLink}
                            onChange={(e) =>
                              setEditingLinks({
                                ...editingLinks,
                                googleMeetLink: e.target.value,
                              })
                            }
                            className="text-sm"
                            autoFocus={false}
                          />
                          {editingLinks.googleMeetLink && (
                            <a
                              href={editingLinks.googleMeetLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:underline flex items-center"
                            >
                              <LinkIcon className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="editInterviewVideo" className="text-xs">
                          Interview Video Link
                        </Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            id="editInterviewVideo"
                            type="url"
                            placeholder="https://youtube.com/... or https://vimeo.com/..."
                            value={editingLinks.interviewVideoLink}
                            onChange={(e) =>
                              setEditingLinks({
                                ...editingLinks,
                                interviewVideoLink: e.target.value,
                              })
                            }
                            className="text-sm"
                          />
                          {editingLinks.interviewVideoLink && (
                            <a
                              href={editingLinks.interviewVideoLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:underline flex items-center"
                            >
                              <LinkIcon className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="editPortfolio" className="text-xs">
                          Portfolio Link
                        </Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            id="editPortfolio"
                            type="url"
                            placeholder="https://portfolio.example.com"
                            value={editingLinks.portfolioLink}
                            onChange={(e) =>
                              setEditingLinks({
                                ...editingLinks,
                                portfolioLink: e.target.value,
                              })
                            }
                            className="text-sm"
                          />
                          {editingLinks.portfolioLink && (
                            <a
                              href={editingLinks.portfolioLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:underline flex items-center"
                            >
                              <LinkIcon className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSaveLinks}
                        disabled={isSavingLinks}
                        className="w-full"
                      >
                        {isSavingLinks ? "Saving..." : "Save Links"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Update */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Status
                </h3>
                <Select
                  value={selectedApplicant.status}
                  onValueChange={handleUpdateStatus}
                  disabled={isUpdatingStatus}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="screening">Screening</SelectItem>
                    <SelectItem value="interview">Interview</SelectItem>
                    <SelectItem value="assessment">Assessment</SelectItem>
                    <SelectItem value="offer">Offer</SelectItem>
                    <SelectItem value="hired">Hired</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                {selectedApplicant.status === "rejected" && (
                  <div className="mt-3 space-y-2">
                    <Label htmlFor="declineReason" className="text-xs">
                      Reason for Rejection
                    </Label>
                    <Textarea
                      id="declineReason"
                      rows={3}
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      placeholder="Enter reason for rejection..."
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveRejection}
                      disabled={isAddingNote || !declineReason.trim()}
                    >
                      {isAddingNote ? "Saving..." : "Save Reason"}
                    </Button>
                  </div>
                )}
              </div>

              {/* Notes Section */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Notes
                </h3>
                {selectedApplicant.notes &&
                selectedApplicant.notes.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {selectedApplicant.notes.map((note: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-gray-500">
                            {format(
                              new Date(note.date),
                              "MMM dd, yyyy 'at' h:mm a"
                            )}
                          </p>
                        </div>
                        <p className="text-sm text-gray-900 whitespace-pre-wrap">
                          {note.content}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic mb-4">
                    No notes yet
                  </p>
                )}
                <div className="space-y-2">
                  <Textarea
                    rows={3}
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add a note..."
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddNote}
                    disabled={isAddingNote || !newNote.trim()}
                  >
                    {isAddingNote ? "Adding..." : "Add Note"}
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Resume
                </h3>
                {resumeUrlForView ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 border rounded-lg">
                      <FileText className="h-5 w-5 text-purple-600" />
                      <span className="text-sm text-gray-700 flex-1">
                        Resume.pdf
                      </span>
                      <a
                        href={resumeUrlForView}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-purple hover:text-brand-purple-hover"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">
                    No resume uploaded
                  </p>
                )}

                <div className="mt-4 space-y-3">
                  <p className="text-xs text-gray-500">
                    Upload New Resume (drag & drop or paste URL)
                  </p>
                  <div
                    ref={sidePanelDropZoneRef}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragging(false);
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        setSidePanelResumeFile(file);
                        handleUpdateApplicantResume(file);
                      }
                    }}
                    className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                      isDragging
                        ? "border-purple-500 bg-purple-50"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                    onClick={() => sidePanelFileInputRef.current?.click()}
                  >
                    <input
                      ref={sidePanelFileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setSidePanelResumeFile(file);
                          handleUpdateApplicantResume(file);
                        }
                      }}
                      className="hidden"
                    />
                    {sidePanelResumeFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileText className="h-5 w-5 text-purple-600" />
                        <span className="text-sm font-medium text-gray-700">
                          {sidePanelResumeFile.name}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <Upload className="h-6 w-6 mx-auto text-gray-400 mb-2" />
                        <p className="text-xs text-gray-600">
                          Drag and drop or click to browse
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      placeholder="Or paste file URL here (auto-uploads on paste)..."
                      value={sidePanelResumeUrl}
                      onChange={(e) => setSidePanelResumeUrl(e.target.value)}
                      onPaste={async (e) => {
                        const pastedUrl = e.clipboardData.getData("text");
                        if (pastedUrl && pastedUrl.startsWith("http")) {
                          setSidePanelResumeUrl(pastedUrl);
                          setTimeout(() => {
                            handleUpdateApplicantResume(undefined, pastedUrl);
                          }, 100);
                        }
                      }}
                      disabled={isUploading}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (sidePanelResumeUrl.trim()) {
                          handleUpdateApplicantResume(
                            undefined,
                            sidePanelResumeUrl.trim()
                          );
                        }
                      }}
                      disabled={isUploading || !sidePanelResumeUrl.trim()}
                    >
                      {isUploading ? (
                        <span className="text-xs">Uploading...</span>
                      ) : (
                        <LinkIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {isUploading && (
                    <p className="text-xs text-gray-500">Uploading resume...</p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteApplicantConfirmOpen(true)}
                  disabled={isDeletingApplicant}
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {isDeletingApplicant ? "Deleting..." : "Remove Applicant"}
                </Button>
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>

      {/* Delete Job Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Job</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this job? This action cannot be
              undone. All applicants associated with this job will remain in the
              system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteJob}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Applicant Confirmation Dialog */}
      <Dialog
        open={deleteApplicantConfirmOpen}
        onOpenChange={setDeleteApplicantConfirmOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Applicant</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this applicant? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteApplicantConfirmOpen(false)}
              disabled={isDeletingApplicant}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteApplicant}
              disabled={isDeletingApplicant}
            >
              {isDeletingApplicant ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
