"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  Search,
  Plus,
  ChevronDown,
  X,
  Settings,
} from "lucide-react";
import { format } from "date-fns";
import { useOrganization } from "@/hooks/organization-context";
import { getFileUrl as getFileUrlAction } from "@/actions/files";
import { useToast } from "@/components/ui/use-toast";
import { updateDefaultRequirements } from "@/actions/organizations";
import { addRequirement, updateRequirementFile } from "@/actions/employees";
import { DynamicRequirementsTable } from "./_components/dynamic-requirements-table";
import { RequirementsColumnManagementModal } from "./_components/requirements-column-management-modal";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/utils/utils";

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

// Lazy load modal components
const DefaultRequirementsDialog = dynamic(
  () =>
    import("./_components/default-requirements-dialog").then(
      (mod) => mod.DefaultRequirementsDialog,
    ),
  { ssr: false },
);

const EmployeeRequirementsModal = dynamic(
  () =>
    import("./_components/employee-requirements-modal").then(
      (mod) => mod.EmployeeRequirementsModal,
    ),
  { ssr: false },
);

const FilePreviewDialog = dynamic(
  () =>
    import("./_components/file-preview-dialog").then(
      (mod) => mod.FilePreviewDialog,
    ),
  { ssr: false },
);

// Checkbox component - simple implementation
const Checkbox = ({
  checked,
  disabled,
  className,
}: {
  checked?: boolean;
  disabled?: boolean;
  className?: string;
}) => (
  <input
    type="checkbox"
    checked={checked}
    disabled={disabled}
    readOnly
    className={`h-4 w-4 rounded border-gray-300 ${className || ""}`}
  />
);

export default function RequirementsPage() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const defaultRequirements = useQuery(
    (api as any).organizations.getDefaultRequirements,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const generateUploadUrl = useMutation(
    (api as any).files.generateUploadUrl,
  ) as () => Promise<string>;

  const isOwnerOrAdminOrHr =
    user?.role === "owner" || user?.role === "admin" || user?.role === "hr";
  const isEmployee = user?.role === "employee";
  const userEmployeeId = user?.employeeId;

  // HR/Admin states (filter state must be before filteredEmployees useMemo)
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [defaultReqsList, setDefaultReqsList] = useState<
    Array<{ type: string; isRequired?: boolean }>
  >([]);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [tableColumns, setTableColumns] = useState<Column[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [departmentPopoverOpen, setDepartmentPopoverOpen] = useState(false);

  // Get current employee's requirements
  const currentEmployee = useMemo(() => {
    if (!isEmployee || !userEmployeeId || !employees) return null;
    return employees.find((e: any) => e._id === userEmployeeId);
  }, [isEmployee, userEmployeeId, employees]);

  // Departments from settings (for filter)
  const departments = useMemo(() => {
    const depts = settings?.departments || [];
    return depts.length > 0 && typeof depts[0] === "string"
      ? (depts as string[]).map((name) => ({ name, color: "#3B82F6" }))
      : (depts as { name: string; color: string }[]);
  }, [settings]);

  // Filtered employees for table (search + department)
  const filteredEmployees = useMemo(() => {
    const list = employees ?? [];
    const q = employeeSearch.trim().toLowerCase();
    const bySearch = q
      ? list.filter((emp: any) =>
          `${emp.personalInfo?.firstName ?? ""} ${emp.personalInfo?.lastName ?? ""} ${emp.personalInfo?.email ?? ""}`
            .toLowerCase()
            .includes(q),
        )
      : list;
    if (departmentFilter === "all") return bySearch;
    return bySearch.filter(
      (emp: any) => emp.employment?.department === departmentFilter,
    );
  }, [employees, employeeSearch, departmentFilter]);

  // Employee states
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedReqIndexForUpload, setSelectedReqIndexForUpload] =
    useState<number>(-1);
  // Preview state
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Load default requirements
  useEffect(() => {
    if (defaultRequirements) {
      setDefaultReqsList(defaultRequirements);
    }
  }, [defaultRequirements]);

  // Initialize columns from settings or use defaults
  useEffect(() => {
    const DEFAULT_COLUMNS: Column[] = [
      {
        id: "name",
        label: "Employee",
        field: "personalInfo.firstName",
        type: "text",
        sortable: true,
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

    if (settings?.requirementsTableColumns) {
      // Merge saved columns with defaults - ensure all defaults are present
      const savedColumns = settings.requirementsTableColumns.filter(
        (c: Column) => !c.isDefault,
      );
      const savedDefaultColumns = settings.requirementsTableColumns.filter(
        (c: Column) => c.isDefault,
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

  // Sync selectedEmployee with fresh data from employees query
  const lastSyncedRequirements = useRef<string | null>(null);
  useEffect(() => {
    if (selectedEmployee && employees && isEmployeeModalOpen) {
      const updatedEmployee = employees.find(
        (e: any) => e._id === selectedEmployee._id,
      );
      if (updatedEmployee) {
        const updatedReqs = JSON.stringify(updatedEmployee.requirements || []);
        if (lastSyncedRequirements.current !== updatedReqs) {
          requestAnimationFrame(() => {
            setSelectedEmployee(updatedEmployee);
            lastSyncedRequirements.current = updatedReqs;
          });
        }
      }
    }
  }, [employees, isEmployeeModalOpen]);

  // Employee view: Handle file upload
  const handleEmployeeFileUpload = async (
    requirementType: string,
    file: File,
  ) => {
    if (!currentEmployee || !currentOrganizationId) return;

    setUploadingFile(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!result.ok) {
        throw new Error("Failed to upload file");
      }

      const responseText = await result.text();
      // Handle both JSON and plain text responses
      let storageId: string;
      try {
        const jsonResponse = JSON.parse(responseText);
        storageId = jsonResponse.storageId || jsonResponse;
      } catch {
        storageId = responseText;
      }
      // Ensure we have a clean storage ID string
      storageId = storageId.trim().replace(/^["']|["']$/g, "");

      // Find the requirement index, or create it if it doesn't exist
      const requirements = currentEmployee.requirements || [];
      let requirementIndex = requirements.findIndex(
        (r: any) => r.type === requirementType,
      );

      if (requirementIndex < 0) {
        // Requirement doesn't exist yet, add it first
        await addRequirement({
          employeeId: currentEmployee._id,
          requirement: {
            type: requirementType,
            status: "submitted",
            file: storageId,
          },
        });
      } else {
        // Update existing requirement
        await updateRequirementFile({
          employeeId: currentEmployee._id,
          requirementIndex,
          file: storageId,
        });
      }

      toast({
        title: "Success",
        description: "File uploaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setUploadingFile(false);
      setSelectedFile(null);
      setSelectedReqIndexForUpload(-1);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Error",
        description:
          "Invalid file type. Please upload images (JPG, PNG, GIF, WEBP) or documents (PDF, DOC, DOCX, XLS, XLSX)",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Error",
        description: "File size must be less than 10MB",
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleSaveDefaultRequirements = async (
    requirements: Array<{ type: string; isRequired?: boolean }>,
  ) => {
    if (!currentOrganizationId) return;
    await updateDefaultRequirements(currentOrganizationId, requirements);
    toast({
      title: "Success",
      description: "Default requirements updated and synced to all employees",
    });
  };

  const openEmployeeModal = (employee: any) => {
    setSelectedEmployee(employee);
    lastSyncedRequirements.current = JSON.stringify(
      employee.requirements || [],
    );
    setIsEmployeeModalOpen(true);
  };

  const handleEmployeeUpdate = (updatedEmployee: any) => {
    setSelectedEmployee(updatedEmployee);
    lastSyncedRequirements.current = JSON.stringify(
      updatedEmployee.requirements || [],
    );
  };

  // Cache for file URLs and metadata to avoid repeated queries
  const fileUrlCache = useRef<{ [key: string]: string }>({});
  const fileMetadataCache = useRef<{
    [key: string]: {
      url: string;
      type: "image" | "pdf" | "other";
      filename: string;
    };
  }>({});

  const getFileUrl = async (storageId: string): Promise<string> => {
    // Return cached URL if available
    if (fileUrlCache.current[storageId]) {
      return fileUrlCache.current[storageId];
    }

    // Use server action to get proper file URL
    try {
      const url = await getFileUrlAction(storageId);
      if (url) {
        fileUrlCache.current[storageId] = url;
        return url;
      }
    } catch (error) {
      console.error("Error getting file URL:", error);
    }

    // Fallback - should not reach here if storage.getUrl works correctly
    return `${process.env.NEXT_PUBLIC_CONVEX_URL}/api/storage/${storageId}`;
  };

  const getFileMetadata = async (
    storageId: string,
    requirementType: string,
  ): Promise<{
    url: string;
    type: "image" | "pdf" | "other";
    filename: string;
  }> => {
    // Return cached metadata if available
    if (fileMetadataCache.current[storageId]) {
      return fileMetadataCache.current[storageId];
    }

    // Get file URL
    const fileUrl = await getFileUrl(storageId);

    // Detect file type from Content-Type header
    let fileType: "image" | "pdf" | "other" = "other";
    let filename = `${requirementType}_${storageId.slice(0, 8)}`;

    try {
      const response = await fetch(fileUrl, {
        method: "HEAD",
      });
      const contentType = response.headers.get("content-type") || "";
      const contentDisposition =
        response.headers.get("content-disposition") || "";

      // Extract filename from Content-Disposition header if available
      const filenameMatch = contentDisposition.match(
        /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
      );
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, "");
      } else {
        // Try to get filename from URL or use requirement type
        const urlParts = fileUrl.split("/");
        const lastPart = urlParts[urlParts.length - 1];
        if (lastPart && lastPart.includes(".")) {
          filename = lastPart.split("?")[0]; // Remove query params
        } else {
          // Generate filename based on content type
          const ext = contentType.includes("pdf")
            ? "pdf"
            : contentType.includes("image")
              ? contentType.split("/")[1] || "jpg"
              : "file";
          filename = `${requirementType}.${ext}`;
        }
      }

      if (contentType.startsWith("image/")) {
        fileType = "image";
      } else if (
        contentType === "application/pdf" ||
        contentType === "application/x-pdf"
      ) {
        fileType = "pdf";
      }
    } catch (error) {
      console.error("Error detecting file metadata:", error);
      // Fallback: try to detect from URL if it has extension
      const urlLower = fileUrl.toLowerCase();
      if (
        urlLower.includes(".jpg") ||
        urlLower.includes(".jpeg") ||
        urlLower.includes(".png") ||
        urlLower.includes(".gif") ||
        urlLower.includes(".webp")
      ) {
        fileType = "image";
        filename = `${requirementType}.${urlLower.match(/\.(jpg|jpeg|png|gif|webp)/)?.[1] || "jpg"}`;
      } else if (urlLower.includes(".pdf")) {
        fileType = "pdf";
        filename = `${requirementType}.pdf`;
      }
    }

    // Cache the metadata
    const metadata = { url: fileUrl, type: fileType, filename };
    fileMetadataCache.current[storageId] = metadata;

    return metadata;
  };

  // Simple Checkbox component
  const Checkbox = ({
    checked,
    disabled,
    className,
  }: {
    checked?: boolean;
    disabled?: boolean;
    className?: string;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      readOnly
      className={`h-4 w-4 rounded border-gray-300 ${className || ""}`}
    />
  );

  // File Display Component - shows filename and handles preview
  const FileDisplay = ({
    storageId,
    requirementType,
    onPreview,
  }: {
    storageId: string;
    requirementType: string;
    onPreview: () => void;
  }) => {
    const [filename, setFilename] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      // Check cache first
      if (fileMetadataCache.current[storageId]) {
        setFilename(fileMetadataCache.current[storageId].filename);
        setLoading(false);
        return;
      }

      // Load metadata asynchronously
      getFileMetadata(storageId, requirementType)
        .then((metadata) => {
          setFilename(metadata.filename);
          setLoading(false);
        })
        .catch(() => {
          setFilename(`${requirementType}_file`);
          setLoading(false);
        });
    }, [storageId, requirementType]);

    if (loading) {
      return (
        <div className="flex items-center gap-2 mb-2 animate-pulse">
          <div className="h-3 w-3 rounded bg-gray-200" />
          <div className="h-4 w-28 rounded bg-gray-200" />
        </div>
      );
    }

    return (
      <button
        onClick={onPreview}
        className="text-sm text-blue-600 hover:text-blue-800 hover:underline mb-2 text-left"
      >
        <FileText className="h-3 w-3 inline mr-1" />
        {filename || `${requirementType}_file`}
      </button>
    );
  };

  // Employee View
  if (isEmployee && currentEmployee) {
    const requirements = currentEmployee.requirements || [];
    const mergedRequirements = useMemo(() => {
      // Merge default and custom requirements
      const defaults =
        defaultRequirements?.map((req: any) => ({
          type: req.type,
          status: "pending" as const,
          isDefault: true,
          isCustom: false,
        })) || [];

      const existing = requirements.map((r: any) => ({
        ...r,
        isDefault: r.isDefault || false,
        isCustom: r.isCustom || false,
      }));

      // Combine: existing requirements take precedence, then add missing defaults
      const existingTypes = new Set(existing.map((r: any) => r.type));
      const missingDefaults = defaults.filter(
        (d: any) => !existingTypes.has(d.type),
      );

      return [...existing, ...missingDefaults];
    }, [requirements, defaultRequirements]);

    return (
      <MainLayout>
        <div className="p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">
              My Requirements
            </h1>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Requirements Checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mergedRequirements.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    No requirements assigned
                  </p>
                ) : (
                  mergedRequirements.map((req: any, idx: number) => {
                    const actualIndex = requirements.findIndex(
                      (r: any) => r.type === req.type,
                    );
                    const isPassed = req.status === "verified";
                    const hasFile = !!req.file;

                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-4 p-4 border rounded-lg"
                      >
                        <Checkbox
                          checked={isPassed}
                          disabled
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium">{req.type}</span>
                            {req.isDefault && (
                              <Badge variant="outline" className="text-xs">
                                Default
                              </Badge>
                            )}
                            {req.isCustom && (
                              <Badge variant="outline" className="text-xs">
                                Custom
                              </Badge>
                            )}
                            <Badge
                              className={
                                isPassed
                                  ? "bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none"
                                  : "bg-red-100 text-red-800 border-red-300 font-normal rounded-md hover:bg-red-100 focus:ring-0 focus:ring-offset-0 transition-none"
                              }
                            >
                              {isPassed ? "✓ Passed" : "Not Passed"}
                            </Badge>
                          </div>
                          {hasFile && (
                            <FileDisplay
                              storageId={req.file}
                              requirementType={req.type}
                              onPreview={async () => {
                                setPreviewLoading(true);
                                setPreviewFile(null);
                                try {
                                  const metadata = await getFileMetadata(
                                    req.file,
                                    req.type,
                                  );
                                  setPreviewFile({
                                    url: metadata.url,
                                    name: metadata.filename,
                                    type: metadata.type,
                                  });
                                } finally {
                                  setPreviewLoading(false);
                                }
                              }}
                            />
                          )}
                          <div className="space-y-2">
                            <Label htmlFor={`file-${idx}`} className="text-sm">
                              {hasFile ? "Replace File" : "Upload File"}
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id={`file-${idx}`}
                                type="file"
                                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                                onChange={(e) => {
                                  handleFileSelect(e);
                                  setSelectedReqIndexForUpload(idx);
                                }}
                                className="flex-1"
                              />
                              {selectedFile &&
                                selectedReqIndexForUpload === idx && (
                                  <Button
                                    onClick={() =>
                                      handleEmployeeFileUpload(
                                        req.type,
                                        selectedFile,
                                      )
                                    }
                                    disabled={uploadingFile}
                                    size="sm"
                                  >
                                    {uploadingFile ? (
                                      "Uploading..."
                                    ) : (
                                      <>
                                        <Upload className="h-3 w-3 mr-1" />
                                        Upload
                                      </>
                                    )}
                                  </Button>
                                )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  // HR/Admin View
  if (!isOwnerOrAdminOrHr) {
    return (
      <MainLayout>
        <div className="p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Requirements</h1>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Requirements</h1>
            </div>
            <div>
              <DefaultRequirementsDialog
                defaultReqsList={defaultReqsList}
                onSave={handleSaveDefaultRequirements}
                onUpdateList={setDefaultReqsList}
              />
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative w-full max-w-[260px]">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[rgb(133,133,133)] pointer-events-none" />
                    <Input
                      placeholder="Search employees..."
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      className="h-8 pl-7 pr-2 rounded-lg text-[11px] font-semibold text-[rgb(64,64,64)] bg-white border border-solid border-[#DDDDDD] shadow-sm focus-visible:ring-[#695eff] focus-visible:ring-offset-0"
                    />
                  </div>
                  <div className="shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsColumnModalOpen(true)}
                      className="h-8 border-[rgb(230,230,230)]"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Manage Columns
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Popover
                    open={departmentPopoverOpen}
                    onOpenChange={setDepartmentPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white transition-colors hover:bg-[rgb(250,250,250)]",
                          departmentFilter !== "all"
                            ? "border border-[#DDDDDD] border-solid"
                            : "border border-dashed border-[#DDDDDD]",
                        )}
                      >
                        {departmentFilter !== "all" ? (
                          <>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDepartmentFilter("all");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDepartmentFilter("all");
                                }
                              }}
                              className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
                              aria-label="Clear department"
                            >
                              <X className="h-2 w-2" />
                            </span>
                            <span className="text-[rgb(133,133,133)] font-semibold">
                              Department
                            </span>
                            <span className="font-semibold">
                              {departments.find(
                                (d) => d.name === departmentFilter,
                              )?.name ?? departmentFilter}
                            </span>
                            <div
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{
                                backgroundColor:
                                  departments.find(
                                    (d) => d.name === departmentFilter,
                                  )?.color ?? "#9CA3AF",
                              }}
                            />
                            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
                          </>
                        ) : (
                          <>
                            <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[rgb(180,180,180)] text-[rgb(120,120,120)]">
                              <Plus className="h-2 w-2" />
                            </span>
                            <span className="font-semibold">Department</span>
                            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
                          </>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2.5" align="start">
                      <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)] mb-2">
                        Filter by: Department
                      </h4>
                      <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setDepartmentFilter("all");
                            setDepartmentPopoverOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                            departmentFilter === "all"
                              ? "bg-[rgb(245,245,245)]"
                              : "hover:bg-[rgb(250,250,250)]",
                          )}
                        >
                          <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-[#9CA3AF]" />
                          <span>All</span>
                        </button>
                        {departments.map((dept) => (
                          <button
                            key={dept.name}
                            type="button"
                            onClick={() => {
                              setDepartmentFilter(dept.name);
                              setDepartmentPopoverOpen(false);
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                              departmentFilter === dept.name
                                ? "bg-[rgb(245,245,245)]"
                                : "hover:bg-[rgb(250,250,250)]",
                            )}
                          >
                            <div
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: dept.color }}
                            />
                            <span>{dept.name}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {(employeeSearch?.trim() ?? "") !== "" ||
                  departmentFilter !== "all" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEmployeeSearch("");
                        setDepartmentFilter("all");
                      }}
                      className="text-[11px] font-semibold text-[#695eff] hover:text-[#5547e8] shrink-0"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <DynamicRequirementsTable
                employees={filteredEmployees}
                columns={tableColumns}
                onRowClick={openEmployeeModal}
                pageSize={20}
              />
            </CardContent>
          </Card>

          {/* Employee Requirements Modal */}
          {selectedEmployee && (
            <EmployeeRequirementsModal
              employee={selectedEmployee}
              isOpen={isEmployeeModalOpen}
              onOpenChange={setIsEmployeeModalOpen}
              onEmployeeUpdate={handleEmployeeUpdate}
              generateUploadUrl={generateUploadUrl}
              onPreviewFile={(file) => {
                setPreviewLoading(true);
                setPreviewFile(null);
                // Set file after a brief delay to show loading state
                setTimeout(() => {
                  setPreviewFile(file);
                  setPreviewLoading(false);
                }, 100);
              }}
              fileMetadataCache={fileMetadataCache}
              getFileMetadata={getFileMetadata}
            />
          )}

          {/* File Preview Dialog */}
          <FilePreviewDialog
            previewFile={previewFile}
            previewLoading={previewLoading}
            onClose={() => {
              setPreviewFile(null);
              setPreviewLoading(false);
            }}
          />

          {/* Column Management Modal */}
          <RequirementsColumnManagementModal
            isOpen={isColumnModalOpen}
            onOpenChange={setIsColumnModalOpen}
            columns={tableColumns}
            onColumnsChange={setTableColumns}
          />
        </div>
      </div>
    </MainLayout>
  );
}
