"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  X,
  RotateCcw,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { EmployeeSelect } from "@/components/ui/employee-select";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import {
  calculateLate,
  calculateUndertime,
} from "@/utils/attendance-calculations";
import {
  holidayAppliesToEmployee,
  holidayMatchesDate,
  isEmployeeRestDay,
} from "@/lib/payroll-calculations";
import {
  normalizeAttendanceDateMs,
  parseYmdToAttendanceDateMs,
} from "@/lib/manila-date";
import {
  transformAttendanceImport,
  validateAttendanceImportFile,
} from "@/lib/attendance-import/client";
import {
  applyAttendanceImportConflicts,
  buildAttendanceImportPreviewWhenReady,
  getAttendanceImportRowIdentities,
  reconcileAttendanceImportPreviewState,
  type AttendanceImportPreviewRow,
  type AttendanceImportRowDecisions,
} from "@/lib/attendance-import/preview";
import type {
  AttendanceImportStatus,
  NormalizedAttendanceCandidate,
} from "@/lib/attendance-import/types";
import {
  areAttendanceImportLookupsReady,
  AttendanceImportRequestCoordinator,
  handleAttendanceDialogOpenChange,
  isAttendanceConflictCheckPending,
  runLatestAttendanceImportRequest,
} from "@/lib/attendance-import/lifecycle";
import {
  getPayrollCorrectionRequirement,
  type AttendancePayrollLockedEntry,
  type AttendancePayrollReviewRow,
  type PayrollCorrectionRequirement,
} from "@/lib/attendance-import/payroll-correction";
import { AttendanceImportFileControls } from "./attendance-import-file-controls";

function formatHHmmTo12h(hhmm: string | undefined): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm ?? "—";
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr!, 10);
  const m = parseInt(mStr!, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m.toString().padStart(2, "0")} ${period}`;
}

const CSV_TEMPLATE =
  "Employee,Date,Time In,Time Out,Status,Notes\n\"Jane Doe\",2025-01-15,9:00 AM,5:00 PM,present,\n\"John Smith\",2025-01-15,8:30 AM,5:30 PM,present,Left early\n";

type ManualAttendanceStatus = Exclude<AttendanceImportStatus, "half-day">;

interface BulkDayTime {
  timeIn: string;
  timeOut: string;
  status: ManualAttendanceStatus;
  overtime: string;
  late: string;
  undertime: string;
  notes: string;
  useManualOvertime?: boolean;
  useManualLate?: boolean;
  useManualUndertime?: boolean;
}

type AttendanceBatchEntry = {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  date: number;
  scheduleIn: string;
  scheduleOut: string;
  actualIn?: string;
  actualOut?: string;
  overtime?: number;
  late?: number;
  undertime?: number;
  remarks?: string;
  status:
    | "present"
    | "absent"
    | "leave"
    | "leave_with_pay"
    | "leave_without_pay"
    | "no_work";
  overwriteAttendanceId?: Id<"attendance">;
};

interface AttendanceBatchReview {
  conflicts: Doc<"attendance">[];
  lockedEntries: AttendancePayrollLockedEntry[];
  canCorrectWithReason: boolean;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function getDayNameInManila(timestamp: number): (typeof DAY_NAMES)[number] {
  return DAY_NAMES[new Date(timestamp + MANILA_OFFSET_MS).getUTCDay()];
}

interface BulkAddAttendanceDialogProps {
  employees: Doc<"employees">[] | undefined;
  currentOrganizationId: string | null;
  onSuccess?: () => void;
}

export function BulkAddAttendanceDialog({
  employees,
  currentOrganizationId,
  onSuccess,
}: BulkAddAttendanceDialogProps) {
  const { toast } = useToast();
  const bulkCreateMutation = useMutation(api.attendance.bulkCreateAttendance);
  const holidays = useQuery(
    api.holidays.getHolidays,
    currentOrganizationId
      ? { organizationId: currentOrganizationId as Id<"organizations"> }
      : "skip",
  ) as Doc<"holidays">[] | undefined;

  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [bulkEndDate, setBulkEndDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [bulkSelectedEmployee, setBulkSelectedEmployee] = useState("");
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  /** Rest days the user explicitly restored from excluded (manual bulk). */
  const manuallyIncludedRestDaysRef = useRef<Set<number>>(new Set());
  // Map of date timestamp to { timeIn, timeOut, status, overtime, late, undertime, notes, useManualOvertime, useManualLate, useManualUndertime }
  const [bulkDayTimes, setBulkDayTimes] = useState<Record<number, BulkDayTime>>(
    {},
  );
  // Set of excluded date timestamps
  const [excludedDates, setExcludedDates] = useState<Set<number>>(new Set());

  // CSV import
  type BulkMode = "manual" | "file";
  const [bulkMode, setBulkMode] = useState<BulkMode>("manual");
  const [csvPreviewRows, setCsvPreviewRows] = useState<
    AttendanceImportPreviewRow[]
  >([]);
  const [importCandidates, setImportCandidates] = useState<
    NormalizedAttendanceCandidate[] | null
  >(null);
  const [importRowDecisions, setImportRowDecisions] =
    useState<AttendanceImportRowDecisions>({});
  const [bulkConflictResolutions, setBulkConflictResolutions] = useState<
    Record<number, "overwrite" | "exclude">
  >({});
  const [csvParseError, setCsvParseError] = useState<string | null>(null);
  const [isTransformingImport, setIsTransformingImport] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const importRequestCoordinatorRef = useRef(
    new AttendanceImportRequestCoordinator(),
  );
  const importRunIdRef = useRef<string | null>(null);
  const conflictLookupGenerationRef = useRef(0);
  const manualReviewGenerationRef = useRef(0);
  const [csvBatchReview, setCsvBatchReview] = useState<
    AttendanceBatchReview | undefined
  >(undefined);
  const [manualBatchReview, setManualBatchReview] = useState<
    AttendanceBatchReview | undefined
  >(undefined);
  const [manualReviewError, setManualReviewError] = useState<string | null>(
    null,
  );
  const getAttendanceImportReview = useAction(
    api.attendance.getAttendanceImportReview,
  );
  const importLookupsReady = areAttendanceImportLookupsReady(
    employees,
    holidays,
  );

  const invalidateImportRequest = useCallback(() => {
    importRequestCoordinatorRef.current.invalidate();
    setIsTransformingImport(false);
  }, []);

  const resetImportPreview = useCallback(() => {
    importRunIdRef.current = null;
    setImportCandidates(null);
    setImportRowDecisions({});
    setCsvPreviewRows([]);
    setCsvBatchReview(undefined);
    setCsvParseError(null);
    setCorrectionReason("");
  }, []);

  const invalidateAndResetImport = useCallback(() => {
    invalidateImportRequest();
    resetImportPreview();
  }, [invalidateImportRequest, resetImportPreview]);

  useEffect(() => {
    invalidateAndResetImport();
  }, [currentOrganizationId, invalidateAndResetImport]);

  useEffect(
    () => () => {
      importRequestCoordinatorRef.current.invalidate();
    },
    [],
  );

  const canUseNoWorkForDate = (
    dateTs: number,
    employee: Doc<"employees">,
  ): boolean =>
    holidays?.some(
      (holiday) =>
        (holiday.type === "regular" || holiday.type === "special") &&
        holidayMatchesDate(holiday, dateTs) &&
        holidayAppliesToEmployee(holiday, employee),
    ) ?? false;

  // Generate list of all dates that could be included (before filtering excluded ones)
  const getAllBulkDates = useCallback(() => {
    if (!bulkSelectedEmployee || !bulkStartDate || !bulkEndDate) return [];

    const employee = employees?.find(
      (employee) => employee._id === bulkSelectedEmployee,
    );
    if (!employee) return [];

    const startDate = new Date(bulkStartDate);
    const endDate = new Date(bulkEndDate);
    const dates: Array<{ date: Date; timestamp: number; dayName: string }> = [];

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const ts = normalizeAttendanceDateMs(currentDate.getTime());
      // Use Manila day so per-day schedule matches backend
      const dayName = getDayNameInManila(ts);
      dates.push({
        date: new Date(currentDate),
        timestamp: ts,
        dayName,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }, [bulkEndDate, bulkSelectedEmployee, bulkStartDate, employees]);

  // Get filtered dates (excluding removed ones)
  const getBulkDates = useCallback(() => {
    return getAllBulkDates().filter(
      (dateInfo) => !excludedDates.has(dateInfo.timestamp),
    );
  }, [excludedDates, getAllBulkDates]);

  const bulkRangeBounds = useMemo(() => {
    if (!bulkStartDate || !bulkEndDate) return null;
    try {
      const start = parseYmdToAttendanceDateMs(bulkStartDate);
      const end = parseYmdToAttendanceDateMs(bulkEndDate);
      return { start, end };
    } catch {
      return null;
    }
  }, [bulkStartDate, bulkEndDate]);

  const employeeRangeAttendance = useQuery(
    api.attendance.getEmployeeAttendance,
    bulkSelectedEmployee && bulkRangeBounds
      ? {
          employeeId: bulkSelectedEmployee as Id<"employees">,
          startDate: bulkRangeBounds.start - 86400000,
          endDate: bulkRangeBounds.end + 86400000 * 2,
        }
      : "skip",
  );

  const existingAttendanceByDay = useMemo(() => {
    const map = new Map<number, Id<"attendance">>();
    if (!employeeRangeAttendance) return map;
    for (const record of employeeRangeAttendance) {
      const dayKey = normalizeAttendanceDateMs(record.date);
      if (!map.has(dayKey)) {
        map.set(dayKey, record._id);
      }
    }
    return map;
  }, [employeeRangeAttendance]);

  const manualPayrollReviewRows = useMemo<AttendancePayrollReviewRow[]>(() => {
    if (!bulkSelectedEmployee) return [];

    return getBulkDates().map((dateInfo) => ({
      employeeId: bulkSelectedEmployee as Id<"employees">,
      date: dateInfo.timestamp,
      included:
        bulkConflictResolutions[dateInfo.timestamp] !== "exclude",
    }));
  }, [bulkConflictResolutions, bulkSelectedEmployee, getBulkDates]);

  useEffect(() => {
    const generation = ++manualReviewGenerationRef.current;
    if (
      !isBulkDialogOpen ||
      bulkMode !== "manual" ||
      !currentOrganizationId
    ) {
      setManualBatchReview(undefined);
      setManualReviewError(null);
      return;
    }

    if (manualPayrollReviewRows.length === 0) {
      setManualBatchReview({
        conflicts: [],
        lockedEntries: [],
        canCorrectWithReason: false,
      });
      setManualReviewError(null);
      return;
    }

    setManualBatchReview(undefined);
    setManualReviewError(null);
    void getAttendanceImportReview({
      organizationId: currentOrganizationId as Id<"organizations">,
      entries: manualPayrollReviewRows.map(({ employeeId, date }) => ({
        employeeId,
        date,
      })),
    })
      .then((review) => {
        if (manualReviewGenerationRef.current === generation) {
          setManualBatchReview(review);
        }
      })
      .catch((error: unknown) => {
        if (manualReviewGenerationRef.current === generation) {
          setManualReviewError(
            error instanceof Error
              ? error.message
              : "Could not review finalized payroll periods.",
          );
        }
      });
  }, [
    bulkMode,
    currentOrganizationId,
    getAttendanceImportReview,
    isBulkDialogOpen,
    manualPayrollReviewRows,
  ]);

  const csvBasePreview = useMemo(
    () =>
      importCandidates === null
        ? undefined
        : buildAttendanceImportPreviewWhenReady(
            importCandidates,
            employees,
            holidays,
          ),
    [employees, holidays, importCandidates],
  );

  useEffect(() => {
    const generation = ++conflictLookupGenerationRef.current;
    if (!currentOrganizationId || csvBasePreview === undefined) {
      setCsvBatchReview(undefined);
      return;
    }
    const entries = csvBasePreview
      .filter((row) => row.employeeId && row.dateTs > 0)
      .map((row) => ({
        employeeId: row.employeeId as Id<"employees">,
        date: row.dateTs,
      }));
    if (entries.length === 0) {
      setCsvBatchReview({
        conflicts: [],
        lockedEntries: [],
        canCorrectWithReason: false,
      });
      return;
    }

    setCsvBatchReview(undefined);
    void getAttendanceImportReview({
      organizationId: currentOrganizationId as Id<"organizations">,
      entries,
    })
      .then((review) => {
        if (conflictLookupGenerationRef.current === generation) {
          setCsvBatchReview(review);
        }
      })
      .catch((error: unknown) => {
        if (conflictLookupGenerationRef.current === generation) {
          setCsvParseError(
            error instanceof Error
              ? error.message
              : "Could not check existing attendance.",
          );
        }
      });
  }, [csvBasePreview, currentOrganizationId, getAttendanceImportReview]);

  useEffect(() => {
    if (csvBasePreview === undefined) {
      return;
    }

    const reconciliation = reconcileAttendanceImportPreviewState(
      applyAttendanceImportConflicts(csvBasePreview, csvBatchReview?.conflicts),
      importRowDecisions,
      csvBatchReview !== undefined,
    );
    setCsvPreviewRows(reconciliation.rows);

    if (reconciliation.decisions !== importRowDecisions) {
      setImportRowDecisions(reconciliation.decisions);
    }
  }, [
    csvBasePreview,
    importRowDecisions,
    csvBatchReview,
  ]);

  useEffect(() => {
    setBulkConflictResolutions({});
  }, [bulkSelectedEmployee, bulkStartDate, bulkEndDate]);

  useEffect(() => {
    setCorrectionReason("");
  }, [bulkSelectedEmployee, bulkStartDate, bulkEndDate]);

  useEffect(() => {
    manuallyIncludedRestDaysRef.current = new Set();
  }, [bulkSelectedEmployee]);

  const getExistingIdForDay = useCallback(
    (dateTs: number): Id<"attendance"> | null => {
      const dayKey = normalizeAttendanceDateMs(dateTs);
      return existingAttendanceByDay.get(dayKey) ?? null;
    },
    [existingAttendanceByDay],
  );

  const isManualConflictResolved = useCallback(
    (dateTs: number): boolean => {
      const existingId = getExistingIdForDay(dateTs);
      if (!existingId) return true;
      const resolution = bulkConflictResolutions[dateTs];
      return resolution === "overwrite" || resolution === "exclude";
    },
    [bulkConflictResolutions, getExistingIdForDay],
  );

  const manualUnresolvedConflictCount = useMemo(() => {
    if (!bulkSelectedEmployee) return 0;
    return getBulkDates().filter(
      (d) => getExistingIdForDay(d.timestamp) && !isManualConflictResolved(d.timestamp),
    ).length;
  }, [
    bulkSelectedEmployee,
    getBulkDates,
    getExistingIdForDay,
    isManualConflictResolved,
  ]);

  const csvUnresolvedConflictCount = useMemo(() => {
    return csvPreviewRows.filter(
      (r) =>
        r.employeeId &&
        !r.error &&
        r.dateTs > 0 &&
        r.includeInImport &&
        r.existingAttendanceId &&
        !r.overwriteExisting,
    ).length;
  }, [csvPreviewRows]);
  const csvRowIdentities = useMemo(
    () => getAttendanceImportRowIdentities(csvPreviewRows),
    [csvPreviewRows],
  );

  const csvImportableRowCount = useMemo(
    () =>
      csvPreviewRows.filter(
        (row) =>
          row.employeeId &&
          !row.error &&
          row.dateTs > 0 &&
          row.includeInImport,
      ).length,
    [csvPreviewRows],
  );
  const csvPayrollReviewRows = useMemo<AttendancePayrollReviewRow[]>(
    () =>
      csvPreviewRows
        .filter(
          (row) => row.employeeId && !row.error && row.dateTs > 0,
        )
        .map((row) => ({
          employeeId: row.employeeId as Id<"employees">,
          date: row.dateTs,
          included: row.includeInImport,
        })),
    [csvPreviewRows],
  );
  const isCheckingImportConflicts = isAttendanceConflictCheckPending(
    csvImportableRowCount > 0,
    csvBatchReview?.conflicts,
  );
  const isCheckingManualPayrollLocks =
    manualPayrollReviewRows.some((row) => row.included) &&
    manualBatchReview === undefined &&
    manualReviewError === null;
  const csvPayrollCorrectionRequirement = getPayrollCorrectionRequirement(
    csvPayrollReviewRows,
    csvBatchReview?.lockedEntries ?? [],
    csvBatchReview?.canCorrectWithReason ?? false,
  );
  const manualPayrollCorrectionRequirement = getPayrollCorrectionRequirement(
    manualPayrollReviewRows,
    manualBatchReview?.lockedEntries ?? [],
    manualBatchReview?.canCorrectWithReason ?? false,
  );
  const payrollCorrectionRequirement: PayrollCorrectionRequirement =
    bulkMode === "file"
      ? csvPayrollCorrectionRequirement
      : manualPayrollCorrectionRequirement;

  const handleCSVFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    invalidateAndResetImport();
    if (!file || !currentOrganizationId || !importLookupsReady) return;

    try {
      validateAttendanceImportFile(file);
    } catch (error: unknown) {
      setCsvParseError(
        error instanceof Error
          ? error.message
          : "The attendance file could not be transformed.",
      );
      return;
    }

    await runLatestAttendanceImportRequest(
      importRequestCoordinatorRef.current,
      (signal) =>
        transformAttendanceImport(
          file,
          currentOrganizationId,
          fetch,
          signal,
        ),
      {
        onStart: () => setIsTransformingImport(true),
        onSuccess: setImportCandidates,
        onError: (error) =>
          setCsvParseError(
            error instanceof Error
              ? error.message
              : "The attendance file could not be transformed.",
          ),
        onFinish: () => setIsTransformingImport(false),
      },
    );
  };

  const handleCSVImport = async () => {
    if (!currentOrganizationId) return;
    if (isCheckingImportConflicts) {
      toast({
        title: "Checking existing attendance",
        description:
          "Wait for the attendance conflict check to finish before importing.",
        variant: "destructive",
      });
      return;
    }

    if (csvPayrollCorrectionRequirement === "blocked") {
      toast({
        title: "Finalized payroll cannot be changed",
        description:
          "Remove the locked rows from this import or ask an owner or admin to submit the correction.",
        variant: "destructive",
      });
      return;
    }

    if (
      csvPayrollCorrectionRequirement === "reason-required" &&
      !correctionReason.trim()
    ) {
      toast({
        title: "Correction reason required",
        description:
          "Provide a reason before changing attendance included in finalized payroll.",
        variant: "destructive",
      });
      return;
    }

    if (csvUnresolvedConflictCount > 0) {
      toast({
        title: "Resolve conflicts first",
        description:
          "Some rows already have attendance. Choose Overwrite on each conflict or uncheck Include.",
        variant: "destructive",
      });
      return;
    }

    const valid = csvPreviewRows.filter(
      (r) => r.employeeId && !r.error && r.dateTs > 0,
    );
    const toImport = valid.filter((r) => r.includeInImport);
    if (toImport.length === 0) {
      toast({
        title: "Nothing to import",
        description: "Fix file errors, or check Include for rows you want to import.",
        variant: "destructive",
      });
      return;
    }
    setIsImportingCsv(true);
    try {
      const importRunId = importRunIdRef.current ?? crypto.randomUUID();
      importRunIdRef.current = importRunId;
      const entries = toImport.map((r, index) => ({
        organizationId: currentOrganizationId as Id<"organizations">,
        employeeId: r.employeeId as Id<"employees">,
        date: r.dateTs,
        scheduleIn: r.scheduleIn,
        scheduleOut: r.scheduleOut,
        actualIn: r.actualIn,
        actualOut: r.actualOut,
        status: r.status,
        remarks: r.notes || undefined,
        importKey: `${importRunId}:${r.sourceSheet}:${r.sourceRow}:${index}`,
        overwriteAttendanceId:
          r.overwriteExisting && r.existingAttendanceId
            ? r.existingAttendanceId
            : undefined,
      }));
      const batchSize = 100;
      for (let offset = 0; offset < entries.length; offset += batchSize) {
        await bulkCreateMutation({
          entries: entries.slice(offset, offset + batchSize),
          correctionReason: correctionReason.trim() || undefined,
        });
      }
      setIsBulkDialogOpen(false);
      setBulkMode("manual");
      invalidateAndResetImport();
      setCorrectionReason("");
      toast({
        title: "Import complete",
        description: `Imported ${entries.length} attendance record(s).`,
        variant: "default",
      });
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        title: "Import failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create attendance records.",
        variant: "destructive",
      });
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleBulkDialogOpenChange = useCallback(
    (open: boolean) =>
      handleAttendanceDialogOpenChange(
        open,
        invalidateAndResetImport,
        setIsBulkDialogOpen,
      ),
    [invalidateAndResetImport],
  );

  const downloadCSVTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "attendance-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Get excluded dates info
  const getExcludedDates = () => {
    const allDates = getAllBulkDates();
    return allDates.filter((dateInfo) => excludedDates.has(dateInfo.timestamp));
  };

  // Initialize times when dates change
  useEffect(() => {
    if (!employees || !bulkSelectedEmployee || !bulkStartDate || !bulkEndDate) {
      return;
    }

    const dates = getAllBulkDates();

    const employee = employees?.find(
      (employee) => employee._id === bulkSelectedEmployee,
    );

    setExcludedDates((prev) => {
      const dateTimestamps = new Set(dates.map((d) => d.timestamp));
      const newExcluded = new Set<number>();
      prev.forEach((timestamp) => {
        if (dateTimestamps.has(timestamp)) {
          newExcluded.add(timestamp);
        }
      });
      if (employee) {
        for (const dateInfo of dates) {
          if (
            isEmployeeRestDay(dateInfo.timestamp, employee.schedule) &&
            !manuallyIncludedRestDaysRef.current.has(dateInfo.timestamp)
          ) {
            newExcluded.add(dateInfo.timestamp);
          }
        }
      }
      return newExcluded;
    });

    // Initialize times for new dates
    setBulkDayTimes((prev) => {
      // Merge existing times with new ones, preserving user input
      const merged = { ...prev };
      const employee = employees?.find(
        (employee) => employee._id === bulkSelectedEmployee,
      );

      if (!employee) return merged;

      dates.forEach((dateInfo) => {
        const existing = merged[dateInfo.timestamp];

        // Get schedule for this day
        const daySchedule =
          employee.schedule.defaultSchedule[
            dateInfo.dayName as keyof typeof employee.schedule.defaultSchedule
          ];

        if (!existing) {
          // New date - set default schedule times if it's a workday
          const defaultTimeIn =
            daySchedule?.isWorkday && daySchedule?.in ? daySchedule.in : "";
          const defaultTimeOut =
            daySchedule?.isWorkday && daySchedule?.out ? daySchedule.out : "";

          merged[dateInfo.timestamp] = {
            timeIn: defaultTimeIn,
            timeOut: defaultTimeOut,
            status: "present",
            overtime: "",
            late: "",
            undertime: "",
            notes: "",
            useManualOvertime: false,
            useManualLate: false,
            useManualUndertime: false,
          };
        } else if (existing.status === "present" && daySchedule?.isWorkday) {
          // Existing date with present status - fill empty times with schedule
          // Only update if times are empty (don't overwrite user input)
          if (
            (!existing.timeIn && daySchedule.in) ||
            (!existing.timeOut && daySchedule.out)
          ) {
            merged[dateInfo.timestamp] = {
              ...existing,
              timeIn: existing.timeIn || daySchedule.in || "",
              timeOut: existing.timeOut || daySchedule.out || "",
            };
          }
        }
      });
      return merged;
    });
  }, [bulkEndDate, bulkSelectedEmployee, bulkStartDate, employees, getAllBulkDates]);

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !bulkSelectedEmployee) return;

    if (isCheckingManualPayrollLocks || manualReviewError) {
      toast({
        title: "Payroll review unavailable",
        description:
          manualReviewError ??
          "Wait for the finalized payroll review to finish before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (manualPayrollCorrectionRequirement === "blocked") {
      toast({
        title: "Finalized payroll cannot be changed",
        description:
          "Exclude the locked dates or ask an owner or admin to submit the correction.",
        variant: "destructive",
      });
      return;
    }

    if (
      manualPayrollCorrectionRequirement === "reason-required" &&
      !correctionReason.trim()
    ) {
      toast({
        title: "Correction reason required",
        description:
          "Provide a reason before changing attendance included in finalized payroll.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmittingBulk(true);
    try {
      const employee = employees?.find(
        (employee) => employee._id === bulkSelectedEmployee,
      );
      if (!employee) {
        toast({
          title: "Error",
          description: "Employee not found",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      const startDate = new Date(bulkStartDate);
      const endDate = new Date(bulkEndDate);

      if (startDate > endDate) {
        toast({
          title: "Error",
          description: "Start date must be before or equal to end date",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      // Generate entries for each day in the range
      const dates = getBulkDates();
      const entries: AttendanceBatchEntry[] = [];

      if (manualUnresolvedConflictCount > 0) {
        toast({
          title: "Resolve conflicts first",
          description:
            "Some dates already have attendance. Choose Overwrite or Exclude for each highlighted day.",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      for (const dateInfo of dates) {
        if (bulkConflictResolutions[dateInfo.timestamp] === "exclude") {
          continue;
        }

        const daySchedule =
          employee.schedule.defaultSchedule[
            dateInfo.dayName as keyof typeof employee.schedule.defaultSchedule
          ];
        const dayTimes = bulkDayTimes[dateInfo.timestamp];

        if (!dayTimes || !dayTimes.status) {
          toast({
            title: "Error",
            description: `Please provide status for ${format(dateInfo.date, "MMM dd, yyyy")}`,
            variant: "destructive",
          });
          setIsSubmittingBulk(false);
          return;
        }

        if (
          dayTimes.status === "no_work" &&
          !canUseNoWorkForDate(dateInfo.timestamp, employee)
        ) {
          toast({
            title: "Error",
            description: `No work is only allowed on holiday dates (${format(dateInfo.date, "MMM dd, yyyy")})`,
            variant: "destructive",
          });
          setIsSubmittingBulk(false);
          return;
        }

        // For absent or leave, times are optional
        // For present, at least one time should be provided
        if (
          dayTimes.status === "present" &&
          !dayTimes.timeIn &&
          !dayTimes.timeOut
        ) {
          toast({
            title: "Error",
            description: `Please provide at least time in or time out for ${format(dateInfo.date, "MMM dd, yyyy")} when status is present`,
            variant: "destructive",
          });
          setIsSubmittingBulk(false);
          return;
        }

        // Clear time in/out for leave types or absent
        const clearsTime =
          dayTimes.status === "leave" ||
          dayTimes.status === "leave_with_pay" ||
          dayTimes.status === "leave_without_pay" ||
          dayTimes.status === "absent" ||
          dayTimes.status === "no_work";
        const finalTimeIn = clearsTime ? undefined : dayTimes.timeIn || undefined;
        const finalTimeOut = clearsTime ? undefined : dayTimes.timeOut || undefined;

        // Calculate late and undertime if not manually provided
        const calculatedUndertimeValue =
          dayTimes.status === "present" && finalTimeIn && finalTimeOut
            ? calculateUndertime(
                daySchedule.in,
                daySchedule.out,
                finalTimeIn,
                finalTimeOut,
              )
            : 0;

        const calculatedLateValue =
          dayTimes.status === "present" && finalTimeIn
            ? calculateLate(daySchedule.in, finalTimeIn)
            : 0;

        // Overtime: user-set only (no auto-calculation)
        const finalOvertime =
          clearsTime
            ? undefined
            : dayTimes.useManualOvertime && dayTimes.overtime
              ? parseFloat(dayTimes.overtime)
              : undefined;

        // Use manual values if enabled, otherwise use calculated (late and undertime only)
        const finalLate =
          clearsTime
            ? undefined
            : dayTimes.useManualLate
              ? dayTimes.late
                ? parseFloat(dayTimes.late)
                : 0
              : calculatedLateValue > 0
                ? calculatedLateValue
                : undefined;

        // Undertime: UI stores minutes; API expects hours
        const finalUndertime =
          clearsTime
            ? undefined
            : dayTimes.useManualUndertime
              ? dayTimes.undertime
                ? parseFloat(dayTimes.undertime) / 60
                : 0
              : calculatedUndertimeValue > 0
                ? calculatedUndertimeValue
                : undefined;

        const entry: AttendanceBatchEntry = {
          organizationId: currentOrganizationId as Id<"organizations">,
          employeeId: bulkSelectedEmployee as Id<"employees">,
          date: dateInfo.timestamp,
          scheduleIn: daySchedule.in,
          scheduleOut: daySchedule.out,
          actualIn: finalTimeIn,
          actualOut: finalTimeOut,
          status: dayTimes.status as "present" | "absent" | "leave" | "leave_with_pay" | "leave_without_pay" | "no_work",
        };

        if (finalLate !== undefined) {
          entry.late = finalLate;
        }
        if (finalUndertime !== undefined) {
          entry.undertime = finalUndertime;
        }
        if (finalOvertime !== undefined) {
          entry.overtime = finalOvertime;
        }
        if (dayTimes.notes?.trim()) {
          entry.remarks = dayTimes.notes.trim();
        }

        const existingAttendanceId = getExistingIdForDay(dateInfo.timestamp);
        if (existingAttendanceId) {
          entry.overwriteAttendanceId = existingAttendanceId;
        }

        entries.push(entry);
      }

      if (entries.length === 0) {
        toast({
          title: "Error",
          description:
            "No days selected. Include workdays or restore excluded rest days to add.",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      const batchSize = 100;
      for (let offset = 0; offset < entries.length; offset += batchSize) {
        await bulkCreateMutation({
          entries: entries.slice(offset, offset + batchSize),
          correctionReason: correctionReason.trim() || undefined,
        });
      }

      setIsBulkDialogOpen(false);
      setBulkSelectedEmployee("");
      manuallyIncludedRestDaysRef.current = new Set();
      setBulkDayTimes({});
      setExcludedDates(new Set());
      setCorrectionReason("");
      toast({
        title: "Success",
        description: `Successfully created ${entries.length} attendance record(s)`,
        variant: "success",
      });
      onSuccess?.();
    } catch (error: unknown) {
      console.error("Error creating bulk attendance:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create bulk attendance records. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  return (
    <Dialog open={isBulkDialogOpen} onOpenChange={handleBulkDialogOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Bulk Add Attendance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-[min(92vw,1400px)] max-h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-5 sm:px-6 pt-5 pb-4 shrink-0 border-b border-gray-200/80">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-semibold">
                Bulk Add Attendance Records
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500 mt-1">
                {bulkMode === "manual"
                  ? "Add attendance for an employee across a date range. Workdays are included by default; scheduled rest days are excluded until you restore them."
                  : "Upload an Excel or CSV file, then review valid and flagged attendance rows before importing."}
              </DialogDescription>
            </div>
            <div className="flex rounded-lg border border-gray-200 bg-gray-50/50 p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  invalidateAndResetImport();
                  setBulkMode("manual");
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  bulkMode === "manual"
                    ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => {
                  invalidateAndResetImport();
                  setBulkMode("file");
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  bulkMode === "file"
                    ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Import Excel / CSV
              </button>
            </div>
          </div>
        </DialogHeader>
        {payrollCorrectionRequirement === "reason-required" && (
          <div className="border-b border-amber-200 bg-amber-50/70 px-5 py-3 sm:px-6">
            <Label htmlFor="bulkAttendanceCorrectionReason">
              Payroll correction reason
            </Label>
            <p className="mt-1 text-xs text-amber-800">
              One or more included dates are part of finalized payroll. Provide
              a reason for the attendance audit trail.
            </p>
            <Textarea
              id="bulkAttendanceCorrectionReason"
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              placeholder="Describe why finalized attendance is being corrected"
              disabled={isSubmittingBulk || isImportingCsv}
              rows={2}
              className="mt-2 resize-none bg-white"
            />
          </div>
        )}
        {payrollCorrectionRequirement === "blocked" && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 sm:px-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              One or more included dates are part of finalized payroll and
              cannot be changed by your role or the current attendance policy.
            </p>
          </div>
        )}
        {bulkMode === "file" ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              <AttendanceImportFileControls
                isTransforming={isTransformingImport}
                isCheckingConflicts={isCheckingImportConflicts}
                lookupsReady={importLookupsReady}
                onFileChange={handleCSVFileSelect}
                onDownloadTemplate={downloadCSVTemplate}
              />
              {csvParseError && (
                <p className="text-sm text-red-600">{csvParseError}</p>
              )}
              {csvPreviewRows.length > 0 && (
                <>
                  <p className="text-xs text-gray-500">
                    Rows on an employee&apos;s scheduled rest days (per work schedule) are unchecked by default. Use the Include column to import rest-day work after review.
                  </p>
                    <p className="text-xs text-gray-600">
                    {(() => {
                      const valid = csvPreviewRows.filter((r) => r.employeeId && !r.error && r.dateTs > 0);
                      const toImport = valid.filter((r) => r.includeInImport);
                      const restExcluded = valid.filter(
                        (r) => !r.includeInImport && r.isRestDay,
                      ).length;
                      return (
                        <>
                          {toImport.length} row(s) will be imported.{" "}
                          {valid.length - toImport.length > 0 &&
                            `${valid.length - toImport.length} row(s) excluded. `}
                          {restExcluded > 0 &&
                            `${restExcluded} rest day(s) excluded by default. `}
                          {csvPreviewRows.filter((r) => r.error).length > 0 &&
                            `${csvPreviewRows.filter((r) => r.error).length} row(s) have errors.`}
                        </>
                      );
                    })()}
                  </p>
                  <div className="border rounded-lg overflow-auto max-h-[300px] sm:max-h-[350px] min-w-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs w-0 whitespace-nowrap">Include</TableHead>
                          <TableHead className="text-xs">Source</TableHead>
                          <TableHead className="text-xs">Employee</TableHead>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">In</TableHead>
                          <TableHead className="text-xs">Out</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Notes</TableHead>
                          <TableHead className="text-xs">Conflict</TableHead>
                          <TableHead className="text-xs">Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {csvPreviewRows.map((r, i) => {
                          const isExcluded = !r.includeInImport;
                          const displayStatus = isExcluded
                            ? r.isRestDay
                              ? "Rest day (excluded)"
                              : "Excluded"
                            : r.status;
                          const rowError = r.error;
                          const hasConflict =
                            r.includeInImport &&
                            !!r.existingAttendanceId &&
                            !r.overwriteExisting;
                          return (
                            <TableRow
                              key={i}
                              className={
                                rowError
                                  ? "bg-red-50"
                                  : hasConflict
                                    ? "bg-amber-50"
                                    : isExcluded && r.isRestDay
                                      ? "bg-violet-50/80"
                                      : isExcluded
                                        ? "bg-gray-50"
                                        : ""
                              }
                            >
                              <TableCell className="text-xs w-0 p-2">
                                {!r.error && r.dateTs > 0 ? (
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={r.includeInImport}
                                      disabled={isCheckingImportConflicts}
                                      onChange={() => {
                                        const identity = csvRowIdentities[i];
                                        if (!r.employeeId || r.dateTs <= 0) {
                                          return;
                                        }
                                        const resolvedEmployeeId = r.employeeId;
                                        const resolvedDateTs = r.dateTs;
                                        setImportRowDecisions((previous) => ({
                                          ...previous,
                                          [identity]: {
                                            employeeId: resolvedEmployeeId,
                                            dateTs: resolvedDateTs,
                                            includeInImport: !r.includeInImport,
                                            approvedExistingAttendanceId:
                                              previous[identity]?.employeeId ===
                                                resolvedEmployeeId &&
                                              previous[identity]?.dateTs ===
                                                resolvedDateTs &&
                                              previous[identity]
                                                ?.approvedExistingAttendanceId ===
                                                r.existingAttendanceId
                                                ? previous[identity]
                                                    ?.approvedExistingAttendanceId
                                                : undefined,
                                          },
                                        }));
                                        setCsvPreviewRows((prev) =>
                                          prev.map((row, idx) =>
                                            idx === i
                                              ? { ...row, includeInImport: !row.includeInImport }
                                              : row
                                          )
                                        );
                                      }}
                                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="sr-only">Include in import</span>
                                  </label>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="text-xs whitespace-nowrap">
                                {r.sourceSheet} · Row {r.sourceRow}
                              </TableCell>
                              <TableCell className="text-xs">{r.employeeName}</TableCell>
                              <TableCell className="text-xs">
                                <div className="flex flex-col gap-0.5">
                                  <span>{r.dateLabel}</span>
                                  {r.sourceDate && r.sourceDate !== r.dateLabel && (
                                    <span className="text-[10px] text-gray-500">
                                      Source: {r.sourceDate}
                                    </span>
                                  )}
                                  {r.isRestDay && (
                                    <span className="text-[10px] font-medium text-violet-700">
                                      Rest day
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {formatHHmmTo12h(r.actualIn)}
                              </TableCell>
                              <TableCell className="text-xs">
                                {formatHHmmTo12h(r.actualOut)}
                              </TableCell>
                              <TableCell className="text-xs">{displayStatus}</TableCell>
                              <TableCell className="text-xs max-w-[120px] truncate">{r.notes || "—"}</TableCell>
                              <TableCell className="text-xs">
                                {hasConflict ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={isCheckingImportConflicts}
                                    onClick={() => {
                                      const identity = csvRowIdentities[i];
                                      if (
                                        !r.employeeId ||
                                        r.dateTs <= 0 ||
                                        !r.existingAttendanceId
                                      ) {
                                        return;
                                      }
                                      const resolvedEmployeeId = r.employeeId;
                                      const resolvedDateTs = r.dateTs;
                                      const approvedExistingAttendanceId =
                                        r.existingAttendanceId;
                                      setImportRowDecisions((previous) => ({
                                        ...previous,
                                        [identity]: {
                                          employeeId: resolvedEmployeeId,
                                          dateTs: resolvedDateTs,
                                          includeInImport:
                                            previous[identity]?.employeeId ===
                                              resolvedEmployeeId &&
                                            previous[identity]?.dateTs ===
                                              resolvedDateTs
                                              ? previous[identity]?.includeInImport
                                              : undefined,
                                          approvedExistingAttendanceId:
                                            approvedExistingAttendanceId,
                                        },
                                      }));
                                      setCsvPreviewRows((prev) =>
                                        prev.map((row, idx) =>
                                          idx === i
                                            ? { ...row, overwriteExisting: true }
                                            : row,
                                        ),
                                      );
                                    }}
                                  >
                                    Overwrite
                                  </Button>
                                ) : r.existingAttendanceId && r.overwriteExisting ? (
                                  <span className="text-amber-800">Will overwrite</span>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-red-600">{rowError ?? "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {csvUnresolvedConflictCount > 0 && (
                    <p className="text-sm text-amber-800 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {csvUnresolvedConflictCount} row(s) conflict with existing attendance. Choose Overwrite or uncheck Include.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="px-4 sm:px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleBulkDialogOpenChange(false)}
                disabled={isImportingCsv}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCSVImport}
                disabled={
                  isTransformingImport ||
                  isImportingCsv ||
                  isCheckingImportConflicts ||
                  csvUnresolvedConflictCount > 0 ||
                  csvImportableRowCount === 0 ||
                  csvPayrollCorrectionRequirement === "blocked" ||
                  (csvPayrollCorrectionRequirement === "reason-required" &&
                    !correctionReason.trim())
                }
              >
                {isImportingCsv ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  "Import attendance"
                )}
              </Button>
            </div>
          </div>
        ) : (
        <form
          onSubmit={handleBulkSubmit}
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto overflow-x-auto px-5 sm:px-6 py-4 min-w-0">
            <fieldset
              disabled={isSubmittingBulk}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="bulkEmployee" className="text-sm font-medium">
                    Employee *
                  </Label>
                  <EmployeeSelect
                    employees={employees}
                    value={bulkSelectedEmployee}
                    onValueChange={setBulkSelectedEmployee}
                    disabled={isSubmittingBulk}
                  />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="bulkStartDate" className="text-sm font-medium">
                    Start Date *
                  </Label>
                  <DatePicker
                    value={bulkStartDate}
                    onValueChange={setBulkStartDate}
                    placeholder="Select start date"
                  />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="bulkEndDate" className="text-sm font-medium">
                    End Date *
                  </Label>
                  <DatePicker
                    value={bulkEndDate}
                    onValueChange={setBulkEndDate}
                    placeholder="Select end date"
                  />
                </div>
              </div>
              {bulkSelectedEmployee && bulkStartDate && bulkEndDate && (
                <p className="text-xs text-gray-500">
                  Scheduled rest days for this employee are listed under excluded dates. Click restore to include them in this bulk entry.
                </p>
              )}
              {bulkSelectedEmployee && bulkStartDate && bulkEndDate && (
                <div className="space-y-2 w-full min-w-0">
                  {manualUnresolvedConflictCount > 0 && (
                    <p className="text-sm text-amber-800 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {manualUnresolvedConflictCount} day(s) already have attendance. Choose Overwrite or Exclude on each highlighted row before submitting.
                    </p>
                  )}
                  {manualReviewError && (
                    <p className="text-sm text-red-700 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {manualReviewError}
                    </p>
                  )}
                  <Label className="text-sm font-medium">
                    Time In/Out for Each Day *
                  </Label>
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-auto max-h-[340px] sm:max-h-[400px] w-full">
                      <table className="w-full min-w-[1150px] table-fixed caption-bottom text-sm">
                        <TableHeader className="sticky top-0 bg-gray-50 z-10 border-b border-gray-200">
                          <TableRow>
                            <TableHead className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[100px]">
                              Date
                            </TableHead>
                            <TableHead className="hidden sm:table-cell text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[72px]">
                              Day
                            </TableHead>
                            <TableHead className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[120px]">
                              In
                            </TableHead>
                            <TableHead className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[120px]">
                              Out
                            </TableHead>
                            <TableHead className="text-xs sm:text-sm px-3 py-2.5 whitespace-nowrap w-[120px]">
                              Status
                            </TableHead>
                            <TableHead
                              className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[110px]"
                              title="Late (minutes)"
                            >
                              Late
                            </TableHead>
                            <TableHead
                              className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[110px]"
                              title="Undertime (minutes)"
                            >
                              UT
                            </TableHead>
                            <TableHead
                              className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[110px]"
                              title="Overtime (hours)"
                            >
                              OT
                            </TableHead>
                            <TableHead className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[130px]">
                              Notes
                            </TableHead>
                            <TableHead className="text-xs sm:text-sm px-3 py-3 whitespace-nowrap w-[56px]">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <tbody>
                          {getBulkDates().map((dateInfo) => {
                            const employee = employees?.find(
                              (employee) => employee._id === bulkSelectedEmployee,
                            );
                            const daySchedule =
                              employee?.schedule.defaultSchedule[
                                dateInfo.dayName as keyof typeof employee.schedule.defaultSchedule
                              ];
                            const dayTimes = bulkDayTimes[
                              dateInfo.timestamp
                            ] || {
                              timeIn: "",
                              timeOut: "",
                              status: "present",
                              overtime: "",
                              late: "",
                              undertime: "",
                              notes: "",
                              useManualOvertime: false,
                              useManualLate: false,
                              useManualUndertime: false,
                            };

                            // Calculate values automatically (no useMemo - hooks can't be in loops)
                            const calculatedUndertime =
                              daySchedule &&
                              dayTimes.status === "present" &&
                              dayTimes.timeIn &&
                              dayTimes.timeOut
                                ? calculateUndertime(
                                    daySchedule.in,
                                    daySchedule.out,
                                    dayTimes.timeIn,
                                    dayTimes.timeOut,
                                  )
                                : 0;

                            const calculatedLate =
                              daySchedule &&
                              dayTimes.status === "present" &&
                              dayTimes.timeIn
                                ? calculateLate(daySchedule.in, dayTimes.timeIn)
                                : 0;

                            // Use manual values if enabled, otherwise use calculated (late and undertime in mins in UI). Overtime is user-set only.
                            const displayLate = dayTimes.useManualLate
                              ? dayTimes.late
                              : calculatedLate.toString();

                            const displayUndertime = dayTimes.useManualUndertime
                              ? dayTimes.undertime
                              : Math.round(calculatedUndertime * 60).toString();

                            const displayOvertime = dayTimes.useManualOvertime
                              ? dayTimes.overtime
                              : "";

                            const existingId = getExistingIdForDay(
                              dateInfo.timestamp,
                            );
                            const conflictResolution =
                              bulkConflictResolutions[dateInfo.timestamp];
                            const hasUnresolvedConflict =
                              !!existingId && !isManualConflictResolved(dateInfo.timestamp);
                            const rowInputsDisabled =
                              isSubmittingBulk || hasUnresolvedConflict;

                            return (
                              <TableRow
                                key={dateInfo.timestamp}
                                className={
                                  hasUnresolvedConflict
                                    ? "bg-amber-50"
                                    : conflictResolution === "overwrite"
                                      ? "bg-amber-50/40"
                                      : undefined
                                }
                              >
                                <TableCell className="font-medium text-xs sm:text-sm px-3 py-3 align-middle w-[100px]">
                                  <div className="flex flex-col gap-1">
                                    <span>
                                      {format(dateInfo.date, "MMM dd, yyyy")}
                                    </span>
                                    {existingId && (
                                      <div className="flex flex-wrap gap-1">
                                        {conflictResolution === "overwrite" ? (
                                          <span className="text-[10px] text-amber-800">
                                            Will overwrite
                                          </span>
                                        ) : conflictResolution === "exclude" ? (
                                          <span className="text-[10px] text-gray-600">
                                            Excluded
                                          </span>
                                        ) : (
                                          <>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-6 text-[10px] px-1.5"
                                              onClick={() =>
                                                setBulkConflictResolutions(
                                                  (prev) => ({
                                                    ...prev,
                                                    [dateInfo.timestamp]:
                                                      "overwrite",
                                                  }),
                                                )
                                              }
                                            >
                                              Overwrite
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 text-[10px] px-1.5"
                                              onClick={() =>
                                                setBulkConflictResolutions(
                                                  (prev) => ({
                                                    ...prev,
                                                    [dateInfo.timestamp]:
                                                      "exclude",
                                                  }),
                                                )
                                              }
                                            >
                                              Exclude
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                    <span className="text-gray-600 capitalize text-[10px] sm:hidden">
                                      {dateInfo.dayName.slice(0, 3)}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-gray-600 capitalize text-xs sm:text-sm hidden sm:table-cell px-3 py-3 align-middle w-[72px]">
                                  {dateInfo.dayName}
                                </TableCell>
                                <TableCell className="px-3 py-3 align-middle w-[120px]">
                                  <TimePicker
                                    compact
                                    value={dayTimes.timeIn}
                                    onValueChange={(value) =>
                                      setBulkDayTimes((prev) => ({
                                        ...prev,
                                        [dateInfo.timestamp]: {
                                          timeIn: value,
                                          timeOut:
                                            prev[dateInfo.timestamp]?.timeOut ||
                                            "",
                                          status:
                                            prev[dateInfo.timestamp]?.status ||
                                            "present",
                                          overtime:
                                            prev[dateInfo.timestamp]
                                              ?.overtime || "",
                                          late:
                                            prev[dateInfo.timestamp]?.late ||
                                            "",
                                          undertime:
                                            prev[dateInfo.timestamp]
                                              ?.undertime || "",
                                          notes:
                                            prev[dateInfo.timestamp]?.notes ??
                                            "",
                                          useManualOvertime:
                                            prev[dateInfo.timestamp]
                                              ?.useManualOvertime || false,
                                          useManualLate:
                                            prev[dateInfo.timestamp]
                                              ?.useManualLate || false,
                                          useManualUndertime:
                                            prev[dateInfo.timestamp]
                                              ?.useManualUndertime || false,
                                        },
                                      }))
                                    }
                                    disabled={
                                      dayTimes.status === "absent" ||
                                      dayTimes.status === "leave" ||
                                      dayTimes.status === "leave_with_pay" ||
                                      dayTimes.status === "leave_without_pay" ||
                                      dayTimes.status === "no_work" ||
                                      rowInputsDisabled
                                    }
                                    placeholder="Time in"
                                    showLabel={false}
                                    className="w-full min-w-0"
                                  />
                                </TableCell>
                                <TableCell className="px-3 py-3 align-middle w-[120px]">
                                  <TimePicker
                                    compact
                                    value={dayTimes.timeOut}
                                    onValueChange={(value) =>
                                      setBulkDayTimes((prev) => ({
                                        ...prev,
                                        [dateInfo.timestamp]: {
                                          timeIn:
                                            prev[dateInfo.timestamp]?.timeIn ||
                                            "",
                                          timeOut: value,
                                          status:
                                            prev[dateInfo.timestamp]?.status ||
                                            "present",
                                          overtime:
                                            prev[dateInfo.timestamp]
                                              ?.overtime || "",
                                          late:
                                            prev[dateInfo.timestamp]?.late ||
                                            "",
                                          undertime:
                                            prev[dateInfo.timestamp]
                                              ?.undertime || "",
                                          notes:
                                            prev[dateInfo.timestamp]?.notes ??
                                            "",
                                          useManualOvertime:
                                            prev[dateInfo.timestamp]
                                              ?.useManualOvertime || false,
                                          useManualLate:
                                            prev[dateInfo.timestamp]
                                              ?.useManualLate || false,
                                          useManualUndertime:
                                            prev[dateInfo.timestamp]
                                              ?.useManualUndertime || false,
                                        },
                                      }))
                                    }
                                    disabled={
                                      dayTimes.status === "absent" ||
                                      dayTimes.status === "leave" ||
                                      dayTimes.status === "leave_with_pay" ||
                                      dayTimes.status === "leave_without_pay" ||
                                      dayTimes.status === "no_work" ||
                                      rowInputsDisabled
                                    }
                                    placeholder="Time out"
                                    showLabel={false}
                                    className="w-full min-w-0"
                                  />
                                </TableCell>
                                <TableCell className="px-3 py-2.5 align-middle w-[120px]">
                                  <Select
                                    value={dayTimes.status}
                                    onValueChange={(value: ManualAttendanceStatus) => {
                                      setBulkDayTimes((prev) => {
                                        const currentTimes =
                                          prev[dateInfo.timestamp] || {};

                                        // If changing to present and times are empty, use schedule times
                                        let newTimeIn =
                                          currentTimes.timeIn || "";
                                        let newTimeOut =
                                          currentTimes.timeOut || "";

                                        if (
                                          value === "present" &&
                                          (!newTimeIn || !newTimeOut)
                                        ) {
                                          if (daySchedule?.isWorkday) {
                                            if (!newTimeIn && daySchedule.in) {
                                              newTimeIn = daySchedule.in;
                                            }
                                            if (
                                              !newTimeOut &&
                                              daySchedule.out
                                            ) {
                                              newTimeOut = daySchedule.out;
                                            }
                                          }
                                        }

                                        return {
                                          ...prev,
                                          [dateInfo.timestamp]: {
                                            timeIn:
                                              value === "leave" ||
                                              value === "leave_with_pay" ||
                                              value === "leave_without_pay" ||
                                              value === "absent" ||
                                              value === "no_work"
                                                ? ""
                                                : newTimeIn,
                                            timeOut:
                                              value === "leave" ||
                                              value === "leave_with_pay" ||
                                              value === "leave_without_pay" ||
                                              value === "absent" ||
                                              value === "no_work"
                                                ? ""
                                                : newTimeOut,
                                            status: value,
                                            overtime:
                                              value === "leave" ||
                                              value === "leave_with_pay" ||
                                              value === "leave_without_pay" ||
                                              value === "absent" ||
                                              value === "no_work"
                                                ? ""
                                                : currentTimes.overtime || "",
                                            late:
                                              value === "leave" ||
                                              value === "leave_with_pay" ||
                                              value === "leave_without_pay" ||
                                              value === "absent" ||
                                              value === "no_work"
                                                ? ""
                                                : currentTimes.late || "",
                                            undertime:
                                              value === "leave" ||
                                              value === "leave_with_pay" ||
                                              value === "leave_without_pay" ||
                                              value === "absent" ||
                                              value === "no_work"
                                                ? ""
                                                : currentTimes.undertime || "",
                                            notes: currentTimes.notes ?? "",
                                            useManualOvertime:
                                              currentTimes.useManualOvertime ||
                                              false,
                                            useManualLate:
                                              currentTimes.useManualLate ||
                                              false,
                                            useManualUndertime:
                                              currentTimes.useManualUndertime ||
                                              false,
                                          },
                                        };
                                      });
                                    }}
                                  >
                                    <SelectTrigger className="w-full h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="present">
                                        Present
                                      </SelectItem>
                                      <SelectItem value="absent">
                                        Absent
                                      </SelectItem>
                                      <SelectItem value="leave_with_pay">
                                        Leave with pay
                                      </SelectItem>
                                      <SelectItem value="leave_without_pay">
                                        Leave without pay
                                      </SelectItem>
                                      {employee &&
                                        canUseNoWorkForDate(
                                          dateInfo.timestamp,
                                          employee,
                                        ) && (
                                        <SelectItem value="no_work">
                                          No work
                                        </SelectItem>
                                      )}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="px-3 py-3 w-[110px] align-middle">
                                  {dayTimes.status === "present" &&
                                  daySchedule ? (
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <Input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={displayLate}
                                          onChange={(e) => {
                                            setBulkDayTimes((prev) => ({
                                              ...prev,
                                              [dateInfo.timestamp]: {
                                                ...prev[dateInfo.timestamp],
                                                late: e.target.value,
                                                useManualLate: true,
                                              },
                                            }));
                                          }}
                                          className={`h-8 w-14 shrink-0 text-xs ${!dayTimes.useManualLate ? "bg-gray-50" : ""}`}
                                          placeholder="0"
                                          disabled={rowInputsDisabled}
                                          readOnly={!dayTimes.useManualLate}
                                          onFocus={() => {
                                            if (!dayTimes.useManualLate) {
                                              setBulkDayTimes((prev) => ({
                                                ...prev,
                                                [dateInfo.timestamp]: {
                                                  ...prev[dateInfo.timestamp],
                                                  useManualLate: true,
                                                  late: calculatedLate.toString(),
                                                },
                                              }));
                                            }
                                          }}
                                        />
                                        <label className="inline-flex items-center gap-1 shrink-0 cursor-pointer leading-none">
                                          <input
                                            type="checkbox"
                                            checked={
                                              dayTimes.useManualLate || false
                                            }
                                            onChange={(e) => {
                                              setBulkDayTimes((prev) => ({
                                                ...prev,
                                                [dateInfo.timestamp]: {
                                                  ...prev[dateInfo.timestamp],
                                                  useManualLate:
                                                    e.target.checked,
                                                  late: e.target.checked
                                                    ? prev[dateInfo.timestamp]
                                                        ?.late ||
                                                      calculatedLate.toString()
                                                    : "",
                                                },
                                              }));
                                            }}
                                            className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 align-middle"
                                            disabled={rowInputsDisabled}
                                            title="Manual override"
                                          />
                                          <span className="text-[9px]">M</span>
                                        </label>
                                      </div>
                                      {!dayTimes.useManualLate &&
                                        calculatedLate > 0 && (
                                          <p className="text-[9px] text-gray-500">
                                            {calculatedLate} min
                                          </p>
                                        )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] sm:text-xs text-gray-400">
                                      -
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="px-3 py-3 w-[110px] align-middle">
                                  {dayTimes.status === "present" &&
                                  daySchedule ? (
                                      <div className="space-y-1">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <Input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={displayUndertime}
                                          onChange={(e) => {
                                            setBulkDayTimes((prev) => ({
                                              ...prev,
                                              [dateInfo.timestamp]: {
                                                ...prev[dateInfo.timestamp],
                                                undertime: e.target.value,
                                                useManualUndertime: true,
                                              },
                                            }));
                                          }}
                                          className={`h-8 w-14 shrink-0 text-xs ${!dayTimes.useManualUndertime ? "bg-gray-50" : ""}`}
                                          placeholder="0"
                                          disabled={rowInputsDisabled}
                                          readOnly={
                                            !dayTimes.useManualUndertime
                                          }
                                          onFocus={() => {
                                            if (!dayTimes.useManualUndertime) {
                                              setBulkDayTimes((prev) => ({
                                                ...prev,
                                                [dateInfo.timestamp]: {
                                                  ...prev[dateInfo.timestamp],
                                                  useManualUndertime: true,
                                                  undertime: Math.round(
                                                    calculatedUndertime * 60,
                                                  ).toString(),
                                                },
                                              }));
                                            }
                                          }}
                                        />
                                        <label className="inline-flex items-center gap-1 shrink-0 cursor-pointer leading-none">
                                          <input
                                            type="checkbox"
                                            checked={
                                              dayTimes.useManualUndertime ||
                                              false
                                            }
                                            onChange={(e) => {
                                              setBulkDayTimes((prev) => ({
                                                ...prev,
                                                [dateInfo.timestamp]: {
                                                  ...prev[dateInfo.timestamp],
                                                  useManualUndertime:
                                                    e.target.checked,
                                                  undertime: e.target.checked
                                                    ? prev[dateInfo.timestamp]
                                                        ?.undertime ||
                                                      Math.round(
                                                        calculatedUndertime * 60,
                                                      ).toString()
                                                    : "",
                                                },
                                              }));
                                            }}
                                            className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 align-middle"
                                            disabled={rowInputsDisabled}
                                            title="Manual override"
                                          />
                                          <span className="text-[9px]">M</span>
                                        </label>
                                      </div>
                                      {!dayTimes.useManualUndertime &&
                                        calculatedUndertime > 0 && (
                                          <p className="text-[9px] text-gray-500">
                                            {Math.round(calculatedUndertime * 60)} mins
                                          </p>
                                        )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] sm:text-xs text-gray-400">
                                      -
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="px-3 py-3 w-[110px] align-middle">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={displayOvertime}
                                        onChange={(e) => {
                                          // When user types, enable manual override
                                          setBulkDayTimes((prev) => ({
                                            ...prev,
                                            [dateInfo.timestamp]: {
                                              timeIn:
                                                prev[dateInfo.timestamp]
                                                  ?.timeIn || "",
                                              timeOut:
                                                prev[dateInfo.timestamp]
                                                  ?.timeOut || "",
                                              status:
                                                prev[dateInfo.timestamp]
                                                  ?.status || "present",
                                              overtime: e.target.value,
                                              late:
                                                prev[dateInfo.timestamp]
                                                  ?.late || "",
                                              undertime:
                                                prev[dateInfo.timestamp]
                                                  ?.undertime || "",
                                              notes:
                                                prev[dateInfo.timestamp]
                                                  ?.notes ?? "",
                                              useManualOvertime: true,
                                              useManualLate:
                                                prev[dateInfo.timestamp]
                                                  ?.useManualLate || false,
                                              useManualUndertime:
                                                prev[dateInfo.timestamp]
                                                  ?.useManualUndertime || false,
                                            },
                                          }));
                                        }}
                                        className={`h-8 w-14 shrink-0 text-xs ${!dayTimes.useManualOvertime ? "bg-gray-50" : ""}`}
                                        placeholder="0.00"
                                        disabled={
                                          dayTimes.status === "absent" ||
                                          dayTimes.status === "leave" ||
                                          dayTimes.status === "leave_with_pay" ||
                                          dayTimes.status === "leave_without_pay" ||
                                          dayTimes.status === "no_work" ||
                                          rowInputsDisabled
                                        }
                                        readOnly={!dayTimes.useManualOvertime}
                                        onFocus={() => {
                                          // Enable manual override when user focuses on input (overtime is user-set only)
                                          if (!dayTimes.useManualOvertime) {
                                            setBulkDayTimes((prev) => ({
                                              ...prev,
                                              [dateInfo.timestamp]: {
                                                ...prev[dateInfo.timestamp],
                                                useManualOvertime: true,
                                                overtime:
                                                  prev[dateInfo.timestamp]
                                                    ?.overtime || "",
                                              },
                                            }));
                                          }
                                        }}
                                      />
                                      {dayTimes.status === "present" &&
                                        daySchedule && (
                                          <label className="inline-flex items-center gap-1 shrink-0 cursor-pointer leading-none">
                                            <input
                                              type="checkbox"
                                              checked={
                                                dayTimes.useManualOvertime ||
                                                false
                                              }
                                              onChange={(e) => {
                                                setBulkDayTimes((prev) => ({
                                                  ...prev,
                                                  [dateInfo.timestamp]: {
                                                    ...prev[dateInfo.timestamp],
                                                    useManualOvertime:
                                                      e.target.checked,
                                                    overtime: e.target.checked
                                                      ? prev[dateInfo.timestamp]
                                                          ?.overtime || ""
                                                      : "",
                                                  },
                                                }));
                                              }}
                                              className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 align-middle"
                                              disabled={rowInputsDisabled}
                                              title="Manual override"
                                            />
                                            <span className="text-[9px]">
                                              M
                                            </span>
                                          </label>
                                        )}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="px-3 py-3 w-[130px] align-middle">
                                  <Input
                                    value={dayTimes.notes ?? ""}
                                    onChange={(e) =>
                                      setBulkDayTimes((prev) => ({
                                        ...prev,
                                        [dateInfo.timestamp]: {
                                          ...prev[dateInfo.timestamp],
                                          notes: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="Note"
                                    disabled={rowInputsDisabled}
                                    className="w-full min-w-0 text-xs"
                                  />
                                </TableCell>
                                <TableCell className="px-3 py-3 align-middle w-[56px]">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      const emp = employees?.find(
                                        (employee) =>
                                          employee._id === bulkSelectedEmployee,
                                      );
                                      if (
                                        emp &&
                                        isEmployeeRestDay(
                                          dateInfo.timestamp,
                                          emp.schedule,
                                        )
                                      ) {
                                        manuallyIncludedRestDaysRef.current.delete(
                                          dateInfo.timestamp,
                                        );
                                      }
                                      setExcludedDates((prev) => {
                                        const newSet = new Set(prev);
                                        newSet.add(dateInfo.timestamp);
                                        return newSet;
                                      });
                                    }}
                                    className="h-6 w-6 sm:h-7 sm:w-7 md:h-8 md:w-8 p-0 hover:bg-red-50 hover:text-red-600"
                                    title="Remove this date"
                                  >
                                    <X className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {getBulkDates().length === 0 &&
                    getExcludedDates().length === 0 && (
                      <p className="text-xs sm:text-sm text-gray-500 text-center py-2">
                        No days to include. Adjust the date range or restore
                        excluded rest days below.
                      </p>
                    )}
                  {getExcludedDates().length > 0 && (
                    <div className="mt-3 sm:mt-4 space-y-2">
                      <Label className="text-xs sm:text-sm text-gray-600">
                        Excluded dates (rest days excluded by default — click to
                        include)
                      </Label>
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {getExcludedDates().map((dateInfo) => {
                          const emp = employees?.find(
                            (employee) => employee._id === bulkSelectedEmployee,
                          );
                          const isRest =
                            !!emp &&
                            isEmployeeRestDay(
                              dateInfo.timestamp,
                              emp.schedule,
                            );
                          return (
                          <Button
                            key={dateInfo.timestamp}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (isRest) {
                                manuallyIncludedRestDaysRef.current.add(
                                  dateInfo.timestamp,
                                );
                              }
                              setExcludedDates((prev) => {
                                const newSet = new Set(prev);
                                newSet.delete(dateInfo.timestamp);
                                return newSet;
                              });
                            }}
                            className={`text-[10px] sm:text-xs h-7 sm:h-8 gap-1 sm:gap-1.5 px-2 sm:px-3 hover:bg-green-50 hover:text-green-700 hover:border-green-300 ${
                              isRest
                                ? "border-violet-200 text-violet-800"
                                : ""
                            }`}
                          >
                            <RotateCcw className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                            {format(dateInfo.date, "MMM dd")} (
                            {dateInfo.dayName.slice(0, 3)}
                            {isRest ? ", RD" : ""})
                          </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          </div>
          <DialogFooter className="px-4 sm:px-6 py-3 sm:py-4 shrink-0 border-t border-gray-200 bg-gray-50 flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBulkDialogOpen(false)}
              disabled={isSubmittingBulk}
              className="w-full sm:w-auto order-2 sm:order-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmittingBulk ||
                manualUnresolvedConflictCount > 0 ||
                isCheckingManualPayrollLocks ||
                manualReviewError !== null ||
                manualPayrollCorrectionRequirement === "blocked" ||
                (manualPayrollCorrectionRequirement === "reason-required" &&
                  !correctionReason.trim())
              }
              className="w-full sm:w-auto order-1 sm:order-2"
            >
              {isSubmittingBulk ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Bulk Attendance"
              )}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
