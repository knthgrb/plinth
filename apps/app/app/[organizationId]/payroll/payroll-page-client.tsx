"use client";

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
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
import { Stepper } from "@/components/ui/stepper";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthPicker } from "@/components/ui/month-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Mail,
  MessageSquare,
  FileSpreadsheet,
  Download,
  Loader2,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { PayrollRunsTable } from "./_components/payroll-runs-table";
import { ThirteenthMonthTab } from "./_components/13th-month-tab";
import { LeaveConversionTab } from "./_components/leave-conversion-tab";

// Lazy load step components
const PayrollStep1Dates = dynamic(
  () =>
    import("./_components/payroll-step-1-dates").then((mod) => ({
      default: mod.PayrollStep1Dates,
    })),
  { ssr: false },
);

const PayrollStep2Employees = dynamic(
  () =>
    import("./_components/payroll-step-2-employees").then((mod) => ({
      default: mod.PayrollStep2Employees,
    })),
  { ssr: false },
);

const PayrollStep3GovernmentDeductions = dynamic(
  () =>
    import("./_components/payroll-step-3-government-deductions").then(
      (mod) => ({ default: mod.PayrollStep3GovernmentDeductions }),
    ),
  { ssr: false },
);

const PayrollStep4DeductionsIncentives = dynamic(
  () =>
    import("./_components/payroll-step-4-deductions-incentives").then(
      (mod) => ({ default: mod.PayrollStep4DeductionsIncentives }),
    ),
  { ssr: false },
);

const PayrollStep5Preview = dynamic(
  () =>
    import("./_components/payroll-step-5-preview").then((mod) => ({
      default: mod.PayrollStep5Preview,
    })),
  { ssr: false },
);

// Lazy load edit payroll step components
const EditPayrollStep1Dates = dynamic(
  () =>
    import("./_components/edit-payroll-step-1-dates").then((mod) => ({
      default: mod.EditPayrollStep1Dates,
    })),
  { ssr: false },
);

const EditPayrollStep2Employees = dynamic(
  () =>
    import("./_components/payroll-step-2-employees").then((mod) => ({
      default: mod.PayrollStep2Employees,
    })),
  { ssr: false },
);

const EditPayrollStep3GovernmentDeductions = dynamic(
  () =>
    import("./_components/payroll-step-3-government-deductions").then(
      (mod) => ({
        default: mod.PayrollStep3GovernmentDeductions,
      }),
    ),
  { ssr: false },
);

const EditPayrollStep4DeductionsIncentives = dynamic(
  () =>
    import("./_components/payroll-step-4-deductions-incentives").then(
      (mod) => ({
        default: mod.PayrollStep4DeductionsIncentives,
      }),
    ),
  { ssr: false },
);

// Lazy load dialogs
const EditPayrollRunDialog = dynamic<any>(
  () =>
    import("./_components/edit-payroll-run-dialog").then((mod) => ({
      default: mod.EditPayrollRunDialog,
    })),
  { ssr: false },
);

const ViewPayslipsDialog = dynamic<any>(
  () =>
    import("./_components/view-payslips-dialog").then((mod) => ({
      default: mod.ViewPayslipsDialog,
    })),
  { ssr: false },
);

const EditPayslipDialog = dynamic<any>(
  () =>
    import("./_components/edit-payslip-dialog").then((mod) => ({
      default: mod.EditPayslipDialog,
    })),
  { ssr: false },
);

const PayrollSummaryDialog = dynamic<any>(
  () =>
    import("./_components/payroll-summary-dialog").then((mod) => ({
      default: mod.PayrollSummaryDialog,
    })),
  { ssr: false },
);

const PayrollFinalizeDialog = dynamic(
  () =>
    import("./_components/payroll-finalize-dialog").then((mod) => ({
      default: mod.PayrollFinalizeDialog,
    })),
  { ssr: false },
);

// Lazy load modals - placeholder components created, can be expanded later
import {
  createPayrollRun,
  getPayrollRuns,
  getPayslipsByPayrollRun,
  getPayslipListByPayrollRun,
  updatePayslip,
  updatePayrollRunStatus,
  updatePayrollRun,
  deletePayrollRun,
  deletePayrollRuns,
  getPayslipMessages,
  getPayrollRunSummary,
  computePayrollPreviewBatch,
  getPayslip,
} from "@/actions/payroll";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { userFacingPayslipLoadError } from "@/lib/payslip-load-errors";
import { PayslipDetail } from "@/components/payslip-detail";

type Deduction = {
  name: string;
  amount: number;
  type: string;
};

type PayrollIncentiveLine = {
  name: string;
  amount: number;
  type: string;
  /** When true, included in taxable gross; when false, paid as non-taxable (see org TRAIN cap). */
  taxable: boolean;
};

type EmployeeDeduction = {
  employeeId: string;
  deductions: Deduction[];
};

type EmployeeIncentive = {
  employeeId: string;
  incentives: PayrollIncentiveLine[];
};

type PreviewPayslipEdits = {
  deductions: Deduction[];
  incentives: PayrollIncentiveLine[];
};

type GovernmentDeductionSettings = {
  employeeId: string;
  sss: { enabled: boolean; frequency: "full" | "half" };
  pagibig: { enabled: boolean; frequency: "full" | "half" };
  philhealth: { enabled: boolean; frequency: "full" | "half" };
  tax: { enabled: boolean; frequency: "full" | "half" };
};

function normalizeIncentiveLineForUi(raw: unknown): PayrollIncentiveLine {
  const inc = raw as Record<string, unknown>;
  return {
    name: typeof inc?.name === "string" ? inc.name : "",
    amount: typeof inc?.amount === "number" ? inc.amount : 0,
    type: typeof inc?.type === "string" ? inc.type : "incentive",
    taxable: inc?.taxable === false ? false : true,
  };
}

// Helper to get day name from timestamp
function getDayName(date: number): string {
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return days[new Date(date).getDay()];
}

// Helper to check if a date is a rest day for an employee
function isRestDay(date: number, employeeSchedule: any): boolean {
  const dayName = getDayName(date);
  const daySchedule =
    employeeSchedule?.defaultSchedule?.[
      dayName as keyof typeof employeeSchedule.defaultSchedule
    ];

  // Check if there's a schedule override for this date
  if (employeeSchedule?.scheduleOverrides) {
    const override = employeeSchedule.scheduleOverrides.find(
      (o: any) =>
        new Date(o.date).toDateString() === new Date(date).toDateString(),
    );
    if (override) {
      // If there's an override, it's not a rest day (override means working)
      return false;
    }
  }

  // If isWorkday is false, it's a rest day
  return !daySchedule?.isWorkday;
}

// Helper to calculate working days in a specific cutoff range (inclusive)
// Parse "YYYY-MM-DD" as local midnight (not UTC) so cutoff aligns with attendance dates
function dateStringToLocalMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export default function PayrollPageClient() {
  const { toast } = useToast();
  const { effectiveOrganizationId, currentOrganization } = useOrganization();
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const settings = useQuery(
    (api as any).settings.getSettings,
    effectiveOrganizationId ? { organizationId: effectiveOrganizationId } : "skip",
  );
  const employees = useQuery(
    (api as any).employees.getEmployees,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  /** Admin, HR, accounting, owner: can edit payslips and see payroll edit actions */
  const isAdminOrAccounting =
    user?.role === "admin" ||
    user?.role === "hr" ||
    user?.role === "accounting" ||
    user?.role === "owner";
  /** Admin, HR, owner can edit deductions in pay preview (Step 5) */
  const canEditPreviewDeductions =
    user?.role === "admin" || user?.role === "hr" || user?.role === "owner";
  const [payrollRuns, setPayrollRuns] = useState<any[]>([]);
  const [payrollRunsInitialReady, setPayrollRunsInitialReady] = useState(false);
  const [filterMonth, setFilterMonth] = useState("");
  const [payrollRunsPage, setPayrollRunsPage] = useState(1);
  const payrollRunsPageSize = 10;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isViewPayslipsOpen, setIsViewPayslipsOpen] = useState(false);
  const [selectedPayrollRun, setSelectedPayrollRun] = useState<any>(null);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [currentStep, setCurrentStep] = useState(1); // 1: dates, 2: employees, 3: gov deductions, 4: other deductions, 5: preview
  const [cutoffStart, setCutoffStart] = useState("");
  const [cutoffEnd, setCutoffEnd] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [deductionsEnabled, setDeductionsEnabled] = useState(true);
  const [governmentDeductionSettings, setGovernmentDeductionSettings] =
    useState<GovernmentDeductionSettings[]>([]);
  const [employeeDeductions, setEmployeeDeductions] = useState<
    EmployeeDeduction[]
  >([]);
  const [employeeIncentives, setEmployeeIncentives] = useState<
    EmployeeIncentive[]
  >([]);
  const [previewData, setPreviewData] = useState<any[]>([]);
  /** Per-employee overrides for deduction amounts (e.g. SSS, PhilHealth) in pay preview */
  const [previewDeductionOverrides, setPreviewDeductionOverrides] = useState<
    Record<string, Record<string, number>>
  >({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "draft" | "finalized"
  >("idle");
  const [isLoadingPayslips, setIsLoadingPayslips] = useState(false);
  const [isEditPayslipOpen, setIsEditPayslipOpen] = useState(false);
  const [editingPayslip, setEditingPayslip] = useState<any>(null);
  const [editDeductions, setEditDeductions] = useState<Deduction[]>([]);
  const [editIncentives, setEditIncentives] = useState<PayrollIncentiveLine[]>(
    [],
  );
  const [isSavingPayslip, setIsSavingPayslip] = useState(false);
  const [regeneratingPayrollRunId, setRegeneratingPayrollRunId] = useState<
    string | null
  >(null);
  const [payslipConcerns, setPayslipConcerns] = useState<Record<string, any[]>>(
    {},
  );
  const [payslipDetailsById, setPayslipDetailsById] = useState<
    Record<string, any>
  >({});
  const [loadingPayslipDetailsById, setLoadingPayslipDetailsById] = useState<
    Record<string, boolean>
  >({});
  const [expandedPayslipId, setExpandedPayslipId] = useState<string | null>(
    null,
  );
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizePayrollRunId, setFinalizePayrollRunId] = useState<
    string | null
  >(null);
  const [finalizeFlowBusy, setFinalizeFlowBusy] = useState(false);
  const finalizeSuccessRef = useRef<(() => Promise<void>) | null>(null);
  const finalizeCancelRef = useRef<(() => Promise<void>) | null>(null);
  const [isEditPayrollRunOpen, setIsEditPayrollRunOpen] = useState(false);
  const [editingPayrollRun, setEditingPayrollRun] = useState<any>(null);
  const [editPayrollStep, setEditPayrollStep] = useState(1);
  const [editCutoffStart, setEditCutoffStart] = useState("");
  const [editCutoffEnd, setEditCutoffEnd] = useState("");
  const [editSelectedEmployees, setEditSelectedEmployees] = useState<string[]>(
    [],
  );
  const [editDeductionsEnabled, setEditDeductionsEnabled] = useState(true);
  const [editGovernmentDeductionSettings, setEditGovernmentDeductionSettings] =
    useState<GovernmentDeductionSettings[]>([]);
  const [editEmployeeDeductions, setEditEmployeeDeductions] = useState<
    EmployeeDeduction[]
  >([]);
  const [editEmployeeIncentives, setEditEmployeeIncentives] = useState<
    EmployeeIncentive[]
  >([]);
  const [editPreviewData, setEditPreviewData] = useState<any[]>([]);
  const [editPreviewDeductionOverrides, setEditPreviewDeductionOverrides] =
    useState<Record<string, Record<string, number>>>({});
  const [isComputingEditPreview, setIsComputingEditPreview] = useState(false);
  const [isSavingPayrollRun, setIsSavingPayrollRun] = useState(false);
  const [editSubmitStatus, setEditSubmitStatus] = useState<
    "idle" | "draft" | "finalized"
  >("idle");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [payrollRunsToDelete, setPayrollRunsToDelete] = useState<any[]>([]);
  const [isDeletingPayrollRun, setIsDeletingPayrollRun] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<
    "regular" | "13th_month" | "leave_conversion"
  >("regular");

  const closeFinalizeDialog = useCallback(() => {
    setFinalizeDialogOpen(false);
    setFinalizePayrollRunId(null);
    finalizeSuccessRef.current = null;
    finalizeCancelRef.current = null;
    setFinalizeFlowBusy(false);
  }, []);

  const openPayrollFinalizeFlow = useCallback(
    (
      payrollRunId: string,
      onSuccess: () => Promise<void>,
      onCancel: () => Promise<void>,
    ) => {
      finalizeSuccessRef.current = onSuccess;
      finalizeCancelRef.current = onCancel;
      setFinalizeFlowBusy(true);
      setFinalizePayrollRunId(payrollRunId);
      setFinalizeDialogOpen(true);
    },
    [],
  );

  const loadPayrollRuns = async (opts?: { isInitialHydration?: boolean }) => {
    if (!effectiveOrganizationId) return;
    if (opts?.isInitialHydration) {
      setPayrollRuns([]);
      setPayrollRunsInitialReady(false);
    }
    try {
      const runs = await getPayrollRuns(effectiveOrganizationId);
      setPayrollRuns(runs);
    } catch (error) {
      console.error("Error loading payroll runs:", error);
    } finally {
      if (opts?.isInitialHydration) setPayrollRunsInitialReady(true);
    }
  };

  useEffect(() => {
    if (!effectiveOrganizationId) {
      setPayrollRuns([]);
      setPayrollRunsInitialReady(false);
      return;
    }
    void loadPayrollRuns({ isInitialHydration: true });
  }, [effectiveOrganizationId]);

  const filteredPayrollRuns = useMemo(() => {
    let runs = payrollRuns;
    if (activeTab === "regular") {
      runs = runs.filter(
        (r: any) =>
          (r.runType ?? "regular") !== "13th_month" &&
          (r.runType ?? "regular") !== "leave_conversion",
      );
    } else if (activeTab === "13th_month") {
      runs = runs.filter((r: any) => (r.runType ?? "regular") === "13th_month");
    } else if (activeTab === "leave_conversion") {
      runs = runs.filter(
        (r: any) => (r.runType ?? "regular") === "leave_conversion",
      );
    }
    if (
      !filterMonth ||
      activeTab === "13th_month" ||
      activeTab === "leave_conversion"
    )
      return runs;
    const [year, month] = filterMonth.split("-").map(Number);
    return runs.filter((run) => {
      const cutoffDate = run?.cutoffStart ? new Date(run.cutoffStart) : null;
      if (!cutoffDate || Number.isNaN(cutoffDate.getTime())) return false;
      return (
        cutoffDate.getFullYear() === year && cutoffDate.getMonth() + 1 === month
      );
    });
  }, [filterMonth, payrollRuns, activeTab]);

  const totalPayrollRunPages = Math.max(
    1,
    Math.ceil(filteredPayrollRuns.length / payrollRunsPageSize),
  );

  const paginatedPayrollRuns = useMemo(() => {
    const start = (payrollRunsPage - 1) * payrollRunsPageSize;
    return filteredPayrollRuns.slice(start, start + payrollRunsPageSize);
  }, [filteredPayrollRuns, payrollRunsPage]);

  useEffect(() => {
    setPayrollRunsPage(1);
  }, [filterMonth]);

  useEffect(() => {
    if (payrollRunsPage > totalPayrollRunPages) {
      setPayrollRunsPage(1);
    }
  }, [payrollRunsPage, totalPayrollRunPages]);

  useEffect(() => {
    setSelectedRunIds((prev) =>
      prev.filter((id) => payrollRuns.some((run) => String(run._id) === id)),
    );
  }, [payrollRuns]);

  const handleViewSummary = async (payrollRun: any) => {
    setSelectedPayrollRun(payrollRun);
    setIsSummaryOpen(true);
    setIsLoadingSummary(true);
    try {
      const summary = await getPayrollRunSummary(payrollRun._id);
      setSummaryData(summary);
    } catch (error) {
      console.error("Error loading summary:", error);
      toast({
        title: "Error",
        description: "Failed to load payroll summary",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const handleExportPDF = () => {
    // TODO: Implement PDF export
    toast({
      title: "Coming Soon",
      description: "PDF export functionality will be available soon",
    });
  };

  const handleExportExcel = () => {
    if (!summaryData) return;

    // Create CSV content
    const headers = [
      "Employee",
      "Daily pay",
      ...summaryData.dates.map((d: number) => format(new Date(d), "MMM dd")),
      "Total Late (min)",
      "Total Undertime (min)",
      "Total Reg. OT (hrs)",
      "Total Special OT (hrs)",
      "Total Night Diff (hrs)",
      "Absent Days",
    ];

    const rows = summaryData.summary.map((empSummary: any) => {
      const dayValues = summaryData.dates.map((date: number) => {
        const dayData = empSummary.dailyData.find((d: any) => d.date === date);
        if (!dayData || !dayData.timeIn) return "-";
        if (dayData.status === "absent") return "ABSENT";
        if (dayData.status === "leave_without_pay") return "LWOP";
        if (dayData.status === "leave" || dayData.status === "leave_with_pay")
          return "LEAVE";
        let value = dayData.timeIn || "";
        if (dayData.timeOut) value += ` - ${dayData.timeOut}`;
        if (dayData.lateMinutes > 0) value += ` | ${dayData.lateMinutes} MIN L`;
        return value;
      });

      return [
        `${empSummary.employee.personalInfo.firstName} ${empSummary.employee.personalInfo.lastName}`,
        empSummary.dailyPayRate ?? 0,
        ...dayValues,
        empSummary.totals.totalLateMinutes,
        empSummary.totals.totalUndertimeMinutes,
        empSummary.totals.totalRegularOTHours.toFixed(2),
        empSummary.totals.totalSpecialOTHours.toFixed(2),
        empSummary.totals.totalNightDiffHours.toFixed(2),
        empSummary.totals.totalAbsentDays,
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row: any[]) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    // Create blob and download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `payroll-summary-${selectedPayrollRun?.period.replace(/\s+/g, "-")}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Success",
      description: "Summary exported to CSV",
    });
  };

  const handleViewPayslips = async (
    payrollRun: any,
    highlightPayslipId?: string,
  ) => {
    setSelectedPayrollRun(payrollRun);
    setIsViewPayslipsOpen(true);
    setIsLoadingPayslips(true);
    // Do not set expanded to highlight id here: handleOpenPayslipDetails toggles
    // (same id → collapse), which would immediately collapse the appealed payslip.
    setExpandedPayslipId(null);
    setPayslipDetailsById({});
    setPayslipConcerns({});
    try {
      const payslipsData = await getPayslipListByPayrollRun(payrollRun._id);
      setPayslips(payslipsData);

      if (highlightPayslipId) {
        const highlightedPayslip = payslipsData.find(
          (payslip: { _id: string }) =>
            String(payslip._id) === String(highlightPayslipId),
        );
        if (highlightedPayslip) {
          await handleOpenPayslipDetails(highlightedPayslip);
        } else {
          const one = await getPayslip(highlightPayslipId);
          if (one && String(one.payrollRunId) === String(payrollRun._id)) {
            await handleOpenPayslipDetails({ _id: one._id });
          }
        }
      }

      // If highlighting a specific payslip, scroll to it after load
      if (highlightPayslipId) {
        setTimeout(() => {
          const payslipElement = document.querySelector(
            `[data-payslip-id="${highlightPayslipId}"]`,
          );
          if (payslipElement) {
            payslipElement.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
            // Add highlight effect
            payslipElement.classList.add(
              "ring-2",
              "ring-purple-500",
              "ring-offset-2",
            );
            setTimeout(() => {
              payslipElement.classList.remove(
                "ring-2",
                "ring-purple-500",
                "ring-offset-2",
              );
            }, 3000);
          }
        }, 500);
      }
    } catch (error: unknown) {
      console.error("Error loading payslips:", error);
      toast({
        title: "Could not load payslips",
        description: userFacingPayslipLoadError(error),
        variant: "destructive",
      });
    } finally {
      setIsLoadingPayslips(false);
    }
  };

  const handleOpenPayslipDetails = async (payslipSummary: any) => {
    const payslipId = payslipSummary._id;
    setExpandedPayslipId((current) =>
      current === payslipId ? null : payslipId,
    );

    if (payslipDetailsById[payslipId] || loadingPayslipDetailsById[payslipId]) {
      return;
    }

    setLoadingPayslipDetailsById((prev) => ({
      ...prev,
      [payslipId]: true,
    }));

    try {
      const detail = await getPayslip(payslipId);
      setPayslipDetailsById((prev) => ({
        ...prev,
        [payslipId]: detail,
      }));

      const concernCount = detail?.concernSummary?.messageCount ?? 0;
      if (concernCount > 0 && !payslipConcerns[payslipId]) {
        const messages = await getPayslipMessages(payslipId);
        setPayslipConcerns((prev) => ({
          ...prev,
          [payslipId]: messages || [],
        }));
      }
    } catch (error: unknown) {
      console.error("Error loading payslip details:", error);
      toast({
        title: "Could not open payslip",
        description: userFacingPayslipLoadError(error),
        variant: "destructive",
      });
    } finally {
      setLoadingPayslipDetailsById((prev) => ({
        ...prev,
        [payslipId]: false,
      }));
    }
  };

  const handleArchivePayrollRun = async (payrollRun: any) => {
    try {
      await updatePayrollRunStatus(payrollRun._id, "archived");
      await loadPayrollRuns();
      toast({
        title: "Archived",
        description: "Payroll run archived. Cost records removed.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to archive payroll run",
        variant: "destructive",
      });
    }
  };

  const handleDeletePayrollRun = (payrollRun: any) => {
    setPayrollRunsToDelete([payrollRun]);
    setIsDeleteDialogOpen(true);
  };

  const handleBulkDeletePayrollRuns = () => {
    const selectedRuns = payrollRuns.filter((run) =>
      selectedRunIds.includes(String(run._id)),
    );
    if (selectedRuns.length === 0) {
      toast({
        title: "No runs selected",
        description: "Select at least one payroll run to delete.",
      });
      return;
    }
    setPayrollRunsToDelete(selectedRuns);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeletePayrollRun = async () => {
    if (payrollRunsToDelete.length === 0 || isDeletingPayrollRun) return;

    setIsDeletingPayrollRun(true);
    try {
      const runIdsToDelete = payrollRunsToDelete.map((run) => String(run._id));
      if (runIdsToDelete.length === 1) {
        await deletePayrollRun(runIdsToDelete[0]);
      } else {
        await deletePayrollRuns(runIdsToDelete);
      }
      await loadPayrollRuns();
      setIsDeleteDialogOpen(false);
      setPayrollRunsToDelete([]);
      setSelectedRunIds((prev) =>
        prev.filter(
          (id) =>
            !payrollRunsToDelete.some((run) => String(run._id) === String(id)),
        ),
      );
      toast({
        title: "Deleted",
        description:
          payrollRunsToDelete.length > 1
            ? `${payrollRunsToDelete.length} payroll runs deleted successfully.`
            : "Payroll run deleted successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete payroll run",
        variant: "destructive",
      });
    } finally {
      setIsDeletingPayrollRun(false);
    }
  };

  const handleStatusChange = async (payrollRun: any, status: string) => {
    if (status === "finalized") {
      openPayrollFinalizeFlow(
        payrollRun._id,
        async () => {
          await loadPayrollRuns();
        },
        async () => {},
      );
      return;
    }
    try {
      await updatePayrollRunStatus(payrollRun._id, status as any);
      await loadPayrollRuns();
      toast({
        title: "Status Updated",
        description: `Payroll marked as ${status}.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update payroll status",
        variant: "destructive",
      });
    }
  };

  const handleRegeneratePayslips = async (payrollRun: any) => {
    setRegeneratingPayrollRunId(payrollRun._id);
    try {
      const draftConfig = payrollRun.draftConfig ?? {};
      const employeeIds = draftConfig.employeeIds ?? [];
      await updatePayrollRun({
        payrollRunId: payrollRun._id,
        cutoffStart: payrollRun.cutoffStart,
        cutoffEnd: payrollRun.cutoffEnd,
        employeeIds: employeeIds.length > 0 ? employeeIds : undefined,
        deductionsEnabled: payrollRun.deductionsEnabled,
        governmentDeductionSettings: draftConfig.governmentDeductionSettings,
        manualDeductions: draftConfig.manualDeductions,
        incentives: draftConfig.incentives,
      });
      await loadPayrollRuns();
      if (selectedPayrollRun?._id === payrollRun._id) {
        await handleViewPayslips(payrollRun);
      }
      if (isSummaryOpen && selectedPayrollRun?._id === payrollRun._id) {
        await handleViewSummary(payrollRun);
      }
      toast({
        title: "Payslips regenerated",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to regenerate payslips",
        variant: "destructive",
      });
    } finally {
      setRegeneratingPayrollRunId(null);
    }
  };

  const handleEditPayslip = (payslip: any) => {
    setEditingPayslip(payslip);
    setEditDeductions([...payslip.deductions]);
    setEditIncentives(
      (payslip.incentives || []).map(normalizeIncentiveLineForUi),
    );
    setIsEditPayslipOpen(true);
  };

  const handleEditPreviewPayslip = (
    preview: any,
    mode: "create_preview" | "edit_preview",
  ) => {
    const isAttendanceName = (name: string): boolean => {
      const n = (name || "").trim().toLowerCase();
      return (
        n === "late" ||
        n === "regular day late" ||
        n === "regular holiday late" ||
        n === "special holiday late" ||
        n === "undertime" ||
        /^absent(?:\b|\s|\()/.test(n) ||
        /^no[\s-]*work(?:\b|\s|\()/.test(n)
      );
    };
    const isGovernmentDeduction = (d: Deduction): boolean =>
      (d.type || "").toLowerCase() === "government" ||
      ["sss", "philhealth", "pag-ibig", "pagibig", "withholding tax"].includes(
        (d.name || "").trim().toLowerCase(),
      );
    const isAttendanceDeduction = (d: Deduction): boolean =>
      (d.type || "").toLowerCase() === "attendance" || isAttendanceName(d.name);
    const dedupePreviewEntries = (rows: Deduction[]): Deduction[] => {
      const seen = new Set<string>();
      return rows.filter((row) => {
        const isGovOrAttendance =
          isGovernmentDeduction(row) || isAttendanceDeduction(row);
        if (!isGovOrAttendance) return true;
        const key = `${(row.name || "").trim().toLowerCase()}|${(row.type || "").trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const noWorkDays = preview.noWorkNoPayDays || 0;
    const absentDays = Math.max(0, (preview.absences || 0) - noWorkDays);
    const absenceLabel =
      noWorkDays > 0 && absentDays === 0
        ? `No work on a holiday (${preview.absences || 0} ${(preview.absences || 0) === 1 ? "day" : "days"})`
        : `Absent (${preview.absences || 0} ${(preview.absences || 0) === 1 ? "day" : "days"})`;
    const existingDeductions: Deduction[] = [...(preview.deductions || [])];
    const hasAttendanceAlready = existingDeductions.some(isAttendanceDeduction);
    const attendanceDeductions: Deduction[] = [
      ...(!hasAttendanceAlready && preview.absentDeduction > 0
        ? [{ name: absenceLabel, amount: preview.absentDeduction, type: "attendance" }]
        : []),
      ...(!hasAttendanceAlready && preview.lateDeductionSpecialHoliday > 0
        ? [
            {
              name: "Special Holiday Late",
              amount: preview.lateDeductionSpecialHoliday,
              type: "attendance",
            },
          ]
        : []),
      ...(!hasAttendanceAlready && preview.lateDeductionRegularHoliday > 0
        ? [
            {
              name: "Regular Holiday Late",
              amount: preview.lateDeductionRegularHoliday,
              type: "attendance",
            },
          ]
        : []),
      ...(!hasAttendanceAlready && (preview.lateDeductionRegularDay ?? 0) > 0
        ? [
            {
              name:
                (preview.lateDeductionSpecialHoliday > 0 ||
                  preview.lateDeductionRegularHoliday > 0)
                  ? "Regular day late"
                  : "Late",
              amount: preview.lateDeductionRegularDay,
              type: "attendance",
            },
          ]
        : []),
      ...(!hasAttendanceAlready && preview.undertimeDeduction > 0
        ? [{ name: "Undertime", amount: preview.undertimeDeduction, type: "attendance" }]
        : []),
    ];
    const initialDeductions = dedupePreviewEntries([
      ...existingDeductions,
      ...attendanceDeductions,
    ]);

    setEditingPayslip({
      _id: `${mode}:${preview.employee?._id}`,
      employee: preview.employee,
      deductions: initialDeductions,
      incentives: (preview.incentives || []).map(normalizeIncentiveLineForUi),
      __mode: mode,
      __employeeId: preview.employee?._id,
    });
    setEditDeductions(initialDeductions);
    setEditIncentives(
      (preview.incentives || []).map(normalizeIncentiveLineForUi),
    );
    setIsEditPayslipOpen(true);
  };

  const handleSavePayslip = async () => {
    if (!editingPayslip) return;

    setIsSavingPayslip(true);
    try {
      if (
        editingPayslip.__mode === "create_preview" ||
        editingPayslip.__mode === "edit_preview"
      ) {
        const employeeId = editingPayslip.__employeeId as string;
        const totalIncentives = editIncentives.reduce(
          (sum, incentive) => sum + (incentive.amount || 0),
          0,
        );
        const totalDeductions = editDeductions.reduce(
          (sum, deduction) => sum + (deduction.amount || 0),
          0,
        );
        const isAttendanceName = (name: string): boolean => {
          const n = (name || "").trim().toLowerCase();
          return (
            n === "late" ||
            n === "regular day late" ||
            n === "regular holiday late" ||
            n === "special holiday late" ||
            n === "undertime" ||
            /^absent(?:\b|\s|\()/.test(n) ||
            /^no[\s-]*work(?:\b|\s|\()/.test(n)
          );
        };
        const isGovernmentName = (name: string): boolean => {
          const n = (name || "").trim().toLowerCase();
          return (
            n === "sss" ||
            n === "philhealth" ||
            n === "pag-ibig" ||
            n === "pagibig" ||
            n === "withholding tax"
          );
        };
        const manualDeductionsOnly = editDeductions.filter(
          (d) =>
            (d.type || "").toLowerCase() !== "attendance" &&
            (d.type || "").toLowerCase() !== "government" &&
            !isAttendanceName(d.name) &&
            !isGovernmentName(d.name),
        );

        if (editingPayslip.__mode === "create_preview") {
          setPreviewData((prev) =>
            prev.map((p) => {
              if (p.employee?._id !== employeeId) return p;
              const availableEarnings = (p.grossPay || 0) + (p.nonTaxableAllowance || 0);
              return {
                ...p,
                deductions: editDeductions,
                incentives: editIncentives,
                totalIncentives,
                totalDeductions: Math.min(totalDeductions, Math.max(0, availableEarnings)),
                netPay: Math.max(
                  0,
                  availableEarnings - Math.min(totalDeductions, Math.max(0, availableEarnings)),
                ),
              };
            }),
          );
          setEmployeeDeductions((prev) => {
            const next = prev.map((row) =>
              row.employeeId === employeeId
                ? { ...row, deductions: manualDeductionsOnly }
                : row,
            );
            return next.some((row) => row.employeeId === employeeId)
              ? next
              : [...next, { employeeId, deductions: manualDeductionsOnly }];
          });
          setEmployeeIncentives((prev) => {
            const next = prev.map((row) =>
              row.employeeId === employeeId
                ? { ...row, incentives: editIncentives }
                : row,
            );
            return next.some((row) => row.employeeId === employeeId)
              ? next
              : [...next, { employeeId, incentives: editIncentives }];
          });
        } else {
          setEditPreviewData((prev) =>
            prev.map((p) => {
              if (p.employee?._id !== employeeId) return p;
              const availableEarnings = (p.grossPay || 0) + (p.nonTaxableAllowance || 0);
              return {
                ...p,
                deductions: editDeductions,
                incentives: editIncentives,
                totalIncentives,
                totalDeductions: Math.min(totalDeductions, Math.max(0, availableEarnings)),
                netPay: Math.max(
                  0,
                  availableEarnings - Math.min(totalDeductions, Math.max(0, availableEarnings)),
                ),
              };
            }),
          );
          setEditEmployeeDeductions((prev) => {
            const next = prev.map((row) =>
              row.employeeId === employeeId
                ? { ...row, deductions: manualDeductionsOnly }
                : row,
            );
            return next.some((row) => row.employeeId === employeeId)
              ? next
              : [...next, { employeeId, deductions: manualDeductionsOnly }];
          });
          setEditEmployeeIncentives((prev) => {
            const next = prev.map((row) =>
              row.employeeId === employeeId
                ? { ...row, incentives: editIncentives }
                : row,
            );
            return next.some((row) => row.employeeId === employeeId)
              ? next
              : [...next, { employeeId, incentives: editIncentives }];
          });
        }

        setIsEditPayslipOpen(false);
        setEditingPayslip(null);
        toast({
          title: "Success",
          description: "Preview payslip updated successfully!",
        });
        return;
      }

      await updatePayslip({
        payslipId: editingPayslip._id,
        deductions: editDeductions,
        incentives: editIncentives.length > 0 ? editIncentives : undefined,
      });

      if (selectedPayrollRun && isViewPayslipsOpen) {
        const updated = await getPayslip(editingPayslip._id);
        setPayslipDetailsById((prev) => ({
          ...prev,
          [editingPayslip._id]: updated,
        }));
        setPayslips((prev) =>
          prev.map((p: any) =>
            p._id === editingPayslip._id
              ? {
                  ...p,
                  grossPay: updated.grossPay ?? p.grossPay,
                  basicPay: updated.basicPay ?? p.basicPay,
                  nonTaxableAllowance:
                    updated.nonTaxableAllowance ?? p.nonTaxableAllowance,
                  netPay: updated.netPay ?? p.netPay,
                  employee: updated.employee ?? p.employee,
                  concernSummary: updated.concernSummary ?? p.concernSummary,
                }
              : p,
          ),
        );
      }

      setIsEditPayslipOpen(false);
      setEditingPayslip(null);
      toast({
        title: "Success",
        description: "Payslip updated successfully!",
      });
    } catch (error: any) {
      console.error("Error updating payslip:", error);
      toast({
        title: "Error",
        description:
          error.message || "Failed to update payslip. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingPayslip(false);
    }
  };

  const addEditDeduction = () => {
    setEditDeductions([
      ...editDeductions,
      { name: "", amount: 0, type: "custom" },
    ]);
  };

  const removeEditDeduction = (index: number) => {
    setEditDeductions(editDeductions.filter((_, i) => i !== index));
  };

  const updateEditDeduction = (
    index: number,
    field: "name" | "amount" | "type",
    value: string | number,
  ) => {
    const updated = [...editDeductions];
    updated[index] = { ...updated[index], [field]: value };
    setEditDeductions(updated);
  };

  const addEditIncentive = () => {
    setEditIncentives([
      ...editIncentives,
      { name: "", amount: 0, type: "incentive", taxable: false },
    ]);
  };

  const removeEditIncentive = (index: number) => {
    setEditIncentives(editIncentives.filter((_, i) => i !== index));
  };

  const updateEditIncentive = (
    index: number,
    field: "name" | "amount" | "type" | "taxable",
    value: string | number | boolean,
  ) => {
    const updated = [...editIncentives];
    updated[index] = { ...updated[index], [field]: value };
    setEditIncentives(updated);
  };

  const handleEmployeeSelect = (employeeId: string, checked: boolean) => {
    if (checked) {
      setSelectedEmployees([...selectedEmployees, employeeId]);
      // Initialize government deduction settings (default: all enabled, full frequency)
      if (
        !governmentDeductionSettings.find((gs) => gs.employeeId === employeeId)
      ) {
        setGovernmentDeductionSettings([
          ...governmentDeductionSettings,
          {
            employeeId,
            sss: { enabled: true, frequency: "full" },
            pagibig: { enabled: true, frequency: "full" },
            philhealth: { enabled: true, frequency: "full" },
            tax: { enabled: true, frequency: "full" },
          },
        ]);
      }
      // Initialize other deductions for this employee
      if (!employeeDeductions.find((ed) => ed.employeeId === employeeId)) {
        setEmployeeDeductions([
          ...employeeDeductions,
          { employeeId, deductions: [] },
        ]);
      }
      // Initialize incentives for this employee
      if (!employeeIncentives.find((ei) => ei.employeeId === employeeId)) {
        setEmployeeIncentives([
          ...employeeIncentives,
          { employeeId, incentives: [] },
        ]);
      }
    } else {
      setSelectedEmployees(selectedEmployees.filter((id) => id !== employeeId));
      setGovernmentDeductionSettings(
        governmentDeductionSettings.filter(
          (gs) => gs.employeeId !== employeeId,
        ),
      );
      setEmployeeDeductions(
        employeeDeductions.filter((ed) => ed.employeeId !== employeeId),
      );
      setEmployeeIncentives(
        employeeIncentives.filter((ei) => ei.employeeId !== employeeId),
      );
    }
  };

  const updateGovernmentDeduction = (
    employeeId: string,
    deductionType: "sss" | "pagibig" | "philhealth" | "tax",
    field: "enabled" | "frequency",
    value: boolean | "full" | "half",
  ) => {
    const updated = governmentDeductionSettings.map((gs) => {
      if (gs.employeeId === employeeId) {
        return {
          ...gs,
          [deductionType]: {
            ...gs[deductionType],
            [field]: value,
          },
        };
      }
      return gs;
    });
    setGovernmentDeductionSettings(updated);
  };

  const addDeduction = (employeeId: string) => {
    const existing = employeeDeductions.find(
      (ed) => ed.employeeId === employeeId,
    );
    if (existing) {
      const updated = employeeDeductions.map((ed) => {
        if (ed.employeeId === employeeId) {
          return {
            ...ed,
            deductions: [
              ...ed.deductions,
              { name: "", amount: 0, type: "custom" },
            ],
          };
        }
        return ed;
      });
      setEmployeeDeductions(updated);
    } else {
      setEmployeeDeductions([
        ...employeeDeductions,
        {
          employeeId,
          deductions: [{ name: "", amount: 0, type: "custom" }],
        },
      ]);
    }
  };

  const removeDeduction = (employeeId: string, index: number) => {
    const updated = employeeDeductions.map((ed) => {
      if (ed.employeeId === employeeId) {
        return {
          ...ed,
          deductions: ed.deductions.filter((_, i) => i !== index),
        };
      }
      return ed;
    });
    setEmployeeDeductions(updated);
  };

  const updateDeduction = (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number,
  ) => {
    const updated = employeeDeductions.map((ed) => {
      if (ed.employeeId === employeeId) {
        const newDeductions = [...ed.deductions];
        newDeductions[index] = { ...newDeductions[index], [field]: value };
        return { ...ed, deductions: newDeductions };
      }
      return ed;
    });
    setEmployeeDeductions(updated);
  };

  const setPreviewDeductionOverride = (
    employeeId: string,
    deductionName: string,
    amount: number,
  ) => {
    setPreviewDeductionOverrides((prev) => ({
      ...prev,
      [employeeId]: {
        ...(prev[employeeId] ?? {}),
        [deductionName]: amount,
      },
    }));
  };

  const addIncentive = (employeeId: string) => {
    const updated = employeeIncentives.map((ei) => {
      if (ei.employeeId === employeeId) {
        return {
          ...ei,
          incentives: [
            ...ei.incentives,
            { name: "", amount: 0, type: "incentive", taxable: false },
          ],
        };
      }
      return ei;
    });
    setEmployeeIncentives(updated);
  };

  const removeIncentive = (employeeId: string, index: number) => {
    const updated = employeeIncentives.map((ei) => {
      if (ei.employeeId === employeeId) {
        return {
          ...ei,
          incentives: ei.incentives.filter((_, i) => i !== index),
        };
      }
      return ei;
    });
    setEmployeeIncentives(updated);
  };

  const updateIncentive = (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type" | "taxable",
    value: string | number | boolean,
  ) => {
    const updated = employeeIncentives.map((ei) => {
      if (ei.employeeId === employeeId) {
        const newIncentives = [...ei.incentives];
        newIncentives[index] = { ...newIncentives[index], [field]: value };
        return { ...ei, incentives: newIncentives };
      }
      return ei;
    });
    setEmployeeIncentives(updated);
  };

  const computePreview = async () => {
    if (!effectiveOrganizationId || selectedEmployees.length === 0) return;

    setIsProcessing(true);
    try {
      const preview = await computePayrollPreviewBatch({
        organizationId: effectiveOrganizationId,
        cutoffStart: dateStringToLocalMs(cutoffStart),
        cutoffEnd: dateStringToLocalMs(cutoffEnd),
        employeeIds: selectedEmployees,
        deductionsEnabled,
        governmentDeductionSettings,
        manualDeductions: employeeDeductions.filter(
          (entry) => entry.deductions.length > 0,
        ),
        incentives: employeeIncentives.filter(
          (entry) => entry.incentives.length > 0,
        ),
      });

      const normalizedPreview = (preview || []).map((row: any) => {
        const deductions = (row.deductions || []).map((deduction: any) => ({
          ...deduction,
          amount:
            previewDeductionOverrides[row.employeeId]?.[deduction.name] ??
            deduction.amount,
        }));
        const totalDeductions = deductions.reduce(
          (sum: number, deduction: any) => sum + (deduction.amount || 0),
          0,
        );
        const totalIncentives = (row.incentives || []).reduce(
          (sum: number, incentive: any) => sum + (incentive.amount || 0),
          0,
        );

        return {
          ...row,
          payroll: row,
          employee: row.employee,
          deductions,
          totalDeductions,
          totalIncentives,
          netPay: Math.max(
            0,
            (row.grossPay || 0) +
              (row.nonTaxableAllowance || 0) -
              totalDeductions,
          ),
        };
      });

      setPreviewData(normalizedPreview);
      setCurrentStep(5);
    } catch (error) {
      console.error("Error computing preview:", error);
      toast({
        title: "Error",
        description: "Failed to compute preview",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const computeEditPreview = async () => {
    if (
      !effectiveOrganizationId ||
      editSelectedEmployees.length === 0 ||
      !editCutoffStart ||
      !editCutoffEnd
    )
      return;

    setIsComputingEditPreview(true);
    try {
      const preview = await computePayrollPreviewBatch({
        organizationId: effectiveOrganizationId,
        cutoffStart: dateStringToLocalMs(editCutoffStart),
        cutoffEnd: dateStringToLocalMs(editCutoffEnd),
        employeeIds: editSelectedEmployees,
        deductionsEnabled: editDeductionsEnabled,
        governmentDeductionSettings: editGovernmentDeductionSettings,
        manualDeductions: editEmployeeDeductions.filter(
          (entry) => entry.deductions.length > 0,
        ),
        incentives: editEmployeeIncentives.filter(
          (entry) => entry.incentives.length > 0,
        ),
      });

      const normalizedPreview = (preview || []).map((row: any) => {
        const deductions = (row.deductions || []).map((deduction: any) => ({
          ...deduction,
          amount:
            editPreviewDeductionOverrides[row.employeeId]?.[deduction.name] ??
            deduction.amount,
        }));
        const totalDeductions = deductions.reduce(
          (sum: number, deduction: any) => sum + (deduction.amount || 0),
          0,
        );
        const totalIncentives = (row.incentives || []).reduce(
          (sum: number, incentive: any) => sum + (incentive.amount || 0),
          0,
        );

        return {
          ...row,
          payroll: row,
          employee: row.employee,
          deductions,
          totalDeductions,
          totalIncentives,
          netPay: Math.max(
            0,
            (row.grossPay || 0) +
              (row.nonTaxableAllowance || 0) -
              totalDeductions,
          ),
        };
      });

      setEditPreviewData(normalizedPreview);
      setEditPayrollStep(5);
    } catch (error) {
      console.error("Error computing edit preview:", error);
      toast({
        title: "Error",
        description: "Failed to compute preview",
        variant: "destructive",
      });
    } finally {
      setIsComputingEditPreview(false);
    }
  };

  const handleSubmit = async (status: "draft" | "finalized" = "draft") => {
    if (!effectiveOrganizationId) return;

    setSubmitStatus(status);
    setIsProcessing(true);
    try {
      const previewEditsByEmployeeId = previewData.reduce<
        Record<string, PreviewPayslipEdits>
      >((acc, row) => {
        const employeeId = row?.employee?._id;
        if (!employeeId) return acc;
        acc[employeeId] = {
          deductions: Array.isArray(row.deductions)
            ? row.deductions.map((deduction: Deduction) => ({
                name: deduction.name,
                amount: deduction.amount,
                type: deduction.type || "custom",
              }))
            : [],
          incentives: Array.isArray(row.incentives)
            ? row.incentives.map((incentive: any) => ({
                name: incentive.name,
                amount: incentive.amount,
                type: incentive.type || "incentive",
                taxable:
                  typeof incentive?.taxable === "boolean"
                    ? incentive.taxable
                    : true,
              }))
            : [],
        };
        return acc;
      }, {});

      // Use preview data (including "Edit deductions" overrides) when available so saved amounts match what user saw
      let manualDeductions: {
        employeeId: string;
        deductions: { name: string; amount: number; type: string }[];
      }[];
      if (previewData.length > 0 && selectedEmployees.length > 0) {
        manualDeductions = selectedEmployees.map((employeeId: string) => {
          const p = previewData.find(
            (x: any) => x.employee?._id === employeeId,
          );
          if (!p) return { employeeId, deductions: [] };
          const deductions = (p.deductions || []).map((d: any) => ({
            name: d.name,
            amount: d.amount,
            type: d.type || "government",
          }));
          return { employeeId, deductions };
        });
      } else {
        manualDeductions = employeeDeductions.filter(
          (ed) => ed.deductions.length > 0,
        );
      }

      const incentives = employeeIncentives.filter(
        (ei) => ei.incentives.length > 0,
      );

      // Ensure we have governmentDeductionSettings for every selected employee (withholding tax needs govSettings.tax.enabled)
      const govSettingsForSubmit = selectedEmployees.map((employeeId) => {
        const existing = governmentDeductionSettings.find(
          (gs) => gs.employeeId === employeeId,
        );
        return (
          existing ?? {
            employeeId,
            sss: { enabled: true, frequency: "full" as const },
            pagibig: { enabled: true, frequency: "full" as const },
            philhealth: { enabled: true, frequency: "full" as const },
            tax: { enabled: true, frequency: "full" as const },
          }
        );
      });

      const payrollRunId = await createPayrollRun({
        organizationId: effectiveOrganizationId,
        cutoffStart: dateStringToLocalMs(cutoffStart),
        cutoffEnd: dateStringToLocalMs(cutoffEnd),
        employeeIds: selectedEmployees,
        deductionsEnabled,
        governmentDeductionSettings: govSettingsForSubmit,
        manualDeductions:
          manualDeductions.length > 0 ? manualDeductions : undefined,
        incentives: incentives.length > 0 ? incentives : undefined,
      });

      // Ensure Step 5 edits are persisted to generated payslips before user saves as
      // draft/finalize, so the review state and stored state always match.
      if (payrollRunId && Object.keys(previewEditsByEmployeeId).length > 0) {
        const createdPayslips = await getPayslipsByPayrollRun(payrollRunId);
        await Promise.all(
          (createdPayslips || []).map(async (payslip: any) => {
            const employeeId = String(
              payslip.employeeId ?? payslip.employee?._id ?? "",
            );
            const edits = previewEditsByEmployeeId[employeeId];
            if (!edits) return;
            await updatePayslip({
              payslipId: payslip._id,
              deductions: edits.deductions,
              incentives:
                edits.incentives.length > 0 ? edits.incentives : undefined,
            });
          }),
        );
      }

      // Finalize: show recipient dialog (emails only for employees with Plinth accounts)
      if (status === "finalized" && payrollRunId) {
        openPayrollFinalizeFlow(
          payrollRunId,
          async () => {
            setIsDialogOpen(false);
            setCurrentStep(1);
            setCutoffStart("");
            setCutoffEnd("");
            setSelectedEmployees([]);
            setDeductionsEnabled(true);
            setGovernmentDeductionSettings([]);
            setEmployeeDeductions([]);
            setEmployeeIncentives([]);
            setPreviewData([]);
            setPreviewDeductionOverrides({});
            await loadPayrollRuns();
          },
          async () => {
            setIsDialogOpen(false);
            setCurrentStep(1);
            setCutoffStart("");
            setCutoffEnd("");
            setSelectedEmployees([]);
            setDeductionsEnabled(true);
            setGovernmentDeductionSettings([]);
            setEmployeeDeductions([]);
            setEmployeeIncentives([]);
            setPreviewData([]);
            setPreviewDeductionOverrides({});
            await loadPayrollRuns();
            toast({
              title: "Saved as draft",
              description:
                "Payroll was not finalized. You can finalize from the payroll list when ready.",
            });
          },
        );
        return;
      }

      // Reset form
      setIsDialogOpen(false);
      setCurrentStep(1);
      setCutoffStart("");
      setCutoffEnd("");
      setSelectedEmployees([]);
      setDeductionsEnabled(true);
      setGovernmentDeductionSettings([]);
      setEmployeeDeductions([]);
      setEmployeeIncentives([]);
      setPreviewData([]);
      setPreviewDeductionOverrides({});

      // Reload payroll runs
      await loadPayrollRuns();
      toast({
        title: "Success",
        description:
          status === "finalized"
            ? "Payroll run created and finalized successfully!"
            : "Payroll run created as draft. Review and finalize when ready.",
      });
    } catch (error: any) {
      console.error("Error creating payroll run:", error);
      toast({
        title: "Error",
        description:
          error.message || "Failed to process payroll. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setSubmitStatus("idle");
    }
  };

  const resetDialog = () => {
    setDeductionsEnabled(true);
    setCurrentStep(1);
    setCutoffStart("");
    setCutoffEnd("");
    setSelectedEmployees([]);
    setGovernmentDeductionSettings([]);
    setEmployeeDeductions([]);
    setEmployeeIncentives([]);
    setPreviewData([]);
    setPreviewDeductionOverrides({});
  };

  const handleEditPayrollRun = async (payrollRun: any) => {
    if (payrollRun.status !== "draft") {
      toast({
        title: "Error",
        description: "Can only edit payroll runs in draft status",
        variant: "destructive",
      });
      return;
    }

    setEditingPayrollRun(payrollRun);
    setEditDeductionsEnabled(payrollRun.deductionsEnabled ?? true);
    setEditCutoffStart(format(new Date(payrollRun.cutoffStart), "yyyy-MM-dd"));
    setEditCutoffEnd(format(new Date(payrollRun.cutoffEnd), "yyyy-MM-dd"));
    setIsEditPayrollRunOpen(true);
    setEditPayrollStep(1);

    const draftConfig = payrollRun.draftConfig;

    // Always load from payslips when they exist so edited deductions are shown (source of truth).
    try {
      const payslipsData = await getPayslipsByPayrollRun(payrollRun._id);
      if (payslipsData?.length > 0) {
        const employeeIds = payslipsData.map((p: any) => p.employeeId);
        setEditSelectedEmployees(employeeIds);

        const normalizedGovSettings: GovernmentDeductionSettings[] =
          employeeIds.map((employeeId: string) => {
            const saved = draftConfig?.governmentDeductionSettings?.find(
              (gs: GovernmentDeductionSettings) => gs.employeeId === employeeId,
            );
            return (
              saved || {
                employeeId,
                sss: { enabled: true, frequency: "full" },
                pagibig: { enabled: true, frequency: "full" },
                philhealth: { enabled: true, frequency: "full" },
                tax: { enabled: true, frequency: "full" },
              }
            );
          });
        setEditGovernmentDeductionSettings(normalizedGovSettings);

        // Load full deductions from each payslip (including gov) so edits persist
        const allDeductions: EmployeeDeduction[] = employeeIds.map(
          (employeeId: string) => {
            const slip = payslipsData.find(
              (p: any) => p.employeeId === employeeId,
            );
            const deductions = slip?.deductions ?? [];
            return { employeeId, deductions };
          },
        );
        setEditEmployeeDeductions(allDeductions);

        const allIncentives: EmployeeIncentive[] = employeeIds.map(
          (employeeId: string) => {
            const slip = payslipsData.find(
              (p: any) => p.employeeId === employeeId,
            );
            const incentives = slip?.incentives ?? [];
            return { employeeId, incentives };
          },
        );
        setEditEmployeeIncentives(allIncentives);
        return;
      }
    } catch (error) {
      console.error("Error loading payroll run payslips:", error);
    }

    // No payslips: use draftConfig (e.g. new draft or legacy run)
    if (draftConfig?.employeeIds?.length) {
      const selectedEmployeeIds = draftConfig.employeeIds;
      setEditSelectedEmployees(selectedEmployeeIds);

      const normalizedGovSettings: GovernmentDeductionSettings[] =
        selectedEmployeeIds.map((employeeId: string) => {
          const saved = draftConfig.governmentDeductionSettings?.find(
            (gs: GovernmentDeductionSettings) => gs.employeeId === employeeId,
          );
          return (
            saved || {
              employeeId,
              sss: { enabled: true, frequency: "full" },
              pagibig: { enabled: true, frequency: "full" },
              philhealth: { enabled: true, frequency: "full" },
              tax: { enabled: true, frequency: "full" },
            }
          );
        });
      setEditGovernmentDeductionSettings(normalizedGovSettings);

      const normalizedDeductions: EmployeeDeduction[] = selectedEmployeeIds.map(
        (employeeId: string) => {
          const saved = draftConfig.manualDeductions?.find(
            (ed: EmployeeDeduction) => ed.employeeId === employeeId,
          );
          return { employeeId, deductions: saved?.deductions ?? [] };
        },
      );
      setEditEmployeeDeductions(normalizedDeductions);

      const normalizedIncentives: EmployeeIncentive[] = selectedEmployeeIds.map(
        (employeeId: string) => {
          const saved = draftConfig.incentives?.find(
            (ei: EmployeeIncentive) => ei.employeeId === employeeId,
          );
          return {
            employeeId,
            incentives: (saved?.incentives ?? []).map(
              normalizeIncentiveLineForUi,
            ),
          };
        },
      );
      setEditEmployeeIncentives(normalizedIncentives);
    }
  };

  const handleSavePayrollRun = async (
    status: "draft" | "finalized" = "draft",
  ) => {
    if (!editingPayrollRun || !effectiveOrganizationId) return;

    setEditSubmitStatus(status);
    setIsSavingPayrollRun(true);
    try {
      const manualDeductions =
        editPreviewData.length > 0 && editSelectedEmployees.length > 0
          ? editSelectedEmployees.map((employeeId: string) => {
              const row = editPreviewData.find(
                (entry: any) => entry.employee?._id === employeeId,
              );
              return {
                employeeId,
                deductions: (row?.deductions || []).map((d: any) => ({
                  name: d.name,
                  amount: d.amount,
                  type: d.type || "government",
                })),
              };
            })
          : editEmployeeDeductions.filter((ed) => ed.deductions.length > 0);
      const incentives = editEmployeeIncentives.filter(
        (ei) => ei.incentives.length > 0,
      );

      // Ensure we have governmentDeductionSettings for every selected employee
      const editGovSettingsForSubmit = editSelectedEmployees.map(
        (employeeId) => {
          const existing = editGovernmentDeductionSettings.find(
            (gs) => gs.employeeId === employeeId,
          );
          return (
            existing ?? {
              employeeId,
              sss: { enabled: true, frequency: "full" as const },
              pagibig: { enabled: true, frequency: "full" as const },
              philhealth: { enabled: true, frequency: "full" as const },
              tax: { enabled: true, frequency: "full" as const },
            }
          );
        },
      );

      await updatePayrollRun({
        payrollRunId: editingPayrollRun._id,
        cutoffStart: dateStringToLocalMs(editCutoffStart),
        cutoffEnd: dateStringToLocalMs(editCutoffEnd),
        employeeIds: editSelectedEmployees,
        deductionsEnabled: editDeductionsEnabled,
        governmentDeductionSettings: editGovSettingsForSubmit,
        manualDeductions:
          manualDeductions.length > 0 ? manualDeductions : undefined,
        incentives: incentives.length > 0 ? incentives : undefined,
      });

      if (status === "finalized") {
        const runId = editingPayrollRun._id;
        setIsEditPayrollRunOpen(false);
        setEditingPayrollRun(null);
        openPayrollFinalizeFlow(
          runId,
          async () => {
            await loadPayrollRuns();
          },
          async () => {
            await loadPayrollRuns();
          },
        );
        return;
      }

      setIsEditPayrollRunOpen(false);
      setEditingPayrollRun(null);
      await loadPayrollRuns();
      toast({
        title: "Success",
        description: "Payroll run updated successfully!",
      });
    } catch (error: any) {
      console.error("Error updating payroll run:", error);
      toast({
        title: "Error",
        description:
          error.message || "Failed to update payroll run. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingPayrollRun(false);
      setEditSubmitStatus("idle");
    }
  };

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Payroll</h1>
            <p className="text-gray-600 mt-2">
              Manage payroll processing and payslips
            </p>
          </div>
          {activeTab === "regular" && (
            <Dialog
              open={isDialogOpen}
              onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (!open) resetDialog();
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Process Payroll
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Process Payroll</DialogTitle>
                  <div className="mt-4 overflow-x-auto pb-2 -mx-1 min-w-0">
                    <div className="min-w-[560px]">
                      <Stepper
                        currentStep={currentStep}
                        steps={[
                          { title: "Select Period" },
                          { title: "Select Employees" },
                          { title: "Government Deductions" },
                          { title: "Deductions & Incentives" },
                          { title: "Preview & Confirm" },
                        ]}
                      />
                    </div>
                  </div>
                </DialogHeader>

                {/* Step 1: Dates */}
                {currentStep === 1 && (
                  <Suspense fallback={<div className="py-4">Loading...</div>}>
                    <PayrollStep1Dates
                      cutoffStart={cutoffStart}
                      cutoffEnd={cutoffEnd}
                      onCutoffStartChange={setCutoffStart}
                      onCutoffEndChange={setCutoffEnd}
                    />
                  </Suspense>
                )}

                {/* Step 2: Employees */}
                {currentStep === 2 && (
                  <Suspense fallback={<div className="py-4">Loading...</div>}>
                    <PayrollStep2Employees
                      employees={employees ?? []}
                      selectedEmployees={selectedEmployees}
                      onEmployeeSelect={handleEmployeeSelect}
                      isLoading={employees === undefined}
                      onSelectAll={() => {
                        if (
                          selectedEmployees.length === (employees?.length ?? 0)
                        ) {
                          // Deselect all
                          setSelectedEmployees([]);
                          setGovernmentDeductionSettings([]);
                          setEmployeeDeductions([]);
                          setEmployeeIncentives([]);
                        } else {
                          // Select all
                          const allEmployeeIds: string[] =
                            employees?.map((e: any) => e._id) || [];
                          setSelectedEmployees(allEmployeeIds);
                          // Initialize settings for all employees
                          const allGovSettings: GovernmentDeductionSettings[] =
                            allEmployeeIds.map((employeeId: string) => ({
                              employeeId,
                              sss: { enabled: true, frequency: "full" },
                              pagibig: { enabled: true, frequency: "full" },
                              philhealth: {
                                enabled: true,
                                frequency: "full",
                              },
                              tax: { enabled: true, frequency: "full" },
                            }));
                          setGovernmentDeductionSettings(allGovSettings);
                          const allDeductions: EmployeeDeduction[] =
                            allEmployeeIds.map((employeeId: string) => ({
                              employeeId,
                              deductions: [],
                            }));
                          setEmployeeDeductions(allDeductions);
                          const allIncentives: EmployeeIncentive[] =
                            allEmployeeIds.map((employeeId: string) => ({
                              employeeId,
                              incentives: [],
                            }));
                          setEmployeeIncentives(allIncentives);
                        }
                      }}
                    />
                  </Suspense>
                )}

                {/* Step 3: Government Deductions */}
                {currentStep === 3 && (
                  <Suspense fallback={<div className="py-4">Loading...</div>}>
                    <PayrollStep3GovernmentDeductions
                      employees={employees || []}
                      selectedEmployees={selectedEmployees}
                      governmentDeductionSettings={governmentDeductionSettings}
                      deductionsEnabled={deductionsEnabled}
                      onDeductionsEnabledChange={setDeductionsEnabled}
                      onUpdateGovernmentDeduction={updateGovernmentDeduction}
                      taxSettings={{
                        taxDeductionFrequency:
                          settings?.payrollSettings?.taxDeductionFrequency ??
                          "twice_per_month",
                        taxDeductOnPay:
                          settings?.payrollSettings?.taxDeductOnPay ?? "first",
                      }}
                      cutoffStart={
                        cutoffStart
                          ? new Date(cutoffStart).getTime()
                          : undefined
                      }
                    />
                  </Suspense>
                )}

                {/* Step 4: Other Deductions and Incentives */}
                {currentStep === 4 && (
                  <Suspense fallback={<div className="py-4">Loading...</div>}>
                    <PayrollStep4DeductionsIncentives
                      employees={employees || []}
                      selectedEmployees={selectedEmployees}
                      employeeDeductions={employeeDeductions}
                      employeeIncentives={employeeIncentives}
                      onAddDeduction={addDeduction}
                      onRemoveDeduction={removeDeduction}
                      onUpdateDeduction={updateDeduction}
                      onAddIncentive={addIncentive}
                      onRemoveIncentive={removeIncentive}
                      onUpdateIncentive={updateIncentive}
                    />
                  </Suspense>
                )}

                {/* Step 5: Preview */}
                {currentStep === 5 && (
                  <Suspense fallback={<div className="py-4">Loading...</div>}>
                    <PayrollStep5Preview
                      previewData={previewData}
                      cutoffStart={cutoffStart}
                      cutoffEnd={cutoffEnd}
                      currentOrganization={currentOrganization}
                      canEditDeductions={canEditPreviewDeductions}
                      onEditPayslip={(preview: any) =>
                        handleEditPreviewPayslip(preview, "create_preview")
                      }
                      employeeDeductions={employeeDeductions}
                      previewDeductionOverrides={previewDeductionOverrides}
                      onAddDeduction={addDeduction}
                      onRemoveDeduction={removeDeduction}
                      onUpdateDeduction={updateDeduction}
                      onOverrideDeductionAmount={setPreviewDeductionOverride}
                      onRecomputePreview={computePreview}
                    />
                  </Suspense>
                )}

                <DialogFooter>
                  <div className="flex justify-between w-full">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (currentStep > 1) {
                          setCurrentStep(currentStep - 1);
                        } else {
                          setIsDialogOpen(false);
                          resetDialog();
                        }
                      }}
                      disabled={isProcessing}
                    >
                      <ChevronLeft className="h-4 w-4 mr-2" />
                      {currentStep === 1 ? "Cancel" : "Back"}
                    </Button>
                    <div className="flex gap-2">
                      {currentStep < 5 && (
                        <Button
                          type="button"
                          onClick={() => {
                            if (currentStep === 1) {
                              if (!cutoffStart || !cutoffEnd) {
                                toast({
                                  title: "Validation Error",
                                  description: "Please select cutoff dates",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCurrentStep(2);
                            } else if (currentStep === 2) {
                              if (selectedEmployees.length === 0) {
                                toast({
                                  title: "Validation Error",
                                  description:
                                    "Please select at least one employee",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCurrentStep(3);
                            } else if (currentStep === 3) {
                              setCurrentStep(4);
                            } else if (currentStep === 4) {
                              computePreview();
                            }
                          }}
                          disabled={isProcessing}
                        >
                          {currentStep === 4 && isProcessing ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Generating Payslips
                            </>
                          ) : (
                            <>
                              Next
                              <ChevronRight className="h-4 w-4 ml-2" />
                            </>
                          )}
                        </Button>
                      )}
                      {currentStep === 5 && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleSubmit("draft")}
                            disabled={isProcessing}
                          >
                            {submitStatus === "draft" ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              "Save as Draft"
                            )}
                          </Button>
                          <Button
                            type="button"
                            onClick={() => handleSubmit("finalized")}
                            disabled={isProcessing}
                          >
                            {submitStatus === "finalized" ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Finalizing...
                              </>
                            ) : (
                              "Finalize Payroll"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            setActiveTab(
              v === "13th_month"
                ? "13th_month"
                : v === "leave_conversion"
                  ? "leave_conversion"
                  : "regular",
            )
          }
        >
          <TabsList className="mb-4 h-8 p-1">
            <TabsTrigger value="regular" className="px-2.5 py-1 text-xs">
              Regular Payroll
            </TabsTrigger>
            <TabsTrigger value="13th_month" className="px-2.5 py-1 text-xs">
              13th Month
            </TabsTrigger>
            <TabsTrigger
              value="leave_conversion"
              className="px-2.5 py-1 text-xs"
            >
              Leave Conversion
            </TabsTrigger>
          </TabsList>
          <TabsContent value="regular">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
                <CardTitle>Payroll Runs</CardTitle>
                <div className="flex items-center gap-2">
                  {selectedRunIds.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkDeletePayrollRuns}
                      disabled={isDeletingPayrollRun}
                    >
                      {isDeletingPayrollRun ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Delete Selected
                    </Button>
                  )}
                  <MonthPicker
                    value={filterMonth}
                    onChange={setFilterMonth}
                    className="min-w-[220px]"
                    triggerClassName="w-full sm:w-[220px]"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <PayrollRunsTable
                  payrollRuns={paginatedPayrollRuns || []}
                  isLoading={!payrollRunsInitialReady}
                  selectedRunIds={selectedRunIds}
                  onToggleRunSelection={(runId, checked) => {
                    setSelectedRunIds((prev) =>
                      checked
                        ? Array.from(new Set([...prev, runId]))
                        : prev.filter((id) => id !== runId),
                    );
                  }}
                  onToggleSelectAllVisible={(runIds, checked) => {
                    setSelectedRunIds((prev) => {
                      if (!checked) return prev.filter((id) => !runIds.includes(id));
                      return Array.from(new Set([...prev, ...runIds]));
                    });
                  }}
                  isDeletingRunId={
                    isDeletingPayrollRun && payrollRunsToDelete.length === 1
                      ? String(payrollRunsToDelete[0]._id)
                      : null
                  }
                  disableSelection={isDeletingPayrollRun}
                  onViewSummary={handleViewSummary}
                  onViewPayslips={handleViewPayslips}
                  onEdit={handleEditPayrollRun}
                  onRegeneratePayslips={handleRegeneratePayslips}
                  regeneratingPayrollRunId={regeneratingPayrollRunId}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDeletePayrollRun}
                />
                {filteredPayrollRuns.length > payrollRunsPageSize && (
                  <div className="flex items-center justify-between gap-4 border-t pt-4 mt-4">
                    <p className="text-sm text-muted-foreground">
                      {(payrollRunsPage - 1) * payrollRunsPageSize + 1}-
                      {Math.min(
                        payrollRunsPage * payrollRunsPageSize,
                        filteredPayrollRuns.length,
                      )}{" "}
                      of {filteredPayrollRuns.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPayrollRunsPage((page) => Math.max(1, page - 1))
                        }
                        disabled={payrollRunsPage <= 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {payrollRunsPage} of {totalPayrollRunPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPayrollRunsPage((page) =>
                            Math.min(totalPayrollRunPages, page + 1),
                          )
                        }
                        disabled={payrollRunsPage >= totalPayrollRunPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="13th_month">
            {effectiveOrganizationId && (
              <ThirteenthMonthTab
                organizationId={effectiveOrganizationId}
                payrollRuns={payrollRuns}
                onLoadPayrollRuns={loadPayrollRuns}
                onViewSummary={handleViewSummary}
                onViewPayslips={handleViewPayslips}
                onEdit={handleEditPayrollRun}
                onStatusChange={handleStatusChange}
                onDelete={handleDeletePayrollRun}
              />
            )}
          </TabsContent>
          <TabsContent value="leave_conversion">
            {effectiveOrganizationId && (
              <LeaveConversionTab
                organizationId={effectiveOrganizationId}
                payrollRuns={payrollRuns}
                onLoadPayrollRuns={loadPayrollRuns}
                onViewSummary={handleViewSummary}
                onViewPayslips={handleViewPayslips}
                onEdit={handleEditPayrollRun}
                onStatusChange={handleStatusChange}
                onDelete={handleDeletePayrollRun}
              />
            )}
          </TabsContent>
        </Tabs>

        {/* View Payslips Dialog - lazy loaded */}
        {isViewPayslipsOpen && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <ViewPayslipsDialog
              open={isViewPayslipsOpen}
              onOpenChange={setIsViewPayslipsOpen}
              selectedPayrollRun={selectedPayrollRun}
              payslips={payslips}
              isLoadingPayslips={isLoadingPayslips}
              payslipDetailsById={payslipDetailsById}
              loadingPayslipDetailsById={loadingPayslipDetailsById}
              expandedPayslipId={expandedPayslipId}
              payslipConcerns={payslipConcerns}
              currentOrganization={currentOrganization}
              isAdminOrAccounting={isAdminOrAccounting}
              onTogglePayslip={handleOpenPayslipDetails}
              onEditPayslip={handleEditPayslip}
            />
          </Suspense>
        )}

        {/* Edit Payslip Dialog - lazy loaded */}
        {isEditPayslipOpen && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <EditPayslipDialog
              open={isEditPayslipOpen}
              onOpenChange={setIsEditPayslipOpen}
              editingPayslip={editingPayslip}
              editDeductions={editDeductions}
              editIncentives={editIncentives}
              isSavingPayslip={isSavingPayslip}
              onAddDeduction={addEditDeduction}
              onRemoveDeduction={removeEditDeduction}
              onUpdateDeduction={updateEditDeduction}
              onAddIncentive={addEditIncentive}
              onRemoveIncentive={removeEditIncentive}
              onUpdateIncentive={updateEditIncentive}
              onSave={handleSavePayslip}
            />
          </Suspense>
        )}

        {/* Payroll Summary Dialog - lazy loaded */}
        {isSummaryOpen && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <PayrollSummaryDialog
              open={isSummaryOpen}
              onOpenChange={setIsSummaryOpen}
              summaryData={summaryData}
              isLoadingSummary={isLoadingSummary}
              selectedPayrollRun={selectedPayrollRun}
              isAdminOrAccounting={isAdminOrAccounting}
              onExportExcel={handleExportExcel}
              onExportPDF={handleExportPDF}
              isSavingDraft={isSavingDraft}
              isFinalizing={finalizeFlowBusy}
              onSaveDraft={async () => {
                setIsSavingDraft(true);
                try {
                  await loadPayrollRuns();
                  toast({
                    title: "Saved",
                    description: "Payroll run saved as draft successfully.",
                  });
                  setIsSummaryOpen(false);
                } catch (error: any) {
                  toast({
                    title: "Error",
                    description: error.message || "Failed to save payroll run",
                    variant: "destructive",
                  });
                } finally {
                  setIsSavingDraft(false);
                }
              }}
              onFinalize={async () => {
                if (!selectedPayrollRun) return;
                openPayrollFinalizeFlow(
                  selectedPayrollRun._id,
                  async () => {
                    await loadPayrollRuns();
                    setIsSummaryOpen(false);
                  },
                  async () => {},
                );
              }}
            />
          </Suspense>
        )}

        {/* Edit Payroll Run Dialog - lazy loaded */}
        {isEditPayrollRunOpen && (
          <Suspense fallback={<div className="py-4">Loading...</div>}>
            <EditPayrollRunDialog
              open={isEditPayrollRunOpen}
              onOpenChange={(open: boolean) => {
                setIsEditPayrollRunOpen(open);
                if (!open) {
                  setEditingPayrollRun(null);
                  setEditPayrollStep(1);
                  setEditDeductionsEnabled(true);
                  setEditCutoffStart("");
                  setEditCutoffEnd("");
                  setEditSelectedEmployees([]);
                  setEditGovernmentDeductionSettings([]);
                  setEditEmployeeDeductions([]);
                  setEditEmployeeIncentives([]);
                  setEditPreviewData([]);
                  setEditPreviewDeductionOverrides({});
                  setEditSubmitStatus("idle");
                }
              }}
              employees={employees || []}
              editPayrollStep={editPayrollStep}
              editCutoffStart={editCutoffStart}
              editCutoffEnd={editCutoffEnd}
              editSelectedEmployees={editSelectedEmployees}
              editDeductionsEnabled={editDeductionsEnabled}
              setEditDeductionsEnabled={setEditDeductionsEnabled}
              editGovernmentDeductionSettings={editGovernmentDeductionSettings}
              editEmployeeDeductions={editEmployeeDeductions}
              editEmployeeIncentives={editEmployeeIncentives}
              editPreviewData={editPreviewData}
              editPreviewDeductionOverrides={editPreviewDeductionOverrides}
              setEditPreviewDeductionOverrides={
                setEditPreviewDeductionOverrides
              }
              currentOrganization={currentOrganization}
              canEditPreviewDeductions={canEditPreviewDeductions}
              isComputingEditPreview={isComputingEditPreview}
              onComputeEditPreview={computeEditPreview}
              isSavingPayrollRun={isSavingPayrollRun}
              onCutoffStartChange={setEditCutoffStart}
              onCutoffEndChange={setEditCutoffEnd}
              setEditPayrollStep={setEditPayrollStep}
              onUpdateGovernmentDeduction={(
                employeeId: string,
                deductionType: "sss" | "pagibig" | "philhealth" | "tax",
                field: "enabled" | "frequency",
                value: boolean | "full" | "half",
              ) => {
                const updated = editGovernmentDeductionSettings.map((gs) => {
                  if (gs.employeeId === employeeId) {
                    return {
                      ...gs,
                      [deductionType]: {
                        ...gs[deductionType],
                        [field]: value,
                      },
                    };
                  }
                  return gs;
                });
                if (!updated.find((gs) => gs.employeeId === employeeId)) {
                  updated.push({
                    employeeId,
                    sss: { enabled: true, frequency: "full" },
                    pagibig: { enabled: true, frequency: "full" },
                    philhealth: { enabled: true, frequency: "full" },
                    tax: { enabled: true, frequency: "full" },
                  });
                }
                setEditGovernmentDeductionSettings(updated);
              }}
              onSelectEmployeesChange={setEditSelectedEmployees}
              setEditGovernmentDeductionSettings={
                setEditGovernmentDeductionSettings
              }
              setEditEmployeeDeductions={setEditEmployeeDeductions}
              setEditEmployeeIncentives={setEditEmployeeIncentives}
              onSavePayrollRun={handleSavePayrollRun}
              editSubmitStatus={editSubmitStatus}
              toast={toast}
              taxSettings={{
                taxDeductionFrequency:
                  settings?.payrollSettings?.taxDeductionFrequency ??
                  "twice_per_month",
                taxDeductOnPay:
                  settings?.payrollSettings?.taxDeductOnPay ?? "first",
              }}
              onEditPreviewPayslip={(preview: any) =>
                handleEditPreviewPayslip(preview, "edit_preview")
              }
            />
          </Suspense>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={isDeleteDialogOpen}
          onOpenChange={(open) => {
            if (isDeletingPayrollRun) return;
            setIsDeleteDialogOpen(open);
            if (!open) setPayrollRunsToDelete([]);
          }}
        >
          <DialogContent
            onPointerDownOutside={(e) => isDeletingPayrollRun && e.preventDefault()}
            onEscapeKeyDown={(e) => isDeletingPayrollRun && e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>
                {payrollRunsToDelete.length > 1
                  ? `Delete ${payrollRunsToDelete.length} Runs`
                  : "Delete Run"}
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete{" "}
                {payrollRunsToDelete.length > 1
                  ? "these payroll runs"
                  : "this payroll run"}
                ? This action will permanently remove the payroll run,
                associated payslips, and cost records. This action cannot be
                undone.
              </DialogDescription>
            </DialogHeader>
            {payrollRunsToDelete.length > 0 && (
              <div className="py-4">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Selected:</span>{" "}
                  {payrollRunsToDelete.length} run
                  {payrollRunsToDelete.length === 1 ? "" : "s"}
                </p>
                {payrollRunsToDelete.length === 1 && (
                  <>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Period:</span>{" "}
                      {payrollRunsToDelete[0].period}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Status:</span>{" "}
                      {payrollRunsToDelete[0].status}
                    </p>
                  </>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={isDeletingPayrollRun}
                onClick={() => {
                  setIsDeleteDialogOpen(false);
                  setPayrollRunsToDelete([]);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDeletePayrollRun}
                disabled={isDeletingPayrollRun}
              >
                {isDeletingPayrollRun ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <PayrollFinalizeDialog
          open={finalizeDialogOpen}
          payrollRunId={finalizePayrollRunId}
          onClose={closeFinalizeDialog}
          onFlowSuccess={async () => {
            await finalizeSuccessRef.current?.();
          }}
          onFlowCancel={async () => {
            await finalizeCancelRef.current?.();
          }}
        />
      </div>
    </MainLayout>
  );
}
