"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { FileText, Paperclip, X } from "lucide-react";
import { createAnnouncement, updateAnnouncement } from "@/actions/announcements";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { TiptapEditor } from "@/components/tiptap-editor";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatLocalDateTime } from "@/lib/announcements/client-state";
import { uploadFileToStorage } from "@/lib/storage-upload";
import type {
  AnnouncementAudience,
  AnnouncementPostAs,
  AnnouncementPriority,
} from "@/services/announcements-service";

export type AnnouncementEditSnapshot = {
  _id: string;
  title: string;
  content: string;
  targetAudience: AnnouncementAudience;
  priority: AnnouncementPriority;
  departments: string[];
  specificEmployees: string[];
  scheduledPublishDate?: number;
  publicationStatus: "published" | "scheduled";
  attachments: string[];
  attachmentContentTypes: string[];
  authorPersona: "admin" | "employee" | "member";
};

type CreateAnnouncementModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  editingAnnouncement?: AnnouncementEditSnapshot | null;
  onSuccess?: () => void;
};

type FileItem = {
  id: string;
  file: File;
  contentType: string;
  storageId?: string;
  uploading: boolean;
};

type ExistingAttachment = {
  id: string;
  storageId: string;
  contentType: string;
};

type FormState = {
  title: string;
  content: string;
  targetAudience: AnnouncementAudience;
  departments: string[];
  specificEmployees: string[];
  priority: AnnouncementPriority;
  scheduledPublishDate: string;
};

const EMPTY_CONTENT = JSON.stringify({ type: "doc", content: [] });
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,video/mp4,video/webm,video/quicktime,video/x-msvideo";

function emptyForm(): FormState {
  return {
    title: "",
    content: EMPTY_CONTENT,
    targetAudience: "all",
    departments: [],
    specificEmployees: [],
    priority: "normal",
    scheduledPublishDate: "",
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function CreateAnnouncementModal({
  isOpen,
  onOpenChange,
  organizationId,
  editingAnnouncement = null,
  onSuccess,
}: CreateAnnouncementModalProps) {
  const { toast } = useToast();
  const organizationArgs = organizationId
    ? { organizationId: organizationId as Id<"organizations"> }
    : "skip";
  const settings = useQuery(api.settings.getSettings, organizationArgs);
  const employees = useQuery(
    api.employees.getEmployees,
    organizationId
      ? {
          organizationId: organizationId as Id<"organizations">,
          status: "active",
        }
      : "skip",
  );
  const currentUser = useQuery(
    api.organizations.getCurrentUser,
    organizationArgs,
  );
  const linkedEmployee = employees?.find(
    (employee) => String(employee._id) === String(currentUser?.employeeId),
  );
  const linkedEmployeeName = linkedEmployee
    ? `${linkedEmployee.personalInfo.firstName} ${linkedEmployee.personalInfo.lastName}`.trim()
    : null;

  const [postAs, setPostAs] = useState<AnnouncementPostAs>("admin");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<
    ExistingAttachment[]
  >([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (!editingAnnouncement) {
      setForm(emptyForm());
      setPostAs("admin");
      setExistingAttachments([]);
      setFiles([]);
      setEmployeeSearch("");
      return;
    }

    setForm({
      title: editingAnnouncement.title,
      content: editingAnnouncement.content || EMPTY_CONTENT,
      targetAudience: editingAnnouncement.targetAudience,
      departments: editingAnnouncement.departments,
      specificEmployees: editingAnnouncement.specificEmployees,
      priority: editingAnnouncement.priority,
      scheduledPublishDate:
        editingAnnouncement.publicationStatus === "scheduled" &&
        editingAnnouncement.scheduledPublishDate
          ? formatLocalDateTime(editingAnnouncement.scheduledPublishDate)
          : "",
    });
    setPostAs(
      editingAnnouncement.authorPersona === "employee" ? "employee" : "admin",
    );
    setExistingAttachments(
      editingAnnouncement.attachments.map((storageId, index) => ({
        id: `existing-${storageId}`,
        storageId,
        contentType:
          editingAnnouncement.attachmentContentTypes[index] ??
          "application/octet-stream",
      })),
    );
    setFiles([]);
    setEmployeeSearch("");
  }, [editingAnnouncement, isOpen]);

  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    if (!term) return employees ?? [];
    return (employees ?? []).filter((employee) => {
      const fullName = `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.toLowerCase();
      return (
        fullName.includes(term) ||
        employee.employment.employeeId.toLowerCase().includes(term) ||
        employee.personalInfo.email.toLowerCase().includes(term)
      );
    });
  }, [employeeSearch, employees]);

  const audienceCount = useMemo(() => {
    if (!employees) return 0;
    if (form.targetAudience === "all") return employees.length;
    if (form.targetAudience === "department") {
      return employees.filter((employee) =>
        form.departments.includes(employee.employment.department),
      ).length;
    }
    return form.specificEmployees.length;
  }, [employees, form.departments, form.specificEmployees.length, form.targetAudience]);

  const toggleDepartment = (department: string) => {
    setForm((current) => ({
      ...current,
      departments: current.departments.includes(department)
        ? current.departments.filter((item) => item !== department)
        : [...current.departments, department],
    }));
  };

  const toggleEmployee = (employeeId: string) => {
    setForm((current) => ({
      ...current,
      specificEmployees: current.specificEmployees.includes(employeeId)
        ? current.specificEmployees.filter((item) => item !== employeeId)
        : [...current.specificEmployees, employeeId],
    }));
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    const accepted: FileItem[] = [];
    for (const file of selectedFiles) {
      const isSupported =
        file.type.startsWith("image/") || file.type.startsWith("video/");
      if (!isSupported || file.size > MAX_ATTACHMENT_BYTES) {
        toast({
          title: isSupported ? "File too large" : "Unsupported file",
          description: isSupported
            ? `${file.name} exceeds the 10 MB limit.`
            : `${file.name} must be an image or video.`,
          variant: "destructive",
        });
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        contentType: file.type,
        uploading: false,
      });
    }
    setFiles((current) => [...current, ...accepted]);
    event.target.value = "";
  };

  const validate = (): boolean => {
    if (!form.title.trim()) return false;
    if (form.targetAudience === "department" && form.departments.length === 0) {
      toast({
        title: "Select a department",
        description: "Choose at least one department for this audience.",
        variant: "destructive",
      });
      return false;
    }
    if (
      form.targetAudience === "specific-employees" &&
      form.specificEmployees.length === 0
    ) {
      toast({
        title: "Select an employee",
        description: "Choose at least one employee for this audience.",
        variant: "destructive",
      });
      return false;
    }
    if (form.scheduledPublishDate) {
      const publishAt = new Date(form.scheduledPublishDate).getTime();
      if (!Number.isFinite(publishAt) || publishAt <= Date.now()) {
        toast({
          title: "Choose a future publish time",
          description: "Scheduled announcements must be published in the future.",
          variant: "destructive",
        });
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const uploadedAttachments: Array<{
        storageId: string;
        contentType: string;
      }> = [];
      for (const item of files) {
        setFiles((current) =>
          current.map((file) =>
            file.id === item.id ? { ...file, uploading: true } : file,
          ),
        );
        const storageId = await uploadFileToStorage({
          organizationId,
          purpose: "announcement_attachment",
          file: item.file,
        });
        uploadedAttachments.push({
          storageId,
          contentType: item.contentType,
        });
      }

      const attachments = [
        ...existingAttachments.map((item) => item.storageId),
        ...uploadedAttachments.map((item) => item.storageId),
      ];
      const attachmentContentTypes = [
        ...existingAttachments.map((item) => item.contentType),
        ...uploadedAttachments.map((item) => item.contentType),
      ];
      const scheduledPublishDate = form.scheduledPublishDate
        ? new Date(form.scheduledPublishDate).getTime()
        : undefined;
      const audienceFields = {
        departments:
          form.targetAudience === "department" ? form.departments : [],
        specificEmployees:
          form.targetAudience === "specific-employees"
            ? form.specificEmployees
            : [],
      };

      if (editingAnnouncement) {
        await updateAnnouncement({
          announcementId: editingAnnouncement._id,
          organizationId,
          title: form.title,
          content: form.content,
          priority: form.priority,
          targetAudience: form.targetAudience,
          ...audienceFields,
          scheduledPublishDate: scheduledPublishDate ?? null,
          attachments,
          attachmentContentTypes,
          postAs,
        });
      } else {
        await createAnnouncement({
          organizationId,
          title: form.title,
          content: form.content,
          priority: form.priority,
          targetAudience: form.targetAudience,
          ...audienceFields,
          scheduledPublishDate,
          attachments,
          attachmentContentTypes,
          postAs,
        });
      }

      toast({
        title: editingAnnouncement
          ? "Announcement updated"
          : scheduledPublishDate
            ? "Announcement scheduled"
            : "Announcement published",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        title: "Could not save announcement",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setFiles((current) =>
        current.map((file) => ({ ...file, uploading: false })),
      );
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingAnnouncement ? "Edit announcement" : "New announcement"}
          </DialogTitle>
          <DialogDescription>
            Share a clear update with everyone, selected departments, or specific
            employees.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Message</h3>
              <p className="text-xs text-gray-500">
                Choose the identity shown to recipients and write the update.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Post as</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={postAs === "admin" ? "default" : "outline"}
                  onClick={() => setPostAs("admin")}
                >
                  Admin
                </Button>
                {linkedEmployeeName && (
                  <Button
                    type="button"
                    variant={postAs === "employee" ? "default" : "outline"}
                    onClick={() => setPostAs("employee")}
                  >
                    {linkedEmployeeName}
                  </Button>
                )}
              </div>
              {!linkedEmployeeName && (
                <p className="text-xs text-gray-500">
                  Link your membership to an active employee record to post under
                  an employee name.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="announcement-title">Title</Label>
              <Input
                id="announcement-title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="What does the team need to know?"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Content</Label>
              <TiptapEditor
                key={editingAnnouncement?._id ?? "new-announcement"}
                content={form.content}
                onChange={(content) =>
                  setForm((current) => ({ ...current, content }))
                }
              />
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Delivery</h3>
              <p className="text-xs text-gray-500">
                Control who receives this announcement and when it appears.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select
                  value={form.targetAudience}
                  onValueChange={(targetAudience: AnnouncementAudience) =>
                    setForm((current) => ({ ...current, targetAudience }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everyone</SelectItem>
                    <SelectItem value="department">
                      Selected departments
                    </SelectItem>
                    <SelectItem value="specific-employees">
                      Selected employees
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(priority: AnnouncementPriority) =>
                    setForm((current) => ({ ...current, priority }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="important">Important</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.targetAudience === "department" && (
              <div className="space-y-2">
                <Label>Select departments</Label>
                <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border bg-white p-3 sm:grid-cols-2">
                  {(settings?.departments ?? []).map((department) => {
                    const name =
                      typeof department === "string"
                        ? department
                        : department.name;
                    return (
                      <label
                        key={name}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={form.departments.includes(name)}
                          onChange={() => toggleDepartment(name)}
                          className="h-4 w-4 accent-[#695eff]"
                        />
                        {name}
                      </label>
                    );
                  })}
                  {(settings?.departments?.length ?? 0) === 0 && (
                    <p className="text-sm text-gray-500">
                      Add departments in Settings first.
                    </p>
                  )}
                </div>
              </div>
            )}

            {form.targetAudience === "specific-employees" && (
              <div className="space-y-2">
                <Label>Select employees</Label>
                <Input
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  placeholder="Search by name, email, or employee ID"
                />
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border bg-white p-2">
                  {filteredEmployees.map((employee) => (
                    <label
                      key={employee._id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={form.specificEmployees.includes(employee._id)}
                        onChange={() => toggleEmployee(employee._id)}
                        className="h-4 w-4 accent-[#695eff]"
                      />
                      <span className="min-w-0 text-sm">
                        <span className="block truncate font-medium text-gray-900">
                          {employee.personalInfo.firstName}{" "}
                          {employee.personalInfo.lastName}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {employee.employment.employeeId} ·{" "}
                          {employee.employment.department}
                        </span>
                      </span>
                    </label>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <p className="px-2 py-3 text-sm text-gray-500">
                      No active employees found.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-[#695eff]/15 bg-[#695eff]/5 px-3 py-2 text-sm text-gray-700">
              {audienceCount} active {audienceCount === 1 ? "employee" : "employees"}
              {form.targetAudience === "all" ? " can view this announcement." : " selected."}
            </div>

            <div className="space-y-2">
              <Label htmlFor="scheduled-publish-date">Publish</Label>
              <Input
                id="scheduled-publish-date"
                type="datetime-local"
                min={formatLocalDateTime(Date.now())}
                value={form.scheduledPublishDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduledPublishDate: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-gray-500">
                Leave blank to publish immediately.
              </p>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-gray-200 p-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Attachments
              </h3>
              <p className="text-xs text-gray-500">
                Add images or videos up to 10 MB each.
              </p>
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 transition-colors hover:border-[#695eff] hover:bg-[#695eff]/5">
              <Paperclip className="h-4 w-4" />
              Add attachments
              <input
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                onChange={handleFileSelect}
                className="sr-only"
              />
            </label>
            {[...existingAttachments, ...files].length > 0 && (
              <div className="space-y-2">
                {existingAttachments.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2"
                  >
                    <FileText className="h-4 w-4 text-gray-400" />
                    <span className="flex-1 truncate text-xs text-gray-600">
                      Existing attachment
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove attachment"
                      onClick={() =>
                        setExistingAttachments((current) =>
                          current.filter((row) => row.id !== item.id),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {files.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2"
                  >
                    <FileText className="h-4 w-4 text-gray-400" />
                    <span className="flex-1 truncate text-xs text-gray-600">
                      {item.file.name}
                    </span>
                    {item.uploading ? (
                      <span className="text-xs text-gray-500">Uploading…</span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((file) => file.id !== item.id),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : editingAnnouncement
                  ? "Save changes"
                  : form.scheduledPublishDate
                    ? "Schedule announcement"
                    : "Publish announcement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
