"use client";

import { useState } from "react";
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
import { createAnnouncement } from "@/actions/announcements";
import { generateUploadUrl } from "@/actions/files";
import { useToast } from "@/components/ui/use-toast";
import { X, FileText, Check } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { Id } from "@/convex/_generated/dataModel";

interface CreateAnnouncementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

interface FileItem {
  id: string;
  file: File;
  storageId?: string;
  uploading: boolean;
}

export function CreateAnnouncementModal({
  isOpen,
  onOpenChange,
  organizationId,
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

  const [formData, setFormData] = useState({
    title: "",
    content: JSON.stringify({ type: "doc", content: [] }),
    priority: "normal" as "normal" | "important" | "urgent",
    targetAudience: "all" as "all" | "department" | "specific-employees",
    departments: [] as string[],
    specificEmployees: [] as string[],
    acknowledgementRequired: false,
  });
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const newFiles: FileItem[] = selectedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      uploading: false,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
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

      await createAnnouncement({
        organizationId,
        title: formData.title,
        content: formData.content,
        priority: formData.priority,
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
        attachments: uploadedFileIds.length > 0 ? uploadedFileIds : undefined,
      });

      toast({
        title: "Success",
        description: "Announcement created successfully",
      });

      // Reset form
      setFormData({
        title: "",
        content: JSON.stringify({ type: "doc", content: [] }),
        priority: "normal",
        targetAudience: "all",
        departments: [],
        specificEmployees: [],
        acknowledgementRequired: false,
      });
      setFiles([]);
      setEmployeeSearch("");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("Error creating announcement:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create announcement",
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
          <DialogTitle>Create Announcement</DialogTitle>
          <DialogDescription>
            Create a new announcement to share with employees.
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priority">
                  Priority <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value: any) =>
                    setFormData({ ...formData, priority: value })
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
            </div>

            {/* Department Selection */}
            {formData.targetAudience === "department" && (
              <div className="space-y-2">
                <Label>
                  Select Departments <span className="text-red-500">*</span>
                </Label>
                <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-2">
                  {settings?.departments && settings.departments.length > 0 ? (
                    settings.departments.map((dept: string) => (
                      <label
                        key={dept}
                        className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formData.departments.includes(dept)}
                          onChange={() => toggleDepartment(dept)}
                          className="h-4 w-4 accent-purple-600"
                        />
                        <span className="text-sm">{dept}</span>
                      </label>
                    ))
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
                content={formData.content}
                onChange={(content) => setFormData({ ...formData, content })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attachments">Attachments</Label>
              <div className="space-y-2">
                <Input
                  id="attachments"
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="cursor-pointer"
                />
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
              {isSubmitting ? "Creating..." : "Create Announcement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
