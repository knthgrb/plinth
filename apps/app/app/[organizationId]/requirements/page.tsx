"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { updateRequirementFile } from "@/actions/employees";
import { getFileUrl } from "@/actions/files";
import { updateDefaultRequirements } from "@/actions/organizations";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import {
  deriveRequirementState,
  summarizeEmployeeRequirements,
  summarizeRequirementWorkspace,
  type RequirementState,
} from "@/lib/requirements/workflow";
import {
  errorMessage,
  getApplicableEmployeeRequirements,
  hasRequirements,
  type DefaultRequirementPolicy,
  type RequirementsColumn,
  type RequirementsEmployee,
} from "@/lib/requirements/ui-types";
import { uploadFileToStorage } from "@/lib/storage-upload";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  FileWarning,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import { DynamicRequirementsTable } from "./_components/dynamic-requirements-table";
import { RequirementsColumnManagementModal } from "./_components/requirements-column-management-modal";

const DefaultRequirementsDialog = dynamic(
  () =>
    import("./_components/default-requirements-dialog").then(
      (module) => module.DefaultRequirementsDialog,
    ),
  { ssr: false },
);
const EmployeeRequirementsModal = dynamic(
  () =>
    import("./_components/employee-requirements-modal").then(
      (module) => module.EmployeeRequirementsModal,
    ),
  { ssr: false },
);
const FilePreviewDialog = dynamic(
  () =>
    import("./_components/file-preview-dialog").then(
      (module) => module.FilePreviewDialog,
    ),
  { ssr: false },
);

const defaultColumns: RequirementsColumn[] = [
  {
    id: "name",
    label: "Employee",
    field: "personalInfo.firstName",
    type: "text",
    sortable: true,
    isDefault: true,
  },
  {
    id: "department",
    label: "Department",
    field: "employment.department",
    type: "text",
    sortable: true,
    isDefault: true,
  },
  {
    id: "status",
    label: "Compliance",
    field: "status",
    type: "badge",
    sortable: true,
    isDefault: true,
  },
];

const stateLabels: Record<RequirementState, string> = {
  missing: "Missing",
  awaiting_review: "Awaiting review",
  rejected: "Returned",
  expiring: "Expiring",
  expired: "Expired",
  complete: "Complete",
  optional: "Optional",
};

type QueueFilter =
  | "all"
  | "compliant"
  | "missing"
  | "awaiting_review"
  | "rejected"
  | "expiring"
  | "expired";

export default function RequirementsPage() {
  const { effectiveOrganizationId } = useOrganization();
  const { toast } = useToast();
  const user = useQuery(
    api.organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const employees = useQuery(
    api.employees.getEmployees,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const defaultRequirements = useQuery(
    api.organizations.getDefaultRequirements,
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
  const currentEmployeeQuery = useQuery(
    api.employees.getEmployee,
    user?.employeeId
      ? { employeeId: user.employeeId as Id<"employees"> }
      : "skip",
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null,
  );
  const [defaultRequirementDrafts, setDefaultRequirementDrafts] = useState<
    DefaultRequirementPolicy[]
  >([]);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [localColumns, setLocalColumns] = useState<RequirementsColumn[] | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (defaultRequirements) setDefaultRequirementDrafts(defaultRequirements);
  }, [defaultRequirements]);

  const columns = useMemo(() => {
    const saved = settings?.requirementsTableColumns ?? [];
    return defaultColumns.map((column) => {
      const savedColumn = saved.find((candidate) => candidate.id === column.id);
      return savedColumn ? { ...column, ...savedColumn } : column;
    });
  }, [settings?.requirementsTableColumns]);
  const tableColumns = localColumns ?? columns;
  const policies = useMemo(
    () => defaultRequirements ?? [],
    [defaultRequirements],
  );
  const managedEmployees = useMemo(
    () => (employees ?? []).filter(hasRequirements),
    [employees],
  );
  const departments = useMemo(
    () =>
      [
        ...new Set(
          managedEmployees
            .map((employee) => employee.employment.department)
            .filter(Boolean),
        ),
      ].sort(),
    [managedEmployees],
  );
  const selectedEmployee =
    managedEmployees.find((employee) => employee._id === selectedEmployeeId) ??
    null;
  const currentEmployee = currentEmployeeQuery;

  const employeeWorkspaceRows = useMemo(
    () =>
      managedEmployees.map((employee) => ({
        employeeId: employee._id,
        requirements: getApplicableEmployeeRequirements(employee, policies).map(
          (item) => item.requirement,
        ),
      })),
    [managedEmployees, policies],
  );
  const workspaceSummary = useMemo(
    () => summarizeRequirementWorkspace(employeeWorkspaceRows),
    [employeeWorkspaceRows],
  );
  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return managedEmployees.filter((employee) => {
      const name =
        `${employee.personalInfo.firstName} ${employee.personalInfo.lastName} ${employee.personalInfo.email}`.toLocaleLowerCase();
      if (query && !name.includes(query)) return false;
      if (
        departmentFilter !== "all" &&
        employee.employment.department !== departmentFilter
      )
        return false;
      if (queueFilter === "all") return true;
      const summary = summarizeEmployeeRequirements(
        getApplicableEmployeeRequirements(employee, policies).map(
          (item) => item.requirement,
        ),
      );
      if (queueFilter === "compliant") {
        return (
          summary.complete === summary.required &&
          summary.awaitingReview === 0 &&
          summary.rejected === 0 &&
          summary.expired === 0
        );
      }
      if (queueFilter === "awaiting_review") return summary.awaitingReview > 0;
      return summary[queueFilter] > 0;
    });
  }, [departmentFilter, managedEmployees, policies, queueFilter, search]);

  async function saveDefaults(requirements: DefaultRequirementPolicy[]) {
    if (!effectiveOrganizationId) return;
    await updateDefaultRequirements(effectiveOrganizationId, requirements);
    toast({
      title: "Requirement policies saved",
      description:
        "Applicable employees were synchronized without deleting historical evidence.",
    });
  }

  async function showFile(storageId: string, requirementType: string) {
    if (!effectiveOrganizationId) return;
    setPreviewLoading(true);
    try {
      const url = await getFileUrl(effectiveOrganizationId, storageId);
      let type = "other";
      try {
        const response = await fetch(url, { method: "HEAD" });
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.startsWith("image/")) type = "image";
        if (contentType.includes("pdf")) type = "pdf";
      } catch {
        type = url.toLocaleLowerCase().includes(".pdf") ? "pdf" : "other";
      }
      setPreviewFile({ url, name: requirementType, type });
    } catch (error: unknown) {
      toast({
        title: "Unable to open file",
        description: errorMessage(
          error,
          "The file may no longer be available.",
        ),
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function uploadEmployeeEvidence(
    employee: RequirementsEmployee,
    index: number,
    file: File,
  ) {
    if (!effectiveOrganizationId) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Files must be 10 MB or smaller",
        variant: "destructive",
      });
      return;
    }
    setUploadingIndex(index);
    try {
      const storageId = await uploadFileToStorage({
        organizationId: effectiveOrganizationId,
        purpose: "employee_requirement",
        file,
      });
      await updateRequirementFile({
        employeeId: employee._id,
        requirementIndex: index,
        file: storageId,
      });
      toast({
        title: "Evidence submitted",
        description: "HR can now review this requirement.",
      });
    } catch (error: unknown) {
      toast({
        title: "Unable to upload evidence",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setUploadingIndex(null);
    }
  }

  if (user?.role === "employee" && currentEmployee) {
    const indexedRequirements = getApplicableEmployeeRequirements(
      currentEmployee,
      policies,
    );
    const summary = summarizeEmployeeRequirements(
      indexedRequirements.map((item) => item.requirement),
    );
    return (
      <MainLayout>
        <div className="space-y-6 p-5 sm:p-8">
          <div>
            <h1 className="text-3xl font-bold text-[#28262F]">
              My requirements
            </h1>
            <p className="mt-1 text-sm text-[#77727F]">
              Submit current evidence and follow review feedback.
            </p>
          </div>
          <Card className="overflow-hidden border-[#E7E5F4]">
            <CardContent className="grid gap-4 p-5 sm:grid-cols-[180px_1fr] sm:items-center">
              <div>
                <p className="text-4xl font-semibold text-[#695eff]">
                  {summary.completionPercent}%
                </p>
                <p className="text-sm text-[#77727F]">
                  required items complete
                </p>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[#ECE9F3]">
                <div
                  className="h-full rounded-full bg-[#695eff] transition-all"
                  style={{ width: `${summary.completionPercent}%` }}
                />
              </div>
            </CardContent>
          </Card>
          <div className="space-y-3">
            {indexedRequirements.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-sm text-[#928C99]">
                  No requirements currently apply to you.
                </CardContent>
              </Card>
            ) : (
              indexedRequirements.map(({ requirement, index }) => {
                const derived = deriveRequirementState(requirement);
                return (
                  <Card
                    key={`${requirement.type}-${index}`}
                    className="border-[#E7E5F4]"
                  >
                    <CardContent className="p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-semibold">
                              {requirement.type}
                            </h2>
                            <Badge
                              variant={
                                derived.state === "complete"
                                  ? "default"
                                  : derived.state === "expired" ||
                                      derived.state === "rejected"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className={
                                derived.state === "complete"
                                  ? "bg-emerald-600"
                                  : ""
                              }
                            >
                              {stateLabels[derived.state]}
                            </Badge>
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-[#77727F]">
                            {requirement.submittedDate && (
                              <p>
                                Submitted{" "}
                                {format(
                                  new Date(requirement.submittedDate),
                                  "MMM d, yyyy",
                                )}
                              </p>
                            )}
                            {requirement.expiryDate && (
                              <p>
                                Expires{" "}
                                {format(
                                  new Date(requirement.expiryDate),
                                  "MMM d, yyyy",
                                )}
                              </p>
                            )}
                            {requirement.rejectionReason && (
                              <p className="font-medium text-red-700">
                                HR feedback: {requirement.rejectionReason}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {requirement.file && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                showFile(
                                  requirement.file as string,
                                  requirement.type,
                                )
                              }
                            >
                              <Eye className="mr-2 h-4 w-4" /> View
                            </Button>
                          )}
                          <Label className="cursor-pointer">
                            <Input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                              disabled={uploadingIndex !== null}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file)
                                  uploadEmployeeEvidence(
                                    currentEmployee,
                                    index,
                                    file,
                                  );
                                event.target.value = "";
                              }}
                            />
                            <span className="inline-flex h-9 items-center rounded-md bg-[#695eff] px-3 text-sm font-medium text-white hover:bg-[#5547e8]">
                              <Upload className="mr-2 h-4 w-4" />
                              {uploadingIndex === index
                                ? "Uploading…"
                                : requirement.file
                                  ? "Replace"
                                  : "Upload"}
                            </span>
                          </Label>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
          <FilePreviewDialog
            previewFile={previewFile}
            previewLoading={previewLoading}
            onClose={() => setPreviewFile(null)}
          />
        </div>
      </MainLayout>
    );
  }

  const canManage =
    user && ["owner", "admin", "hr", "manager"].includes(user.role);
  if (!canManage)
    return (
      <MainLayout>
        <div className="p-8 text-sm text-[#77727F]">Loading requirements…</div>
      </MainLayout>
    );

  const metrics = [
    {
      label: "Compliant employees",
      value: workspaceSummary.compliantEmployees,
      icon: CheckCircle2,
      tone: "text-emerald-700 bg-emerald-50",
    },
    {
      label: "Awaiting review",
      value: workspaceSummary.awaitingReview,
      icon: Clock3,
      tone: "text-amber-700 bg-amber-50",
    },
    {
      label: "Missing",
      value: workspaceSummary.missing,
      icon: FileWarning,
      tone: "text-red-700 bg-red-50",
    },
    {
      label: "Expiring / expired",
      value: workspaceSummary.expiring + workspaceSummary.expired,
      icon: AlertTriangle,
      tone: "text-orange-700 bg-orange-50",
    },
  ];

  return (
    <MainLayout>
      <div className="space-y-6 p-5 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#28262F]">Requirements</h1>
            <p className="mt-1 text-sm text-[#77727F]">
              Operate evidence review, renewals, and policy coverage from one
              queue.
            </p>
          </div>
          <DefaultRequirementsDialog
            defaultReqsList={defaultRequirementDrafts}
            onSave={saveDefaults}
            onUpdateList={setDefaultRequirementDrafts}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value, icon: Icon, tone }) => (
            <Card key={label} className="border-[#E7E5F4]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`rounded-xl p-2 ${tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{value}</p>
                  <p className="text-xs text-[#77727F]">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="border-[#E7E5F4]">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#928C99]" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search employee or email"
                />
              </div>
              <Select
                value={departmentFilter}
                onValueChange={setDepartmentFilter}
              >
                <SelectTrigger className="w-full lg:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department} value={department}>
                      {department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={queueFilter}
                onValueChange={(value: QueueFilter) => setQueueFilter(value)}
              >
                <SelectTrigger className="w-full lg:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  <SelectItem value="compliant">Compliant</SelectItem>
                  <SelectItem value="missing">Missing evidence</SelectItem>
                  <SelectItem value="awaiting_review">
                    Awaiting review
                  </SelectItem>
                  <SelectItem value="rejected">Returned</SelectItem>
                  <SelectItem value="expiring">Expiring</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => setIsColumnModalOpen(true)}
              >
                <Settings className="mr-2 h-4 w-4" /> Columns
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DynamicRequirementsTable
              employees={filteredEmployees}
              policies={policies}
              columns={tableColumns}
              onRowClick={(employee) => setSelectedEmployeeId(employee._id)}
              isLoading={employees === undefined}
            />
          </CardContent>
        </Card>
        {selectedEmployee && effectiveOrganizationId && (
          <EmployeeRequirementsModal
            employee={selectedEmployee}
            policies={policies}
            isOpen={Boolean(selectedEmployeeId)}
            onOpenChange={(open) => !open && setSelectedEmployeeId(null)}
            organizationId={effectiveOrganizationId}
            onPreviewFile={showFile}
          />
        )}
        <FilePreviewDialog
          previewFile={previewFile}
          previewLoading={previewLoading}
          onClose={() => setPreviewFile(null)}
        />
        <RequirementsColumnManagementModal
          isOpen={isColumnModalOpen}
          onOpenChange={setIsColumnModalOpen}
          columns={tableColumns}
          onColumnsChange={setLocalColumns}
        />
      </div>
    </MainLayout>
  );
}
