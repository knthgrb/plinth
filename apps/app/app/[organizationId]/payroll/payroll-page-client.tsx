"use client";

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
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
  updatePayslip,
  updatePayrollRunStatus,
  updatePayrollRun,
  deletePayrollRun,
  getPayslipMessages,
  getPayrollRunSummary,
  computeEmployeePayroll,
} from "@/actions/payroll";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { PayslipDetail } from "@/components/payslip-detail";

type Deduction = {
  name: string;
  amount: number;
  type: string;
};

type EmployeeDeduction = {
  employeeId: string;
  deductions: Deduction[];
};

type EmployeeIncentive = {
  employeeId: string;
  incentives: Deduction[];
};

type GovernmentDeductionSettings = {
  employeeId: string;
  sss: { enabled: boolean; frequency: "full" | "half" };
  pagibig: { enabled: boolean; frequency: "full" | "half" };
  philhealth: { enabled: boolean; frequency: "full" | "half" };
  tax: { enabled: boolean; frequency: "full" | "half" };
};

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
  const [editIncentives, setEditIncentives] = useState<Deduction[]>([]);
  const [isSavingPayslip, setIsSavingPayslip] = useState(false);
  const [payslipConcerns, setPayslipConcerns] = useState<Record<string, any[]>>(
    {},
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
  const [payrollRunToDelete, setPayrollRunToDelete] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<
    "regular" | "13th_month" | "leave_conversion"
  >("regular");

  const searchParams = useSearchParams();
  const payslipIdParam = searchParams.get("payslipId");

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

  // Handle payslipId from URL (from chat link)
  useEffect(() => {
    if (payslipIdParam && effectiveOrganizationId) {
      // Find the payroll run that contains this payslip
      const findAndOpenPayslip = async () => {
        try {
          const { getPayslip: fetchPayslip } =
            await import("@/actions/payroll");
          const payslip = await fetchPayslip(payslipIdParam);
          if (payslip) {
            // Get the payroll run for this payslip
            const runs = await getPayrollRuns(effectiveOrganizationId);
            const payrollRun = runs.find(
              (run: any) => run._id === payslip.payrollRunId,
            );
            if (payrollRun) {
              await handleViewPayslips(payrollRun, payslipIdParam);
            }
          }
        } catch (error) {
          console.error("Error loading payslip from URL:", error);
        }
      };
      findAndOpenPayslip();
    }
  }, [payslipIdParam, effectiveOrganizationId]);

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
    try {
      const payslipsData = await getPayslipsByPayrollRun(payrollRun._id);
      setPayslips(payslipsData);

      // Load concerns for each payslip
      const concernsMap: Record<string, any[]> = {};
      for (const payslip of payslipsData) {
        try {
          const messages = await getPayslipMessages(payslip._id);
          concernsMap[payslip._id] = messages || [];
        } catch (error) {
          console.error(
            `Error loading concerns for payslip ${payslip._id}:`,
            error,
          );
          concernsMap[payslip._id] = [];
        }
      }
      setPayslipConcerns(concernsMap);

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
    } catch (error) {
      console.error("Error loading payslips:", error);
      toast({
        title: "Error",
        description: "Failed to load payslips",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPayslips(false);
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
    setPayrollRunToDelete(payrollRun);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeletePayrollRun = async () => {
    if (!payrollRunToDelete) return;

    try {
      await deletePayrollRun(payrollRunToDelete._id);
      await loadPayrollRuns();
      setIsDeleteDialogOpen(false);
      setPayrollRunToDelete(null);
      toast({
        title: "Deleted",
        description: "Payroll run deleted successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete payroll run",
        variant: "destructive",
      });
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
    }
  };

  const handleEditPayslip = (payslip: any) => {
    setEditingPayslip(payslip);
    setEditDeductions([...payslip.deductions]);
    setEditIncentives([...(payslip.incentives || [])]);
    setIsEditPayslipOpen(true);
  };

  const handleEditPreviewPayslip = (
    preview: any,
    mode: "create_preview" | "edit_preview",
  ) => {
    const noWorkDays = preview.noWorkNoPayDays || 0;
    const absentDays = Math.max(0, (preview.absences || 0) - noWorkDays);
    const absenceLabel =
      noWorkDays > 0 && absentDays === 0
        ? `No work on a holiday (${preview.absences || 0} ${(preview.absences || 0) === 1 ? "day" : "days"})`
        : `Absent (${preview.absences || 0} ${(preview.absences || 0) === 1 ? "day" : "days"})`;
    const attendanceDeductions: Deduction[] = [
      ...(preview.absentDeduction > 0
        ? [{ name: absenceLabel, amount: preview.absentDeduction, type: "attendance" }]
        : []),
      ...(preview.lateDeductionSpecialHoliday > 0
        ? [
            {
              name: "Special Holiday Late",
              amount: preview.lateDeductionSpecialHoliday,
              type: "attendance",
            },
          ]
        : []),
      ...(preview.lateDeductionRegularHoliday > 0
        ? [
            {
              name: "Regular Holiday Late",
              amount: preview.lateDeductionRegularHoliday,
              type: "attendance",
            },
          ]
        : []),
      ...((preview.lateDeductionRegularDay ?? 0) > 0
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
      ...(preview.undertimeDeduction > 0
        ? [{ name: "Undertime", amount: preview.undertimeDeduction, type: "attendance" }]
        : []),
    ];

    setEditingPayslip({
      _id: `${mode}:${preview.employee?._id}`,
      employee: preview.employee,
      deductions: [...(preview.deductions || []), ...attendanceDeductions],
      incentives: [...(preview.incentives || [])],
      __mode: mode,
      __employeeId: preview.employee?._id,
    });
    setEditDeductions([...(preview.deductions || []), ...attendanceDeductions]);
    setEditIncentives([...(preview.incentives || [])]);
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
        const manualDeductionsOnly = editDeductions.filter(
          (d) => (d.type || "").toLowerCase() !== "attendance" && !isAttendanceName(d.name),
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

      // Reload payslips and concerns
      if (selectedPayrollRun) {
        await handleViewPayslips(selectedPayrollRun);
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
      { name: "", amount: 0, type: "incentive" },
    ]);
  };

  const removeEditIncentive = (index: number) => {
    setEditIncentives(editIncentives.filter((_, i) => i !== index));
  };

  const updateEditIncentive = (
    index: number,
    field: "name" | "amount" | "type",
    value: string | number,
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
            { name: "", amount: 0, type: "incentive" },
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
    field: "name" | "amount" | "type",
    value: string | number,
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
      const preview: any[] = [];

      for (const employeeId of selectedEmployees) {
        const employee = employees?.find((e: any) => e._id === employeeId);
        if (!employee) continue;

        // Convert cutoff dates to timestamps (local midnight so summary aligns with attendance)
        const cutoffStartTs = dateStringToLocalMs(cutoffStart);
        const cutoffEndTs = dateStringToLocalMs(cutoffEnd);

        // Use backend payroll computation so preview matches final payslip
        const payroll = await computeEmployeePayroll({
          employeeId,
          cutoffStart: cutoffStartTs,
          cutoffEnd: cutoffEndTs,
        });

        // Build deductions array from structured deductions object.
        // Respect government deduction settings from Step 3 so preview matches
        // what will be applied when the payroll run is created.
        const deductions: Deduction[] = [];

        const govSettings = governmentDeductionSettings.find(
          (gs) => gs.employeeId === employeeId,
        );

        // Helper to get effective government deduction amount based on settings
        const applyGovSetting = (
          enabled: boolean | undefined,
          frequency: "full" | "half" | undefined,
          baseAmount: number | undefined,
        ): number => {
          if (!baseAmount || baseAmount <= 0) return 0;
          if (enabled === false) return 0;
          if (frequency === "half") return baseAmount / 2;
          return baseAmount;
        };

        // SSS, PhilHealth, Pag-IBIG only when deductionsEnabled; withholding tax follows org settings independently
        if (deductionsEnabled) {
          const sssAmount = applyGovSetting(
            govSettings?.sss.enabled,
            govSettings?.sss.frequency,
            payroll.deductions?.sss,
          );
          if (sssAmount > 0) {
            deductions.push({
              name: "SSS",
              amount: sssAmount,
              type: "government",
            });
          }

          const philhealthAmount = applyGovSetting(
            govSettings?.philhealth.enabled,
            govSettings?.philhealth.frequency,
            payroll.deductions?.philhealth,
          );
          if (philhealthAmount > 0) {
            deductions.push({
              name: "PhilHealth",
              amount: philhealthAmount,
              type: "government",
            });
          }

          const pagibigAmount = applyGovSetting(
            govSettings?.pagibig.enabled,
            govSettings?.pagibig.frequency,
            payroll.deductions?.pagibig,
          );
          if (pagibigAmount > 0) {
            deductions.push({
              name: "Pag-IBIG",
              amount: pagibigAmount,
              type: "government",
            });
          }
        }

        const taxAmount =
          govSettings && govSettings.tax.enabled === false
            ? 0
            : payroll.deductions?.withholdingTax || 0;
        if (taxAmount > 0) {
          deductions.push({
            name: "Withholding Tax",
            amount: taxAmount,
            type: "government",
          });
        }
        if (payroll.deductions?.custom && payroll.deductions.custom > 0) {
          deductions.push({
            name: "Other Deductions",
            amount: payroll.deductions.custom,
            type: "custom",
          });
        }

        // Add manual/custom deductions entered in the UI for preview purposes
        const empDeductions = employeeDeductions.find(
          (ed) => ed.employeeId === employeeId,
        );
        if (empDeductions) {
          deductions.push(...empDeductions.deductions);
        }

        // Apply amount overrides from Edit deductions (e.g. SSS, PhilHealth, Pag-IBIG)
        const overrides = previewDeductionOverrides[employeeId];
        if (overrides) {
          for (const d of deductions) {
            if (overrides[d.name] !== undefined) {
              d.amount = overrides[d.name];
            }
          }
        }

        const manualIncentives =
          employeeIncentives.find((ei) => ei.employeeId === employeeId)
            ?.incentives || [];
        const totalIncentives = manualIncentives.reduce(
          (sum, incentive) => sum + incentive.amount,
          0,
        );
        const incentives = manualIncentives;

        // Non-taxable allowance follows the organization's pay frequency
        const allowance = employee.compensation.allowance || 0;
        const payDivisor =
          currentOrganization?.salaryPaymentFrequency === "monthly" ? 1 : 2;
        const nonTaxableAllowance = allowance / payDivisor;

        // Daily rate formula from settings: (basic + allowance?) × 12/workingDaysPerYear (matches backend)
        const dailyRateIncludesAllowance =
          settings?.payrollSettings?.dailyRateIncludesAllowance ?? true;
        const dailyRateWorkingDaysPerYear =
          settings?.payrollSettings?.dailyRateWorkingDaysPerYear ?? 261;

        // Calculate basic pay based on actual attendance
        const salaryType = employee.compensation.salaryType || "monthly";
        const monthlySalary = employee.compensation.basicSalary || 0;
        const daysWorked = payroll.daysWorked || 0;
        const absences = payroll.absences || 0;
        const lateHours = payroll.lateHours || 0;
        const undertimeHours = payroll.undertimeHours || 0;

        let fullBasicPay = payroll.basicPay || 0;
        let dailyRate = 0;
        let hourlyRate = 0;
        let basicDailyRate = 0;
        let basicHourlyRate = 0;

        if (salaryType === "monthly") {
          fullBasicPay = monthlySalary / payDivisor;
          // Daily rate = (basic + allowance?) × 12/261 (matches backend)
          const monthlyBase =
            monthlySalary + (dailyRateIncludesAllowance ? allowance : 0);
          dailyRate = monthlyBase * (12 / dailyRateWorkingDaysPerYear);
          hourlyRate = dailyRate / 8;
          basicDailyRate = monthlySalary * (12 / dailyRateWorkingDaysPerYear);
          basicHourlyRate = basicDailyRate / 8;
        } else if (salaryType === "daily") {
          dailyRate = monthlySalary;
          hourlyRate = dailyRate / 8;
          basicDailyRate = dailyRate;
          basicHourlyRate = hourlyRate;
        } else if (salaryType === "hourly") {
          dailyRate = monthlySalary * 8;
          hourlyRate = monthlySalary;
          basicDailyRate = dailyRate;
          basicHourlyRate = hourlyRate;
        }

        // Absence always uses (basic + allowance) × 12/261
        const dailyRateForAbsence =
          salaryType === "monthly"
            ? (monthlySalary + (allowance ?? 0)) *
              (12 / dailyRateWorkingDaysPerYear)
            : basicDailyRate;
        const hourlyRateBasicPlusAllowance =
          salaryType === "monthly"
            ? ((monthlySalary + (allowance ?? 0)) *
                (12 / dailyRateWorkingDaysPerYear)) /
              8
            : hourlyRate;

        // Use backend-calculated attendance deductions (categorized late) when available
        const calculatedAbsences = absences;
        const lateDeduction =
          (payroll as any).lateDeduction ??
          lateHours * hourlyRateBasicPlusAllowance;
        const lateDeductionRegularDay =
          (payroll as any).lateDeductionRegularDay ?? 0;
        const lateDeductionRegularHoliday =
          (payroll as any).lateDeductionRegularHoliday ?? 0;
        const lateDeductionSpecialHoliday =
          (payroll as any).lateDeductionSpecialHoliday ?? 0;
        const undertimeDeduction =
          (payroll as any).undertimeDeduction ??
          undertimeHours * hourlyRateBasicPlusAllowance;
        const absentDeduction =
          (payroll as any).absentDeduction ??
          (salaryType === "monthly"
            ? calculatedAbsences * dailyRateForAbsence
            : 0);

        // Total deductions = government + custom + attendance deductions
        const governmentAndCustomDeductions =
          deductions.reduce((sum, d) => sum + d.amount, 0) || 0;
        const rawTotalDeductions =
          governmentAndCustomDeductions +
          lateDeduction +
          undertimeDeduction +
          absentDeduction;

        const grossPay =
          (payroll.grossPay || 0) -
          (payroll.incentiveTotal || 0) +
          totalIncentives;

        // Apply same rule as backend: deductions should not exceed available earnings
        // availableEarnings = gross pay + non-taxable allowance
        const availableEarnings = grossPay + nonTaxableAllowance;
        const totalDeductions = Math.min(
          rawTotalDeductions,
          Math.max(0, availableEarnings),
        );

        // Net pay cannot go below 0 in preview
        const netPay = Math.max(0, availableEarnings - totalDeductions);

        preview.push({
          employee,
          payroll,
          basicPay: fullBasicPay, // Show full basic pay (₱5,000 for bi-monthly)
          daysWorked,
          absences: calculatedAbsences, // Use calculated absences (working days - days worked)
          lateHours,
          undertimeHours,
          overtimeHours: payroll.overtimeHours || 0,
          holidayPay: payroll.holidayPay || 0,
          holidayPayType: payroll.holidayPayType,
          restDayPay: payroll.restDayPay || 0,
          nightDiffPay: payroll.nightDiffPay || 0,
          nightDiffBreakdown: payroll.nightDiffBreakdown,
          overtimeRegular: payroll.overtimeRegular || 0,
          overtimeRestDay: payroll.overtimeRestDay || 0,
          overtimeRestDayExcess: payroll.overtimeRestDayExcess || 0,
          overtimeSpecialHoliday: payroll.overtimeSpecialHoliday || 0,
          overtimeSpecialHolidayExcess:
            payroll.overtimeSpecialHolidayExcess || 0,
          overtimeLegalHoliday: payroll.overtimeLegalHoliday || 0,
          overtimeLegalHolidayExcess: payroll.overtimeLegalHolidayExcess || 0,
          lateDeduction,
          lateDeductionRegularDay,
          lateDeductionRegularHoliday,
          lateDeductionSpecialHoliday,
          undertimeDeduction,
          absentDeduction,
          incentives,
          totalIncentives,
          nonTaxableAllowance,
          deductions,
          totalDeductions,
          grossPay,
          netPay,
        });
      }
      setPreviewData(preview);
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
      const preview: any[] = [];

      for (const employeeId of editSelectedEmployees) {
        const employee = employees?.find((e: any) => e._id === employeeId);
        if (!employee) continue;

        const cutoffStartTs = dateStringToLocalMs(editCutoffStart);
        const cutoffEndTs = dateStringToLocalMs(editCutoffEnd);

        const payroll = await computeEmployeePayroll({
          employeeId,
          cutoffStart: cutoffStartTs,
          cutoffEnd: cutoffEndTs,
        });

        const deductions: Deduction[] = [];
        const govSettings = editGovernmentDeductionSettings.find(
          (gs) => gs.employeeId === employeeId,
        );

        const applyGovSetting = (
          enabled: boolean | undefined,
          frequency: "full" | "half" | undefined,
          baseAmount: number | undefined,
        ): number => {
          if (!baseAmount || baseAmount <= 0) return 0;
          if (enabled === false) return 0;
          if (frequency === "half") return baseAmount / 2;
          return baseAmount;
        };

        // SSS, PhilHealth, Pag-IBIG only when editDeductionsEnabled; withholding tax follows org settings independently
        if (editDeductionsEnabled) {
          const sssAmount = applyGovSetting(
            govSettings?.sss.enabled,
            govSettings?.sss.frequency,
            payroll.deductions?.sss,
          );
          if (sssAmount > 0)
            deductions.push({
              name: "SSS",
              amount: sssAmount,
              type: "government",
            });

          const philhealthAmount = applyGovSetting(
            govSettings?.philhealth.enabled,
            govSettings?.philhealth.frequency,
            payroll.deductions?.philhealth,
          );
          if (philhealthAmount > 0)
            deductions.push({
              name: "PhilHealth",
              amount: philhealthAmount,
              type: "government",
            });

          const pagibigAmount = applyGovSetting(
            govSettings?.pagibig.enabled,
            govSettings?.pagibig.frequency,
            payroll.deductions?.pagibig,
          );
          if (pagibigAmount > 0)
            deductions.push({
              name: "Pag-IBIG",
              amount: pagibigAmount,
              type: "government",
            });
        }

        const taxAmount =
          govSettings && govSettings.tax.enabled === false
            ? 0
            : payroll.deductions?.withholdingTax || 0;
        if (taxAmount > 0)
          deductions.push({
            name: "Withholding Tax",
            amount: taxAmount,
            type: "government",
          });
        if (payroll.deductions?.custom && payroll.deductions.custom > 0)
          deductions.push({
            name: "Other Deductions",
            amount: payroll.deductions.custom,
            type: "custom",
          });

        const empDeductions = editEmployeeDeductions.find(
          (ed) => ed.employeeId === employeeId,
        );
        if (empDeductions) deductions.push(...empDeductions.deductions);

        const overrides = editPreviewDeductionOverrides[employeeId];
        if (overrides) {
          for (const d of deductions) {
            if (overrides[d.name] !== undefined) d.amount = overrides[d.name];
          }
        }

        const manualIncentives =
          editEmployeeIncentives.find((ei) => ei.employeeId === employeeId)
            ?.incentives || [];
        const totalIncentives = manualIncentives.reduce(
          (sum, incentive) => sum + incentive.amount,
          0,
        );
        const incentives = manualIncentives;

        const allowance = employee.compensation.allowance || 0;
        const payDivisor =
          currentOrganization?.salaryPaymentFrequency === "monthly" ? 1 : 2;
        const nonTaxableAllowance = allowance / payDivisor;

        const dailyRateIncludesAllowance =
          settings?.payrollSettings?.dailyRateIncludesAllowance ?? true;
        const dailyRateWorkingDaysPerYear =
          settings?.payrollSettings?.dailyRateWorkingDaysPerYear ?? 261;

        const salaryType = employee.compensation.salaryType || "monthly";
        const monthlySalary = employee.compensation.basicSalary || 0;
        const daysWorked = payroll.daysWorked || 0;
        const absences = payroll.absences || 0;
        const lateHours = payroll.lateHours || 0;
        const undertimeHours = payroll.undertimeHours || 0;

        let fullBasicPay = payroll.basicPay || 0;
        let dailyRate = 0;
        let hourlyRate = 0;
        let basicDailyRate = 0;
        let basicHourlyRate = 0;

        if (salaryType === "monthly") {
          fullBasicPay = monthlySalary / payDivisor;
          const monthlyBase =
            monthlySalary + (dailyRateIncludesAllowance ? allowance : 0);
          dailyRate = monthlyBase * (12 / dailyRateWorkingDaysPerYear);
          hourlyRate = dailyRate / 8;
          basicDailyRate = monthlySalary * (12 / dailyRateWorkingDaysPerYear);
          basicHourlyRate = basicDailyRate / 8;
        } else if (salaryType === "daily") {
          dailyRate = monthlySalary;
          hourlyRate = dailyRate / 8;
          basicDailyRate = dailyRate;
          basicHourlyRate = hourlyRate;
        } else if (salaryType === "hourly") {
          dailyRate = monthlySalary * 8;
          hourlyRate = monthlySalary;
          basicDailyRate = dailyRate;
          basicHourlyRate = hourlyRate;
        }

        const dailyRateForAbsence =
          salaryType === "monthly"
            ? (monthlySalary + (allowance ?? 0)) *
              (12 / dailyRateWorkingDaysPerYear)
            : basicDailyRate;
        const hourlyRateBasicPlusAllowance =
          salaryType === "monthly"
            ? ((monthlySalary + (allowance ?? 0)) *
                (12 / dailyRateWorkingDaysPerYear)) /
              8
            : hourlyRate;

        const calculatedAbsences = absences;
        const lateDeduction =
          (payroll as any).lateDeduction ??
          lateHours * hourlyRateBasicPlusAllowance;
        const lateDeductionRegularDay =
          (payroll as any).lateDeductionRegularDay ?? 0;
        const lateDeductionRegularHoliday =
          (payroll as any).lateDeductionRegularHoliday ?? 0;
        const lateDeductionSpecialHoliday =
          (payroll as any).lateDeductionSpecialHoliday ?? 0;
        const undertimeDeduction =
          (payroll as any).undertimeDeduction ??
          undertimeHours * hourlyRateBasicPlusAllowance;
        const absentDeduction =
          (payroll as any).absentDeduction ??
          (salaryType === "monthly"
            ? calculatedAbsences * dailyRateForAbsence
            : 0);

        const governmentAndCustomDeductions =
          deductions.reduce((sum, d) => sum + d.amount, 0) || 0;
        const rawTotalDeductions =
          governmentAndCustomDeductions +
          lateDeduction +
          undertimeDeduction +
          absentDeduction;

        const grossPay =
          (payroll.grossPay || 0) -
          (payroll.incentiveTotal || 0) +
          totalIncentives;

        const availableEarnings = grossPay + nonTaxableAllowance;
        const totalDeductions = Math.min(
          rawTotalDeductions,
          Math.max(0, availableEarnings),
        );
        const netPay = Math.max(0, availableEarnings - totalDeductions);

        preview.push({
          employee,
          payroll,
          basicPay: fullBasicPay,
          daysWorked,
          absences: calculatedAbsences,
          lateHours,
          undertimeHours,
          overtimeHours: payroll.overtimeHours || 0,
          holidayPay: payroll.holidayPay || 0,
          holidayPayType: payroll.holidayPayType,
          restDayPay: payroll.restDayPay || 0,
          nightDiffPay: payroll.nightDiffPay || 0,
          nightDiffBreakdown: payroll.nightDiffBreakdown,
          overtimeRegular: payroll.overtimeRegular || 0,
          overtimeRestDay: payroll.overtimeRestDay || 0,
          overtimeRestDayExcess: payroll.overtimeRestDayExcess || 0,
          overtimeSpecialHoliday: payroll.overtimeSpecialHoliday || 0,
          overtimeSpecialHolidayExcess:
            payroll.overtimeSpecialHolidayExcess || 0,
          overtimeLegalHoliday: payroll.overtimeLegalHoliday || 0,
          overtimeLegalHolidayExcess: payroll.overtimeLegalHolidayExcess || 0,
          lateDeduction,
          lateDeductionRegularDay,
          lateDeductionRegularHoliday,
          lateDeductionSpecialHoliday,
          undertimeDeduction,
          absentDeduction,
          incentives,
          totalIncentives,
          nonTaxableAllowance,
          deductions,
          totalDeductions,
          grossPay,
          netPay,
        });
      }
      setEditPreviewData(preview);
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
          const deductions = [
            ...(p.deductions || []).map((d: any) => ({
              name: d.name,
              amount: d.amount,
              type: d.type || "government",
            })),
            ...(p.absentDeduction > 0
              ? [
                  (() => {
                    const noWorkDays = p.noWorkNoPayDays || 0;
                    const absentDays = Math.max(0, (p.absences || 0) - noWorkDays);
                    const label =
                      noWorkDays > 0 && absentDays === 0
                        ? `No work on a holiday (${p.absences || 0} ${(p.absences || 0) === 1 ? "day" : "days"})`
                        : `Absent (${p.absences || 0} ${(p.absences || 0) === 1 ? "day" : "days"})`;
                    return {
                      name: label,
                      amount: p.absentDeduction,
                      type: "attendance",
                    };
                  })(),
                ]
              : []),
            ...(p.lateDeductionSpecialHoliday > 0
              ? [
                  {
                    name: "Special Holiday Late",
                    amount: p.lateDeductionSpecialHoliday,
                    type: "attendance",
                  },
                ]
              : []),
            ...(p.lateDeductionRegularHoliday > 0
              ? [
                  {
                    name: "Regular Holiday Late",
                    amount: p.lateDeductionRegularHoliday,
                    type: "attendance",
                  },
                ]
              : []),
            ...((p.lateDeductionRegularDay ?? 0) > 0
              ? [
                  {
                    name:
                      (p.lateDeductionSpecialHoliday > 0 ||
                        p.lateDeductionRegularHoliday > 0)
                        ? "Regular day late"
                        : "Late",
                    amount: p.lateDeductionRegularDay,
                    type: "attendance",
                  },
                ]
              : []),
            ...(p.lateDeduction > 0 &&
            !p.lateDeductionSpecialHoliday &&
            !p.lateDeductionRegularHoliday &&
            !p.lateDeductionRegularDay
              ? [
                  {
                    name: "Late",
                    amount: p.lateDeduction,
                    type: "attendance",
                  },
                ]
              : []),
            ...(p.undertimeDeduction > 0
              ? [
                  {
                    name: "Undertime",
                    amount: p.undertimeDeduction,
                    type: "attendance",
                  },
                ]
              : []),
          ];
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
          return { employeeId, incentives: saved?.incentives ?? [] };
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
      const manualDeductions = editEmployeeDeductions.filter(
        (ed) => ed.deductions.length > 0,
      );
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
                <MonthPicker
                  value={filterMonth}
                  onChange={setFilterMonth}
                  className="min-w-[220px]"
                  triggerClassName="w-full sm:w-[220px]"
                />
              </CardHeader>
              <CardContent>
                <PayrollRunsTable
                  payrollRuns={paginatedPayrollRuns || []}
                  isLoading={!payrollRunsInitialReady}
                  onViewSummary={handleViewSummary}
                  onViewPayslips={handleViewPayslips}
                  onEdit={handleEditPayrollRun}
                  onRegeneratePayslips={handleRegeneratePayslips}
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
              payslipConcerns={payslipConcerns}
              currentOrganization={currentOrganization}
              isAdminOrAccounting={isAdminOrAccounting}
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
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Run</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this payroll run? This action
                will permanently remove the payroll run, associated payslips,
                and cost records. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {payrollRunToDelete && (
              <div className="py-4">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Period:</span>{" "}
                  {payrollRunToDelete.period}
                </p>
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Status:</span>{" "}
                  {payrollRunToDelete.status}
                </p>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsDeleteDialogOpen(false);
                  setPayrollRunToDelete(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDeletePayrollRun}>
                Delete
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
