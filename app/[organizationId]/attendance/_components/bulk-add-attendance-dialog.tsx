"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
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
import { Upload, X, RotateCcw, Loader2, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { bulkCreateAttendance } from "@/actions/attendance";
import { useToast } from "@/components/ui/use-toast";
import { EmployeeSelect } from "@/components/ui/employee-select";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import {
  calculateOvertime,
  calculateLate,
  calculateUndertime,
} from "@/utils/attendance-calculations";

// Parse time string to HH:mm (24h). Supports "9:00 AM", "17:00", "9:00", etc.
function parseTimeToHHmm(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  const amPm = /\s*(AM|PM|am|pm)\s*$/i.exec(s);
  if (amPm) {
    const rest = s.replace(/\s*(AM|PM|am|pm)\s*$/i, "").trim();
    const parts = rest.split(/[:\s]+/);
    let h = parseInt(parts[0], 10);
    const m = parts[1] ? parseInt(parts[1], 10) : 0;
    if (isNaN(h)) return null;
    if (amPm[1].toUpperCase() === "PM" && h !== 12) h += 12;
    if (amPm[1].toUpperCase() === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${(m || 0).toString().padStart(2, "0")}`;
  }
  const match = /^(\d{1,2}):?(\d{2})?$/.exec(s);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = match[2] ? parseInt(match[2], 10) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }
  return null;
}

// Format HH:mm (24h) for display as 12-hour (e.g. "08:58" -> "8:58 AM", "18:06" -> "6:06 PM")
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

// Parse a single CSV line into cells (handles quoted fields)
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let cell = "";
      while (i < line.length && line[i] !== '"') {
        cell += line[i];
        i++;
      }
      if (line[i] === '"') i++;
      out.push(cell.trim());
      if (i < line.length && line[i] === ",") i++;
    } else {
      const comma = line.indexOf(",", i);
      const end = comma === -1 ? line.length : comma;
      out.push(line.slice(i, end).trim());
      i = comma === -1 ? line.length : comma + 1;
    }
  }
  return out;
}

// Simple CSV parse: split lines, then split by comma (handle quoted fields)
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = parseCSVLine(lines[r]);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

const CSV_TEMPLATE = "Employee,Date,Time In,Time Out,Status,Notes\n\"Jane Doe\",2025-01-15,09:00,17:00,present,\n\"John Smith\",2025-01-15,08:30,17:30,present,Left early\n";

const DATE_ROW_REGEX = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

type BiometricCsvRow = {
  employeeKey: string;
  dateStr: string;
  timeInStr: string;
  timeOutStr: string;
};

function parseBiometricTimesheetCSV(text: string): BiometricCsvRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const result: BiometricCsvRow[] = [];
  let currentEmployee = "";
  let skipNextRow = false;

  for (let r = 0; r < lines.length; r++) {
    const cells = parseCSVLine(lines[r]);
    const col5 = (cells[5] ?? "").trim();
    const col6 = (cells[6] ?? "").trim();
    const col7 = (cells[7] ?? "").trim();

    if (skipNextRow) {
      skipNextRow = false;
      continue;
    }

    if (col5.startsWith("Employee:")) {
      const namePart = col5.replace(/^Employee:\s*/i, "").replace(/\s*\(\d+\)\s*$/, "").trim();
      currentEmployee = namePart;
      skipNextRow = col7 !== "Date";
      continue;
    }

    if (col5 === "Total:") {
      currentEmployee = "";
      continue;
    }

    if (DATE_ROW_REGEX.test(col5) && currentEmployee) {
      const col8 = (cells[8] ?? "").trim();
      const col9 = (cells[9] ?? "").trim();
      result.push({
        employeeKey: currentEmployee,
        dateStr: col5,
        timeInStr: col6 || col8,
        timeOutStr: col7 || col9,
      });
    }
  }

  return result;
}

// Mustard Seed / biometric timesheet: no header row; "Employee: Name (id)" in col5, "Date"/"In 1"/"Out 1" in col7/8/9; data rows have date in col5, times in col6/7 (or col8/9)
function isBiometricTimesheetFormat(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  for (let r = 0; r < Math.min(20, lines.length); r++) {
    const cells = parseCSVLine(lines[r]);
    const col3 = (cells[3] ?? "").trim();
    const col5 = (cells[5] ?? "").trim();
    const col7 = (cells[7] ?? "").trim();
    const col8 = (cells[8] ?? "").trim();
    if (col3 === "TIMESHEET REPORT") return true;
    if (col5.startsWith("Employee:") && (col7 === "Date" || col8 === "In 1")) return true;
    if (col7 === "Date" && col8 === "In 1") return true;
  }
  return false;
}

// Parse date string as local calendar date (avoid UTC midnight shifting the day). Supports YYYY-MM-DD and MM/DD/YYYY.
function parseDateToLocalTimestamp(dateStr: string): { ts: number; label: string } | { ts: 0; label: string } {
  const s = (dateStr ?? "").trim();
  if (!s) return { ts: 0, label: "—" };
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    if (m < 0 || m > 11 || d < 1 || d > 31) return { ts: 0, label: s };
    const date = new Date(y, m, d);
    if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d)
      return { ts: 0, label: s };
    return {
      ts: date.getTime(),
      label: format(date, "MMM dd, yyyy"),
    };
  }
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return { ts: 0, label: s };
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
      return { ts: 0, label: s };
    return {
      ts: date.getTime(),
      label: format(date, "MMM dd, yyyy"),
    };
  }
  const other = new Date(s);
  if (isNaN(other.getTime())) return { ts: 0, label: s };
  const date = new Date(other.getFullYear(), other.getMonth(), other.getDate());
  return {
    ts: date.getTime(),
    label: format(date, "MMM dd, yyyy"),
  };
}

interface BulkAddAttendanceDialogProps {
  employees: any[] | undefined;
  currentOrganizationId: string | null;
  onSuccess?: () => void;
}

export function BulkAddAttendanceDialog({
  employees,
  currentOrganizationId,
  onSuccess,
}: BulkAddAttendanceDialogProps) {
  const { toast } = useToast();
  const bulkCreateMutation = useMutation(
    (api as any).attendance.bulkCreateAttendance,
  );
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [bulkEndDate, setBulkEndDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [bulkSelectedEmployee, setBulkSelectedEmployee] = useState("");
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false);
  const [includeSaturday, setIncludeSaturday] = useState(false);
  const [includeSunday, setIncludeSunday] = useState(false);
  // Map of date timestamp to { timeIn, timeOut, status, overtime, late, undertime, notes, useManualOvertime, useManualLate, useManualUndertime }
  const [bulkDayTimes, setBulkDayTimes] = useState<
    Record<
      number,
      {
        timeIn: string;
        timeOut: string;
        status: "present" | "absent" | "leave";
        overtime: string;
        late: string;
        undertime: string;
        notes: string;
        useManualOvertime?: boolean;
        useManualLate?: boolean;
        useManualUndertime?: boolean;
      }
    >
  >({});
  // Set of excluded date timestamps
  const [excludedDates, setExcludedDates] = useState<Set<number>>(new Set());

  // CSV import
  type BulkMode = "manual" | "csv";
  const [bulkMode, setBulkMode] = useState<BulkMode>("manual");
  type CsvPreviewRow = {
    employeeId: string | null;
    employeeName: string;
    dateTs: number;
    dateLabel: string;
    scheduleIn: string;
    scheduleOut: string;
    actualIn: string | undefined;
    actualOut: string | undefined;
    status: "present" | "absent" | "leave" | "half-day";
    notes: string;
    error: string | null;
    /** When true, row will be imported; when false, excluded. User can toggle per row. */
    includeInImport: boolean;
  };
  const [csvPreviewRows, setCsvPreviewRows] = useState<CsvPreviewRow[]>([]);
  const [csvParseError, setCsvParseError] = useState<string | null>(null);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [includeSaturdayCsv, setIncludeSaturdayCsv] = useState(false);
  const [includeSundayCsv, setIncludeSundayCsv] = useState(false);

  const getDayName = (date: Date): string => {
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return days[date.getDay()];
  };

  // Generate list of all dates that could be included (before filtering excluded ones)
  const getAllBulkDates = () => {
    if (!bulkSelectedEmployee || !bulkStartDate || !bulkEndDate) return [];

    const employee = employees?.find(
      (e: any) => e._id === bulkSelectedEmployee,
    );
    if (!employee) return [];

    const startDate = new Date(bulkStartDate);
    const endDate = new Date(bulkEndDate);
    const dates: Array<{ date: Date; timestamp: number; dayName: string }> = [];

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayName = getDayName(currentDate);
      const daySchedule =
        employee.schedule.defaultSchedule[
          dayName as keyof typeof employee.schedule.defaultSchedule
        ];

      const isSaturday = dayName === "saturday";
      const isSunday = dayName === "sunday";
      const shouldInclude =
        daySchedule.isWorkday ||
        (isSaturday && includeSaturday) ||
        (isSunday && includeSunday);

      if (shouldInclude) {
        const dateTimestamp = new Date(currentDate);
        dateTimestamp.setHours(0, 0, 0, 0);
        dates.push({
          date: new Date(currentDate),
          timestamp: dateTimestamp.getTime(),
          dayName,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  };

  // Get filtered dates (excluding removed ones)
  const getBulkDates = () => {
    return getAllBulkDates().filter(
      (dateInfo) => !excludedDates.has(dateInfo.timestamp),
    );
  };

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;

  const normalize = (s: string) =>
    s
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

  const findEmployeeByKey = (employeeKey: string): any => {
    const keyNorm = normalize(employeeKey);
    const swap = (name: string) => {
      const parts = name.split(",").map((p) => p.trim());
      if (parts.length >= 2) return `${parts[1]} ${parts[0]}`.trim();
      return name;
    };
    const swappedNorm = normalize(swap(employeeKey));
    return employees?.find((e: any) => {
      const first = (e.personalInfo?.firstName ?? "").trim();
      const last = (e.personalInfo?.lastName ?? "").trim();
      const fullName = `${first} ${last}`.trim();
      const lastFirst = `${last}, ${first}`.trim();
      const empId = (e.employment?.employeeId ?? "").trim();
      return (
        normalize(fullName) === keyNorm ||
        normalize(lastFirst) === keyNorm ||
        normalize(fullName) === swappedNorm ||
        (empId && empId.toLowerCase() === keyNorm)
      );
    }) ?? null;
  };

  const handleCSVFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setCsvParseError(null);
    setCsvPreviewRows([]);
    if (!file || !employees?.length || !currentOrganizationId) return;
    try {
      const text = await file.text();

      if (isBiometricTimesheetFormat(text)) {
        const biometricRows = parseBiometricTimesheetCSV(text);
        const preview: CsvPreviewRow[] = [];
        const seen = new Map<string, number>();

        for (let i = 0; i < biometricRows.length; i++) {
          const { employeeKey, dateStr, timeInStr, timeOutStr } = biometricRows[i];
          const emp = findEmployeeByKey(employeeKey);
          const { ts: dateTs, label: dateLabel } = parseDateToLocalTimestamp(dateStr);
          const actualIn = timeInStr ? parseTimeToHHmm(timeInStr) ?? undefined : undefined;
          const actualOut = timeOutStr ? parseTimeToHHmm(timeOutStr) ?? undefined : undefined;
          const status: "present" | "absent" | "leave" | "half-day" =
            !actualIn && !actualOut ? "absent" : "present";

          let scheduleIn = "09:00";
          let scheduleOut = "18:00";
          if (emp?.schedule?.defaultSchedule && dateTs > 0) {
            const dayName = dayNames[new Date(dateTs).getDay()];
            const daySched = emp.schedule.defaultSchedule[dayName];
            if (daySched?.isWorkday && daySched?.in && daySched?.out) {
              scheduleIn = daySched.in;
              scheduleOut = daySched.out;
            }
          }

          let error: string | null = null;
          if (!emp) error = "Employee not found";
          else if (dateStr && dateTs === 0) error = "Invalid date";

          const day = dateTs > 0 ? new Date(dateTs).getDay() : -1;
          const isWeekendExcluded =
            (day === 6 && !includeSaturdayCsv) || (day === 0 && !includeSundayCsv);
          const row: CsvPreviewRow = {
            employeeId: emp?._id ?? null,
            employeeName: employeeKey || "—",
            dateTs,
            dateLabel,
            scheduleIn,
            scheduleOut,
            actualIn,
            actualOut,
            status,
            notes: "",
            error,
            includeInImport: !isWeekendExcluded,
          };
          const dedupeKey = `${row.employeeId ?? ""}-${dateTs}`;
          const existingIndex = seen.get(dedupeKey);
          if (existingIndex !== undefined) {
            preview[existingIndex] = row;
          } else {
            seen.set(dedupeKey, preview.length);
            preview.push(row);
          }
        }
        setCsvPreviewRows(preview);
        return;
      }

      const { headers, rows } = parseCSV(text);
      const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
      // Find first header that matches any of the given aliases (case-insensitive)
      const colAny = (...aliases: string[]): string | null => {
        for (const alias of aliases) {
          const idx = lowerHeaders.indexOf(alias.toLowerCase().trim());
          if (idx !== -1) return headers[idx];
        }
        return null;
      };
      // Name: employee, name, staff, full name, etc.
      const employeeCol =
        colAny(
          "employee",
          "employee name",
          "name",
          "employee id",
          "staff",
          "staff name",
          "full name",
          "worker",
          "emp name",
          "emp",
        );
      // Date: date, work date, attendance date, day, etc.
      const dateCol =
        colAny(
          "date",
          "work date",
          "attendance date",
          "day",
          "transaction date",
          "punch date",
          "dates",
          "workday",
        );
      // Time In
      const timeInCol =
        colAny(
          "time in",
          "timein",
          "in",
          "clock in",
          "clockin",
          "check in",
          "checkin",
          "start time",
          "punch in",
          "time in (required)",
          "in time",
        );
      // Time Out
      const timeOutCol =
        colAny(
          "time out",
          "timeout",
          "out",
          "clock out",
          "clockout",
          "check out",
          "checkout",
          "end time",
          "punch out",
          "time out (required)",
          "out time",
        );
      const statusCol = colAny("status", "attendance status", "type");
      const notesCol = colAny("notes", "remarks", "comment", "comments");

      if (!employeeCol || !dateCol) {
        setCsvParseError(
          "CSV must include a name column (e.g. Employee, Name, Staff) and a date column (e.g. Date, Work Date, Day).",
        );
        return;
      }

      const preview: CsvPreviewRow[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const employeeKey = (row[employeeCol] ?? "").trim();
        const dateStr = (row[dateCol] ?? "").trim();
        const timeInStr = (row[timeInCol ?? ""] ?? "").trim();
        const timeOutStr = (row[timeOutCol ?? ""] ?? "").trim();
        const statusStr = ((row[statusCol ?? ""] ?? "").trim() || "present").toLowerCase();
        const notes = (row[notesCol ?? ""] ?? "").trim();

        const statusMap: Record<string, "present" | "absent" | "leave" | "half-day"> = {
          present: "present",
          absent: "absent",
          leave: "leave",
          "half-day": "half-day",
          halfday: "half-day",
        };
        const status = statusMap[statusStr] ?? "present";

        const keyNorm = normalize(employeeKey);
        const emp = employees.find((e: any) => {
          const first = (e.personalInfo?.firstName ?? "").trim();
          const last = (e.personalInfo?.lastName ?? "").trim();
          const fullName = `${first} ${last}`.trim();
          const empId = (e.employment?.employeeId ?? "").trim();
          return (
            normalize(fullName) === keyNorm ||
            (empId && empId.toLowerCase() === keyNorm)
          );
        });

        const { ts: dateTs, label: dateLabel } = parseDateToLocalTimestamp(dateStr);
        const invalidDate = dateTs === 0 && dateStr.length > 0;
        const dateParsed = dateTs > 0 ? new Date(dateTs) : null;

        const actualIn = timeInStr ? parseTimeToHHmm(timeInStr) ?? undefined : undefined;
        const actualOut = timeOutStr ? parseTimeToHHmm(timeOutStr) ?? undefined : undefined;

        let scheduleIn = "09:00";
        let scheduleOut = "18:00";
        if (emp?.schedule?.defaultSchedule && dateTs > 0) {
          const dayName = dayNames[new Date(dateTs).getDay()];
          const daySched = emp.schedule.defaultSchedule[dayName];
          if (daySched?.isWorkday && daySched?.in && daySched?.out) {
            scheduleIn = daySched.in;
            scheduleOut = daySched.out;
          }
        }

        let error: string | null = null;
        if (!emp) error = "Employee not found";
        else if (dateStr && dateTs === 0) error = "Invalid date";
        else if (status === "present" && !actualIn && !actualOut) error = "Time In/Out required for present";

        const day = dateTs > 0 ? new Date(dateTs).getDay() : -1;
        const isWeekendExcluded =
          (day === 6 && !includeSaturdayCsv) || (day === 0 && !includeSundayCsv);
        preview.push({
          employeeId: emp?._id ?? null,
          employeeName: employeeKey || "—",
          dateTs,
          dateLabel,
          scheduleIn,
          scheduleOut,
          actualIn,
          actualOut,
          status,
          notes,
          error,
          includeInImport: !isWeekendExcluded,
        });
      }
      setCsvPreviewRows(preview);
    } catch (err: any) {
      setCsvParseError(err?.message ?? "Failed to parse CSV");
    }
  };

  const handleCSVImport = async () => {
    if (!currentOrganizationId) return;
    const valid = csvPreviewRows.filter(
      (r) => r.employeeId && !r.error && r.dateTs > 0,
    );
    const toImport = valid.filter((r) => r.includeInImport);
    if (toImport.length === 0) {
      toast({
        title: "Nothing to import",
        description: "Fix errors in the CSV, or check Include for rows you want to import.",
        variant: "destructive",
      });
      return;
    }
    setIsImportingCsv(true);
    try {
      const entries = toImport.map((r) => ({
        organizationId: currentOrganizationId as string,
        employeeId: r.employeeId as string,
        date: r.dateTs,
        scheduleIn: r.scheduleIn,
        scheduleOut: r.scheduleOut,
        actualIn: r.actualIn,
        actualOut: r.actualOut,
        status: r.status,
        remarks: r.notes || undefined,
      }));
      await bulkCreateMutation({ entries });
      setIsBulkDialogOpen(false);
      setBulkMode("manual");
      setCsvPreviewRows([]);
      setCsvParseError(null);
      toast({
        title: "Import complete",
        description: `Imported ${entries.length} attendance record(s).`,
        variant: "default",
      });
      onSuccess?.();
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error?.message ?? "Failed to create attendance records.",
        variant: "destructive",
      });
    } finally {
      setIsImportingCsv(false);
    }
  };

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

    // Clean up excluded dates that are no longer in the range
    setExcludedDates((prev) => {
      const dateTimestamps = new Set(dates.map((d) => d.timestamp));
      const newExcluded = new Set<number>();
      prev.forEach((timestamp) => {
        if (dateTimestamps.has(timestamp)) {
          newExcluded.add(timestamp);
        }
      });
      return newExcluded;
    });

    // Initialize times for new dates
    setBulkDayTimes((prev) => {
      // Merge existing times with new ones, preserving user input
      const merged = { ...prev };
      const employee = employees?.find(
        (e: any) => e._id === bulkSelectedEmployee,
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
  }, [
    bulkStartDate,
    bulkEndDate,
    bulkSelectedEmployee,
    includeSaturday,
    includeSunday,
    employees,
  ]);

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !bulkSelectedEmployee) return;

    setIsSubmittingBulk(true);
    try {
      const employee = employees?.find(
        (e: any) => e._id === bulkSelectedEmployee,
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
      const entries: Array<{
        organizationId: string;
        employeeId: string;
        date: number;
        scheduleIn: string;
        scheduleOut: string;
        actualIn?: string;
        actualOut?: string;
        overtime?: number;
        status: "present" | "absent" | "leave";
      }> = [];

      for (const dateInfo of dates) {
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

        // Clear time in/out for leave or absent
        const finalTimeIn =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.timeIn || undefined;
        const finalTimeOut =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.timeOut || undefined;

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
          dayTimes.status === "present" &&
          finalTimeIn &&
          calculatedUndertimeValue === 0
            ? calculateLate(daySchedule.in, finalTimeIn, false)
            : 0;

        // Calculate overtime if not manually provided
        const calculatedOvertimeValue =
          dayTimes.status === "present" && finalTimeOut
            ? calculateOvertime(daySchedule.out, finalTimeOut)
            : 0;

        // Use manual values if enabled, otherwise use calculated
        const finalLate =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.useManualLate
              ? dayTimes.late
                ? parseFloat(dayTimes.late)
                : 0
              : calculatedLateValue > 0
                ? calculatedLateValue
                : undefined;

        const finalUndertime =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.useManualUndertime
              ? dayTimes.undertime
                ? parseFloat(dayTimes.undertime)
                : 0
              : calculatedUndertimeValue > 0
                ? calculatedUndertimeValue
                : undefined;

        const finalOvertime =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.useManualOvertime
              ? dayTimes.overtime
                ? parseFloat(dayTimes.overtime)
                : 0
              : calculatedOvertimeValue > 0
                ? calculatedOvertimeValue
                : undefined;

        const entry: {
          organizationId: string;
          employeeId: string;
          date: number;
          scheduleIn: string;
          scheduleOut: string;
          actualIn?: string;
          actualOut?: string;
          overtime?: number;
          late?: number;
          undertime?: number;
          remarks?: string;
          status: "present" | "absent" | "leave";
        } = {
          organizationId: currentOrganizationId,
          employeeId: bulkSelectedEmployee,
          date: dateInfo.timestamp,
          scheduleIn: daySchedule.in,
          scheduleOut: daySchedule.out,
          actualIn: finalTimeIn,
          actualOut: finalTimeOut,
          status: dayTimes.status as "present" | "absent" | "leave",
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

        entries.push(entry);
      }

      if (entries.length === 0) {
        toast({
          title: "Error",
          description: "No workdays found in the selected date range",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      await bulkCreateAttendance(entries);

      setIsBulkDialogOpen(false);
      setBulkSelectedEmployee("");
      setIncludeSaturday(false);
      setIncludeSunday(false);
      setBulkDayTimes({});
      setExcludedDates(new Set());
      toast({
        title: "Success",
        description: `Successfully created ${entries.length} attendance record(s)`,
        variant: "success",
      });
      onSuccess?.();
    } catch (error) {
      console.error("Error creating bulk attendance:", error);
      toast({
        title: "Error",
        description:
          "Failed to create bulk attendance records. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  return (
    <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Bulk Add Attendance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-[min(92vw,1400px)] max-h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 shrink-0 border-b border-gray-200">
          <DialogTitle className="text-base sm:text-lg md:text-xl">
            Bulk Add Attendance Records
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-gray-600 mt-1.5 sm:mt-2">
            {bulkMode === "manual"
              ? "Add attendance records for an employee across a date range. Only workdays based on the employee's schedule will be included."
              : "Upload a CSV file to import attendance in bulk. Use the template for the correct format."}
          </DialogDescription>
          <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg w-fit mt-3">
            <button
              type="button"
              onClick={() => setBulkMode("manual")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                bulkMode === "manual"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkMode("csv");
                setCsvParseError(null);
                setCsvPreviewRows([]);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                bulkMode === "csv"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Import CSV
            </button>
          </div>
        </DialogHeader>
        {bulkMode === "csv" ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs font-medium">CSV file</Label>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVFileSelect}
                  className="max-w-xs text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadCSVTemplate}
                  className="text-xs"
                >
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                  Download template
                </Button>
              </div>
              {csvParseError && (
                <p className="text-sm text-red-600">{csvParseError}</p>
              )}
              {csvPreviewRows.length > 0 && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Include weekend days</Label>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeSaturdayCsv}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setIncludeSaturdayCsv(checked);
                            setCsvPreviewRows((prev) =>
                              prev.map((r) => {
                                if (r.dateTs > 0 && new Date(r.dateTs).getDay() === 6) {
                                  return { ...r, includeInImport: checked };
                                }
                                return r;
                              })
                            );
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-xs">Saturday</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeSundayCsv}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setIncludeSundayCsv(checked);
                            setCsvPreviewRows((prev) =>
                              prev.map((r) => {
                                if (r.dateTs > 0 && new Date(r.dateTs).getDay() === 0) {
                                  return { ...r, includeInImport: checked };
                                }
                                return r;
                              })
                            );
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-xs">Sunday</span>
                      </label>
                    </div>
                    <p className="text-xs text-gray-500">
                      By default, Saturday and Sunday are not imported. Use the checkboxes above to include all Saturdays or Sundays, then use the Include column in the table to include or exclude individual days.
                    </p>
                  </div>
                    <p className="text-xs text-gray-600">
                    {(() => {
                      const valid = csvPreviewRows.filter((r) => r.employeeId && !r.error && r.dateTs > 0);
                      const toImport = valid.filter((r) => r.includeInImport);
                      return (
                        <>
                          {toImport.length} row(s) will be imported.{" "}
                          {valid.length - toImport.length > 0 &&
                            `${valid.length - toImport.length} row(s) excluded. `}
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
                          <TableHead className="text-xs">Employee</TableHead>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">In</TableHead>
                          <TableHead className="text-xs">Out</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Notes</TableHead>
                          <TableHead className="text-xs">Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {csvPreviewRows.map((r, i) => {
                          const isExcluded = !r.includeInImport;
                          const displayStatus = isExcluded ? "Excluded" : r.status;
                          const rowError = isExcluded ? null : r.error;
                          return (
                            <TableRow
                              key={i}
                              className={rowError ? "bg-red-50" : isExcluded ? "bg-gray-50" : ""}
                            >
                              <TableCell className="text-xs w-0 p-2">
                                {!r.error && r.dateTs > 0 ? (
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={r.includeInImport}
                                      onChange={() => {
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
                              <TableCell className="text-xs">{r.employeeName}</TableCell>
                              <TableCell className="text-xs">{r.dateLabel}</TableCell>
                              <TableCell className="text-xs">
                                {formatHHmmTo12h(r.actualIn)}
                              </TableCell>
                              <TableCell className="text-xs">
                                {formatHHmmTo12h(r.actualOut)}
                              </TableCell>
                              <TableCell className="text-xs">{displayStatus}</TableCell>
                              <TableCell className="text-xs max-w-[120px] truncate">{r.notes || "—"}</TableCell>
                              <TableCell className="text-xs text-red-600">{rowError ?? "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
            <div className="px-4 sm:px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsBulkDialogOpen(false)}
                disabled={isImportingCsv}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCSVImport}
                disabled={
                  isImportingCsv ||
                  csvPreviewRows.filter(
                    (r) => r.employeeId && !r.error && r.dateTs > 0 && r.includeInImport
                  ).length === 0
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
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 min-w-0">
            <fieldset
              disabled={isSubmittingBulk}
              className="space-y-3 sm:space-y-4"
            >
              <div className="grid gap-3 sm:gap-4 py-1 sm:py-2">
                <div className="space-y-1.5 sm:space-y-2 min-w-0 max-w-full sm:max-w-md">
                  <Label
                    htmlFor="bulkEmployee"
                    className="text-xs sm:text-sm font-medium"
                  >
                    Employee *
                  </Label>
                  <EmployeeSelect
                    employees={employees}
                    value={bulkSelectedEmployee}
                    onValueChange={setBulkSelectedEmployee}
                    disabled={isSubmittingBulk}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-full sm:max-w-md">
                  <div className="space-y-1.5 sm:space-y-2 min-w-0">
                    <Label
                      htmlFor="bulkStartDate"
                      className="text-xs sm:text-sm font-medium"
                    >
                      Start Date *
                    </Label>
                    <DatePicker
                      value={bulkStartDate}
                      onValueChange={setBulkStartDate}
                      placeholder="Select start date"
                    />
                  </div>
                  <div className="space-y-1.5 sm:space-y-2 min-w-0">
                    <Label
                      htmlFor="bulkEndDate"
                      className="text-xs sm:text-sm font-medium"
                    >
                      End Date *
                    </Label>
                    <DatePicker
                      value={bulkEndDate}
                      onValueChange={setBulkEndDate}
                      placeholder="Select end date"
                    />
                  </div>
                </div>
                <div className="space-y-1.5 sm:space-y-2 min-w-0">
                  <Label className="text-xs sm:text-sm font-medium">
                    Include Weekends
                  </Label>
                  <div className="flex flex-wrap gap-3 sm:gap-4">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="includeSaturday"
                        checked={includeSaturday}
                        onChange={(e) => setIncludeSaturday(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <Label
                        htmlFor="includeSaturday"
                        className="text-xs sm:text-sm font-normal cursor-pointer"
                      >
                        Saturday
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="includeSunday"
                        checked={includeSunday}
                        onChange={(e) => setIncludeSunday(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <Label
                        htmlFor="includeSunday"
                        className="text-xs sm:text-sm font-normal cursor-pointer"
                      >
                        Sunday
                      </Label>
                    </div>
                  </div>
                </div>
              </div>
              {bulkSelectedEmployee && bulkStartDate && bulkEndDate && (
                <div className="space-y-2 sm:space-y-3 min-w-0 w-full">
                  <Label className="text-xs sm:text-sm font-medium">
                    Enter Time In/Out for Each Day *
                  </Label>
                  <div className="border rounded-lg overflow-hidden -mx-2 sm:mx-0 w-full min-w-0">
                    <div className="overflow-x-auto overflow-y-auto max-h-[300px] sm:max-h-[350px] md:max-h-96 w-full min-w-0">
                      <Table className="w-full min-w-[880px] table-fixed">
                        <TableHeader className="sticky top-0 bg-gray-50 z-10">
                          <TableRow>
                            <TableHead className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap w-[90px] min-w-[90px]">
                              Date
                            </TableHead>
                            <TableHead className="hidden sm:table-cell text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap w-[56px] min-w-[56px]">
                              Day
                            </TableHead>
                            <TableHead className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap w-[76px] min-w-[76px]">
                              In
                            </TableHead>
                            <TableHead className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap w-[76px] min-w-[76px]">
                              Out
                            </TableHead>
                            <TableHead className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap w-[72px] min-w-[72px]">
                              Status
                            </TableHead>
                            <TableHead
                              className="text-[10px] sm:text-xs px-2 sm:px-3 whitespace-nowrap w-[84px] min-w-[84px]"
                              title="Late (minutes)"
                            >
                              Late
                            </TableHead>
                            <TableHead
                              className="text-[10px] sm:text-xs px-2 sm:px-3 whitespace-nowrap w-[76px] min-w-[76px]"
                              title="Undertime (hours)"
                            >
                              UT
                            </TableHead>
                            <TableHead
                              className="text-[10px] sm:text-xs px-2 sm:px-3 whitespace-nowrap w-[76px] min-w-[76px]"
                              title="Overtime (hours)"
                            >
                              OT
                            </TableHead>
                            <TableHead className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap w-[110px] min-w-[110px]">
                              Notes
                            </TableHead>
                            <TableHead className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap w-[48px] min-w-[48px]">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {getBulkDates().map((dateInfo) => {
                            const employee = employees?.find(
                              (e: any) => e._id === bulkSelectedEmployee,
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
                              dayTimes.timeIn &&
                              calculatedUndertime === 0
                                ? calculateLate(
                                    daySchedule.in,
                                    dayTimes.timeIn,
                                    false,
                                  )
                                : 0;

                            const calculatedOvertime =
                              daySchedule &&
                              dayTimes.status === "present" &&
                              dayTimes.timeOut
                                ? calculateOvertime(
                                    daySchedule.out,
                                    dayTimes.timeOut,
                                  )
                                : 0;

                            // Use manual values if enabled, otherwise use calculated
                            const displayLate = dayTimes.useManualLate
                              ? dayTimes.late
                              : calculatedLate.toString();

                            const displayUndertime = dayTimes.useManualUndertime
                              ? dayTimes.undertime
                              : calculatedUndertime.toFixed(2);

                            const displayOvertime = dayTimes.useManualOvertime
                              ? dayTimes.overtime
                              : calculatedOvertime.toFixed(2);

                            return (
                              <TableRow key={dateInfo.timestamp}>
                                <TableCell className="font-medium text-xs sm:text-sm">
                                  <div className="flex flex-col">
                                    <span>
                                      {format(dateInfo.date, "MMM dd, yyyy")}
                                    </span>
                                    <span className="text-gray-600 capitalize text-[10px] sm:hidden">
                                      {dateInfo.dayName.slice(0, 3)}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-gray-600 capitalize text-xs sm:text-sm hidden sm:table-cell">
                                  {dateInfo.dayName}
                                </TableCell>
                                <TableCell>
                                  <TimePicker
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
                                      isSubmittingBulk
                                    }
                                    placeholder="Time in"
                                    showLabel={false}
                                    className="w-full text-xs"
                                  />
                                </TableCell>
                                <TableCell className="px-2 sm:px-4 py-2 sm:py-3">
                                  <TimePicker
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
                                      isSubmittingBulk
                                    }
                                    placeholder="Time out"
                                    showLabel={false}
                                    className="w-full"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={dayTimes.status}
                                    onValueChange={(value: any) => {
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
                                              value === "absent"
                                                ? ""
                                                : newTimeIn,
                                            timeOut:
                                              value === "leave" ||
                                              value === "absent"
                                                ? ""
                                                : newTimeOut,
                                            status: value,
                                            overtime:
                                              value === "leave" ||
                                              value === "absent"
                                                ? ""
                                                : currentTimes.overtime || "",
                                            late:
                                              value === "leave" ||
                                              value === "absent"
                                                ? ""
                                                : currentTimes.late || "",
                                            undertime:
                                              value === "leave" ||
                                              value === "absent"
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
                                    <SelectTrigger className="w-full text-xs h-8 sm:h-9">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="present">
                                        Present
                                      </SelectItem>
                                      <SelectItem value="absent">
                                        Absent
                                      </SelectItem>
                                      <SelectItem value="leave">
                                        Leave
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="px-2 sm:px-4 py-2 sm:py-3 w-[84px] min-w-[84px]">
                                  {dayTimes.status === "present" &&
                                  daySchedule ? (
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-1 min-w-0">
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
                                          className={`min-w-[3rem] w-14 flex-1 text-xs ${!dayTimes.useManualLate ? "bg-gray-50" : ""}`}
                                          placeholder="0"
                                          disabled={isSubmittingBulk}
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
                                        <label className="flex items-center gap-0.5 text-[10px] text-gray-600 whitespace-nowrap">
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
                                            className="h-2.5 w-2.5 rounded border-gray-300"
                                            disabled={isSubmittingBulk}
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
                                <TableCell className="px-2 sm:px-4 py-2 sm:py-3 w-[76px] min-w-[76px]">
                                  {dayTimes.status === "present" &&
                                  daySchedule ? (
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-1 min-w-0">
                                        <Input
                                          type="number"
                                          step="0.01"
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
                                          className={`min-w-[3rem] w-14 flex-1 text-xs ${!dayTimes.useManualUndertime ? "bg-gray-50" : ""}`}
                                          placeholder="0.00"
                                          disabled={isSubmittingBulk}
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
                                                  undertime:
                                                    calculatedUndertime.toFixed(
                                                      2,
                                                    ),
                                                },
                                              }));
                                            }
                                          }}
                                        />
                                        <label className="flex items-center gap-0.5 text-[10px] text-gray-600 whitespace-nowrap">
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
                                                      calculatedUndertime.toFixed(
                                                        2,
                                                      )
                                                    : "",
                                                },
                                              }));
                                            }}
                                            className="h-2.5 w-2.5 rounded border-gray-300"
                                            disabled={isSubmittingBulk}
                                            title="Manual override"
                                          />
                                          <span className="text-[9px]">M</span>
                                        </label>
                                      </div>
                                      {!dayTimes.useManualUndertime &&
                                        calculatedUndertime > 0 && (
                                          <p className="text-[9px] text-gray-500">
                                            {calculatedUndertime.toFixed(2)} hrs
                                          </p>
                                        )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] sm:text-xs text-gray-400">
                                      -
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="px-2 sm:px-4 py-2 sm:py-3 w-[76px] min-w-[76px]">
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
                                        className={`min-w-[3rem] w-14 flex-1 text-xs ${!dayTimes.useManualOvertime ? "bg-gray-50" : ""}`}
                                        placeholder="0.00"
                                        disabled={
                                          dayTimes.status === "absent" ||
                                          dayTimes.status === "leave" ||
                                          isSubmittingBulk
                                        }
                                        readOnly={!dayTimes.useManualOvertime}
                                        onFocus={() => {
                                          // Enable manual override when user focuses on input
                                          if (!dayTimes.useManualOvertime) {
                                            setBulkDayTimes((prev) => ({
                                              ...prev,
                                              [dateInfo.timestamp]: {
                                                ...prev[dateInfo.timestamp],
                                                useManualOvertime: true,
                                                overtime:
                                                  calculatedOvertime.toFixed(2),
                                              },
                                            }));
                                          }
                                        }}
                                      />
                                      {dayTimes.status === "present" &&
                                        daySchedule && (
                                          <label className="flex items-center gap-0.5 text-[10px] text-gray-600 whitespace-nowrap">
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
                                                          ?.overtime ||
                                                        calculatedOvertime.toFixed(
                                                          2,
                                                        )
                                                      : "",
                                                  },
                                                }));
                                              }}
                                              className="h-2.5 w-2.5 rounded border-gray-300"
                                              disabled={isSubmittingBulk}
                                              title="Manual override"
                                            />
                                            <span className="text-[9px]">
                                              M
                                            </span>
                                          </label>
                                        )}
                                    </div>
                                    {dayTimes.status === "present" &&
                                      daySchedule &&
                                      !dayTimes.useManualOvertime &&
                                      calculatedOvertime > 0 && (
                                        <p className="text-[9px] text-gray-500">
                                          {calculatedOvertime.toFixed(2)} hrs
                                        </p>
                                      )}
                                  </div>
                                </TableCell>
                                <TableCell className="px-2 sm:px-4 py-2 sm:py-3 w-[110px] min-w-[110px]">
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
                                    disabled={isSubmittingBulk}
                                    className="w-full min-w-[4rem] text-xs"
                                  />
                                </TableCell>
                                <TableCell className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-4 py-2 sm:py-3">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
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
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  {getBulkDates().length === 0 &&
                    getExcludedDates().length === 0 && (
                      <p className="text-xs sm:text-sm text-gray-500 text-center py-2">
                        No days to include. Please check your date range and
                        weekend options.
                      </p>
                    )}
                  {getExcludedDates().length > 0 && (
                    <div className="mt-3 sm:mt-4 space-y-2">
                      <Label className="text-xs sm:text-sm text-gray-600">
                        Removed Dates (Click to restore)
                      </Label>
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {getExcludedDates().map((dateInfo) => (
                          <Button
                            key={dateInfo.timestamp}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setExcludedDates((prev) => {
                                const newSet = new Set(prev);
                                newSet.delete(dateInfo.timestamp);
                                return newSet;
                              });
                            }}
                            className="text-[10px] sm:text-xs h-7 sm:h-8 gap-1 sm:gap-1.5 px-2 sm:px-3 hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                          >
                            <RotateCcw className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                            {format(dateInfo.date, "MMM dd")} (
                            {dateInfo.dayName.slice(0, 3)})
                          </Button>
                        ))}
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
              disabled={isSubmittingBulk}
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
