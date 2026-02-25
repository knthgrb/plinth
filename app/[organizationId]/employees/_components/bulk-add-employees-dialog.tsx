"use client";

import { useState, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { createEmployee } from "@/actions/employees";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Upload, FileSpreadsheet } from "lucide-react";
import {
  getEmployeeCsvTemplate,
  parseEmployeeCsv,
  DEFAULT_BULK_SCHEDULE,
  type ParsedEmployeeRow,
} from "./employee-csv-utils";

type BulkAddEmployeesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: Id<"organizations"> | null;
  onSuccess?: () => void;
};

export function BulkAddEmployeesDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
}: BulkAddEmployeesDialogProps) {
  const settings = useQuery(
    (api as any).settings.getSettings,
    organizationId ? { organizationId } : "skip"
  );

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedEmployeeRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    added: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const handleDownloadTemplate = useCallback(() => {
    const csv = getEmployeeCsvTemplate();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employee_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    setUploadResult(null);
    if (!f) {
      setFile(null);
      setParsedRows([]);
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = parseEmployeeCsv(text);
      setParsedRows(rows);
    };
    reader.readAsText(f, "UTF-8");
  };

  const validRows = parsedRows.filter(
    (r) => Object.keys(r.errors).length === 0
  );
  const invalidRows = parsedRows.filter(
    (r) => Object.keys(r.errors).length > 0
  );

  const handleBulkAdd = async () => {
    if (!organizationId || validRows.length === 0 || isUploading) return;

    const orgRegularRate = settings?.payrollSettings?.regularHolidayRate ?? 1.0;
    const orgSpecialRate = settings?.payrollSettings?.specialHolidayRate ?? 0.3;
    const orgNightDiff = settings?.payrollSettings?.nightDiffPercent ?? 0.1;
    const orgOtRegular = settings?.payrollSettings?.overtimeRegularRate ?? 1.25;
    const orgOtRestDay = settings?.payrollSettings?.overtimeRestDayRate ?? 1.69;
    const orgRegHolidayOt = settings?.payrollSettings?.regularHolidayOtRate ?? 2.0;
    const orgSpecHolidayOt = settings?.payrollSettings?.specialHolidayOtRate ?? 1.69;

    setIsUploading(true);
    const errors: string[] = [];
    let added = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const v = row.values;
      try {
        const regularHolidayRateDecimal = v.regularHolidayRate
          ? parseFloat(v.regularHolidayRate) / 100
          : orgRegularRate;
        const specialHolidayRateDecimal = v.specialHolidayRate
          ? parseFloat(v.specialHolidayRate) / 100
          : orgSpecialRate;
        const nightDiffPercentDecimal = v.nightDiffPercent
          ? parseFloat(v.nightDiffPercent) / 100
          : orgNightDiff;
        const overtimeRegularRateDecimal = v.overtimeRegularRate
          ? parseFloat(v.overtimeRegularRate) / 100
          : orgOtRegular;
        const overtimeRestDayRateDecimal = v.overtimeRestDayRate
          ? parseFloat(v.overtimeRestDayRate) / 100
          : orgOtRestDay;
        const regularHolidayOtRateDecimal = v.regularHolidayOtRate
          ? parseFloat(v.regularHolidayOtRate) / 100
          : orgRegHolidayOt;
        const specialHolidayOtRateDecimal = v.specialHolidayOtRate
          ? parseFloat(v.specialHolidayOtRate) / 100
          : orgSpecHolidayOt;

        await createEmployee({
          organizationId,
          personalInfo: {
            firstName: v.firstName,
            lastName: v.lastName,
            middleName: v.middleName || undefined,
            email: v.email,
            phone: v.phone || undefined,
          },
          employment: {
            employeeId: "",
            position: v.position,
            department: v.department,
            employmentType: v.employmentType as "regular" | "probationary" | "contractual" | "part-time",
            hireDate: new Date(v.hireDate).getTime(),
            status: "active",
          },
          compensation: {
            basicSalary: parseFloat(v.basicSalary),
            allowance: v.allowance ? parseFloat(v.allowance) : undefined,
            salaryType: v.salaryType as "monthly" | "daily" | "hourly",
            regularHolidayRate: regularHolidayRateDecimal,
            specialHolidayRate: specialHolidayRateDecimal,
            nightDiffPercent: nightDiffPercentDecimal,
            overtimeRegularRate: overtimeRegularRateDecimal,
            overtimeRestDayRate: overtimeRestDayRateDecimal,
            regularHolidayOtRate: regularHolidayOtRateDecimal,
            specialHolidayOtRate: specialHolidayOtRateDecimal,
          },
          schedule: {
            defaultSchedule: DEFAULT_BULK_SCHEDULE,
          },
        });
        added++;
      } catch (err: any) {
        errors.push(`Row ${row.rowIndex}: ${err?.message ?? "Failed"}`);
      }
    }

    setUploadResult({
      added,
      failed: errors.length,
      errors,
    });
    setIsUploading(false);
    if (added > 0 && errors.length === 0) {
      setFile(null);
      setParsedRows([]);
      onSuccess?.();
    }
  };

  const reset = () => {
    setFile(null);
    setParsedRows([]);
    setUploadResult(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk add employees (CSV)</DialogTitle>
          <DialogDescription>
            Upload a CSV file with employee data. Use the sample template to get the correct columns.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 h-8 rounded-lg border border-[#DDDDDD] bg-white hover:bg-[rgb(250,250,250)] text-xs font-medium text-[rgb(64,64,64)]"
              onClick={handleDownloadTemplate}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download sample template
            </Button>
            <label className="flex-1 cursor-pointer">
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
              />
              <span className="flex items-center justify-center gap-1.5 rounded-lg border border-[#DDDDDD] bg-white hover:bg-[rgb(250,250,250)] px-3 py-1.5 text-xs font-medium text-[rgb(64,64,64)] h-8">
                <Upload className="h-3.5 w-3.5" />
                Choose CSV file
              </span>
            </label>
          </div>

          {file && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              {file.name} ({parsedRows.length} row{parsedRows.length !== 1 ? "s" : ""})
            </div>
          )}

          {parsedRows.length > 0 && (
            <div className="space-y-2">
              {invalidRows.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    {invalidRows.length} row(s) have errors (will be skipped):
                  </p>
                  <ul className="mt-1 list-disc list-inside text-amber-700 dark:text-amber-300 text-xs space-y-0.5">
                    {invalidRows.slice(0, 5).map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex}: {Object.values(r.errors).join(", ")}
                      </li>
                    ))}
                    {invalidRows.length > 5 && (
                      <li>… and {invalidRows.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
              {validRows.length > 0 && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  {validRows.length} employee(s) ready to add.
                </p>
              )}
              {validRows.length > 0 && (
                <Button
                  type="button"
                  className="w-full bg-[#695eff] hover:bg-[#5547e8]"
                  onClick={handleBulkAdd}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding… ({validRows.length} employees)
                    </>
                  ) : (
                    `Add ${validRows.length} employee(s)`
                  )}
                </Button>
              )}
            </div>
          )}

          {uploadResult && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                Added {uploadResult.added}, failed {uploadResult.failed}.
              </p>
              {uploadResult.errors.length > 0 && (
                <ul className="mt-1 list-disc list-inside text-red-600 dark:text-red-400 text-xs">
                  {uploadResult.errors.slice(0, 5).map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                  {uploadResult.errors.length > 5 && (
                    <li>… and {uploadResult.errors.length - 5} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
