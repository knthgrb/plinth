"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TiptapEditor } from "@/components/tiptap-editor";
import { createAnnouncement, updateAnnouncement } from "@/actions/announcements";
import { generateUploadUrl } from "@/actions/files";
import { useToast } from "@/components/ui/use-toast";
import { X, FileText, Check } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { Id } from "@/convex/_generated/dataModel";

export type AnnouncementEditSnapshot = {
  _id: string;
  title: string;
  content: string;
  targetAudience: "all" | "department" | "specific-employees";
  departments?: string[];
  specificEmployees?: string[];
  acknowledgementRequired: boolean;
  attachments?: string[];
  attachmentContentTypes?: string[];
  authorDisplayName?: string;
};

interface CreateAnnouncementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** When set, modal edits this announcement instead of creating a new one */
  editingAnnouncement?: AnnouncementEditSnapshot | null;
  onSuccess?: () => void;
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per file
const ALLOWED_IMAGE_VIDEO_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,video/mp4,video/webm,video/quicktime,video/x-msvideo";

function isImageOrVideo(file: File): boolean {
  const t = file.type?.toLowerCase() || "";
  return t.startsWith("image/") || t.startsWith("video/");
}

interface FileItem {
  id: string;
  file: File;
  contentType: string; // MIME type for display/storage
  storageId?: string;
  uploading: boolean;
}

type ExistingAttachmentRow = {
  id: string;
  storageId: string;
  contentType: string;
};

export function CreateAnnouncementModal({
  isOpen,
  onOpenChange,
  organizationId,
  editingAnnouncement = null,
  onSuccess,
}: CreateAnnouncementModalProps) {
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();

  // Fetch departments and employees
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
          status: "active",
        }
      : "skip",
  );

  const currentUser = useQuery(
    (api as any).organizations.getCurrentUser,
    organizationId
      ? { organizationId: organizationId as Id<"organizations"> }
      : "skip",
  );

  const canChoosePostAs =
    currentUser?.role === "admin" ||
    currentUser?.role === "hr" ||
    currentUser?.role === "owner";

  const [postAs, setPostAs] = useState<"admin" | "user">("admin");

  const [formData, setFormData] = useState({
    title: "",
    content: JSON.stringify({ type: "doc", content: [] }),
    targetAudience: "all" as "all" | "department" | "specific-employees",
    departments: [] as string[],
    specificEmployees: [] as string[],
    acknowledgementRequired: false,
  });
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  const [existingAttachments, setExistingAttachments] = useState<
    ExistingAttachmentRow[]
  >([]);

  useEffect(() => {
    if (!isOpen) return;
    if (editingAnnouncement) {
      setFormData({
        title: editingAnnouncement.title,
        content:
          editingAnnouncement.content ||
          JSON.stringify({ type: "doc", content: [] }),
        targetAudience: editingAnnouncement.targetAudience,
        departments: editingAnnouncement.departments ?? [],
        specificEmployees: (editingAnnouncement.specificEmployees ?? []).map(
          String,
        ),
        acknowledgementRequired: Boolean(
          editingAnnouncement.acknowledgementRequired,
        ),
      });
      setExistingAttachments(
        (editingAnnouncement.attachments ?? []).map(
          (sid: string, i: number) => ({
            id: `existing-${i}-${sid}`,
            storageId: sid,
            contentType:
              editingAnnouncement.attachmentContentTypes?.[i] ?? "",
          }),
        ),
      );
      setFiles([]);
      setPostAs(
        editingAnnouncement.authorDisplayName === "Admin" ? "admin" : "user",
      );
      setEmployeeSearch("");
      return;
    }
    setFormData({
      title: "",
      content: JSON.stringify({ type: "doc", content: [] }),
      targetAudience: "all",
      departments: [],
      specificEmployees: [],
      acknowledgementRequired: false,
    });
    setExistingAttachments([]);
    setFiles([]);
    setPostAs("admin");
    setEmployeeSearch("");
  }, [isOpen, editingAnnouncement?._id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const valid: FileItem[] = [];
    for (const file of selectedFiles) {
      if (!isImageOrVideo(file)) {
        toast({
          title: "Invalid file type",
          description: `${file.name}: Only images and videos are allowed (e.g. JPG, PNG, GIF, WebP, MP4, WebM).`,
          variant: "destructive",
        });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast({
          title: "File too large",
          description: `${file.name}: Max size is 10MB per file.`,
          variant: "destructive",
        });
        continue;
      }
      valid.push({
        id: Math.random().toString(36).substring(7),
        file,
        contentType: file.type || "application/octet-stream",
        uploading: false,
      });
    }
    setFiles((prev) => [...prev, ...valid]);
    e.target.value = "";
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const toggleDepartment = (dept: string) => {
    setFormData((prev) => ({
      ...prev,
      departments: prev.departments.includes(dept)
        ? prev.departments.filter((d) => d !== dept)
        : [...prev.departments, dept],
    }));
  };

  const toggleEmployee = (employeeId: string) => {
    setFormData((prev) => ({
      ...prev,
      specificEmployees: prev.specificEmployees.includes(employeeId)
        ? prev.specificEmployees.filter((id) => id !== employeeId)
        : [...prev.specificEmployees, employeeId],
    }));
  };

  const removeExistingAttachment = (id: string) => {
    setExistingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const filteredEmployees = employees?.filter((emp: any) => {
    if (!employeeSearch) return true;
    const searchLower = employeeSearch.toLowerCase();
    return (
      emp.personalInfo.firstName.toLowerCase().includes(searchLower) ||
      emp.personalInfo.lastName.toLowerCase().includes(searchLower) ||
      emp.employment.employeeId.toLowerCase().includes(searchLower) ||
      emp.personalInfo.email?.toLowerCase().includes(searchLower)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) return;

    setIsSubmitting(true);
    try {
      // Upload files first
      const uploadedFileIds: string[] = [];

      for (const fileItem of files) {
        if (fileItem.storageId) {
          uploadedFileIds.push(fileItem.storageId);
          continue;
        }

        try {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileItem.id ? { ...f, uploading: true } : f,
            ),
          );

          const uploadUrl = await generateUploadUrl();
          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": fileItem.file.type },
            body: fileItem.file,
          });

          if (!result.ok) {
            throw new Error(`Failed to upload ${fileItem.file.name}`);
          }

          const responseText = await result.text();
          let storageId: string;
          try {
            const jsonResponse = JSON.parse(responseText);
            storageId = jsonResponse.storageId || jsonResponse;
          } catch {
            storageId = responseText;
          }
          storageId = storageId.trim().replace(/^["']|["']$/g, "");

          uploadedFileIds.push(storageId);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileItem.id ? { ...f, storageId, uploading: false } : f,
            ),
          );
        } catch (error: any) {
          console.error(`Error uploading ${fileItem.file.name}:`, error);
          toast({
            title: "Error",
            description: `Failed to upload ${fileItem.file.name}`,
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }
      }

      // Validate selections
      if (
        formData.targetAudience === "department" &&
        formData.departments.length === 0
      ) {
        toast({
          title: "Validation Error",
          description: "Please select at least one department",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (
        formData.targetAudience === "specific-employees" &&
        formData.specificEmployees.length === 0
      ) {
        toast({
          title: "Validation Error",
          description: "Please select at least one employee",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      const keptIds = existingAttachments.map((a) => a.storageId);
      const keptTypes = existingAttachments.map(
        (a) => a.contentType || "application/octet-stream",
      );
      const allAttachmentIds = [...keptIds, ...uploadedFileIds];
      const allContentTypes = [
        ...keptTypes,
        ...files.map((f) => f.contentType),
      ];

      if (editingAnnouncement) {
        await updateAnnouncement({
          announcementId: editingAnnouncement._id,
          organizationId,
          title: formData.title,
          content: formData.content,
          targetAudience: formData.targetAudience,
          departments:
            formData.targetAudience === "department"
              ? formData.departments
              : undefined,
          specificEmployees:
            formData.targetAudience === "specific-employees"
              ? formData.specificEmployees
              : undefined,
          acknowledgementRequired: formData.acknowledgementRequired,
          attachments: allAttachmentIds,
          attachmentContentTypes: allContentTypes,
          postAs: canChoosePostAs ? postAs : "admin",
        });
        toast({
          title: "Success",
          description: "Announcement updated",
        });
      } else {
        await createAnnouncement({
          organizationId,
          title: formData.title,
          content: formData.content,
          targetAudience: formData.targetAudience,
          departments:
            formData.targetAudience === "department"
              ? formData.departments
              : undefined,
          specificEmployees:
            formData.targetAudience === "specific-employees"
              ? formData.specificEmployees
              : undefined,
          acknowledgementRequired: formData.acknowledgementRequired,
          attachments:
            uploadedFileIds.length > 0 ? uploadedFileIds : undefined,
          attachmentContentTypes:
            uploadedFileIds.length > 0
              ? files.map((f) => f.contentType)
              : undefined,
          postAs: canChoosePostAs ? postAs : "admin",
        });
        toast({
          title: "Success",
          description: "Announcement created successfully",
        });
      }

      // Reset form
      setFormData({
        title: "",
        content: JSON.stringify({ type: "doc", content: [] }),
        targetAudience: "all",
        departments: [],
        specificEmployees: [],
        acknowledgementRequired: false,
      });
      setFiles([]);
      setExistingAttachments([]);
      setEmployeeSearch("");
      setPostAs("admin");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("Error saving announcement:", error);
      toast({
        title: "Error",
        description:
          error.message || "Failed to save announcement",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingAnnouncement ? "Edit announcement" : "Create Announcement"}
          </DialogTitle>
          <DialogDescription>
            {editingAnnouncement
              ? "Update this announcement. Only you can edit announcements you created."
              : "Create a new announcement to share with employees."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                required
              />
            </div>
            {canChoosePostAs && (
              <div className="space-y-2">
                <Label>Post as</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-500">Show author as:</span>
                  <button
                    type="button"
                    onClick={() => setPostAs("admin")}
                    className={`text-sm px-3 py-1.5 rounded-md border ${
                      postAs === "admin"
                        ? "bg-purple-100 border-purple-300 text-purple-800 font-medium"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => setPostAs("user")}
                    className={`text-sm px-3 py-1.5 rounded-md border ${
                      postAs === "user"
                        ? "bg-purple-100 border-purple-300 text-purple-800 font-medium"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {currentUser?.name ||
                      currentUser?.email ||
                      "Your name"}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Defaults to Admin so announcements appear from the organization,
                  not your personal account.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="targetAudience">
                Target Audience <span className="text-red-500">*</span>
              </Label>
                <Select
                  value={formData.targetAudience}
                  onValueChange={(value: any) =>
                    setFormData({
                      ...formData,
                      targetAudience: value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    <SelectItem value="department">
                      Specific Department
                    </SelectItem>
                    <SelectItem value="specific-employees">
                      Specific Employees
                    </SelectItem>
                  </SelectContent>
                </Select>
            </div>

            {/* Department Selection */}
            {formData.targetAudience === "department" && (
              <div className="space-y-2">
                <Label>
                  Select Departments <span className="text-red-500">*</span>
                </Label>
                <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-2">
                  {settings?.departments && settings.departments.length > 0 ? (
                    settings.departments.map(
                      (dept: string | { name: string; color?: string }) => {
                        const deptName =
                          typeof dept === "string" ? dept : dept.name;
                        const deptColor =
                          typeof dept === "string" ? undefined : dept.color;
                        return (
                          <label
                            key={deptName}
                            className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={formData.departments.includes(deptName)}
                              onChange={() => toggleDepartment(deptName)}
                              className="h-4 w-4 accent-purple-600"
                            />
                            {deptColor && (
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: deptColor }}
                              />
                            )}
                            <span className="text-sm">{deptName}</span>
                          </label>
                        );
                      },
                    )
                  ) : (
                    <p className="text-sm text-gray-500 p-2">
                      No departments available. Please add departments in
                      Settings.
                    </p>
                  )}
                </div>
                {formData.departments.length > 0 && (
                  <p className="text-sm text-gray-500">
                    {formData.departments.length} department(s) selected
                  </p>
                )}
              </div>
            )}

            {/* Employee Selection */}
            {formData.targetAudience === "specific-employees" && (
              <div className="space-y-2">
                <Label>
                  Select Employees <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="Search employees..."
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="mb-2"
                />
                <div className="max-h-64 overflow-y-auto border rounded-md p-3 space-y-2">
                  {filteredEmployees && filteredEmployees.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (
                              formData.specificEmployees.length ===
                              filteredEmployees.length
                            ) {
                              setFormData((prev) => ({
                                ...prev,
                                specificEmployees: [],
                              }));
                            } else {
                              setFormData((prev) => ({
                                ...prev,
                                specificEmployees: filteredEmployees.map(
                                  (e: any) => e._id,
                                ),
                              }));
                            }
                          }}
                        >
                          {formData.specificEmployees.length ===
                          filteredEmployees.length
                            ? "Deselect All"
                            : "Select All"}
                        </Button>
                      </div>
                      {filteredEmployees.map((emp: any) => (
                        <label
                          key={emp._id}
                          className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={formData.specificEmployees.includes(
                              emp._id,
                            )}
                            onChange={() => toggleEmployee(emp._id)}
                            className="h-4 w-4 accent-purple-600"
                          />
                          <span className="text-sm">
                            {emp.personalInfo.firstName}{" "}
                            {emp.personalInfo.lastName} -{" "}
                            {emp.employment.employeeId}
                          </span>
                        </label>
                      ))}
                    </>
                  ) : (
                    <p className="text-sm text-gray-500 p-2">
                      {employeeSearch
                        ? "No employees found matching your search"
                        : "No employees available"}
                    </p>
                  )}
                </div>
                {formData.specificEmployees.length > 0 && (
                  <p className="text-sm text-gray-500">
                    {formData.specificEmployees.length} employee(s) selected
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="content">
                Content <span className="text-red-500">*</span>
              </Label>
              <TiptapEditor
                key={editingAnnouncement?._id ?? "create"}
                content={formData.content}
                onChange={(content) => setFormData({ ...formData, content })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attachments">Attachments (images & videos only)</Label>
              <p className="text-xs text-gray-500">
                JPG, PNG, GIF, WebP, MP4, WebM. Max 10MB per file.
              </p>
              <div className="space-y-2">
                <Input
                  id="attachments"
                  type="file"
                  multiple
                  accept={ALLOWED_IMAGE_VIDEO_TYPES}
                  onChange={handleFileSelect}
                  className="cursor-pointer"
                />
                {existingAttachments.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <p className="text-xs text-gray-500 font-medium">
                      Current attachments
                    </p>
                    {existingAttachments.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center gap-2 p-2 border rounded-lg bg-gray-50/80"
                      >
                        <FileText className="h-4 w-4 text-gray-500" />
                        <span className="flex-1 text-sm truncate font-mono text-xs">
                          {row.storageId.slice(0, 12)}…
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeExistingAttachment(row.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {files.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {files.map((fileItem) => (
                      <div
                        key={fileItem.id}
                        className="flex items-center gap-2 p-2 border rounded-lg"
                      >
                        <FileText className="h-4 w-4 text-gray-500" />
                        <span className="flex-1 text-sm truncate">
                          {fileItem.file.name}
                        </span>
                        {fileItem.uploading && (
                          <span className="text-xs text-gray-500">
                            Uploading...
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(fileItem.id)}
                          disabled={fileItem.uploading}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <input
                type="checkbox"
                id="acknowledgementRequired"
                checked={formData.acknowledgementRequired}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    acknowledgementRequired: e.target.checked,
                  })
                }
                className="mt-1 h-4 w-4 accent-purple-600"
              />
              <div className="flex-1">
                <Label
                  htmlFor="acknowledgementRequired"
                  className="font-medium cursor-pointer"
                >
                  Require Acknowledgement
                </Label>
                <p className="text-xs text-gray-600 mt-1">
                  When enabled, employees will be required to acknowledge they
                  have read this announcement. You can track who has
                  acknowledged it.
                </p>
              </div>
            </div>
          </div>
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
                ? editingAnnouncement
                  ? "Saving..."
                  : "Creating..."
                : editingAnnouncement
                  ? "Save changes"
                  : "Create Announcement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
