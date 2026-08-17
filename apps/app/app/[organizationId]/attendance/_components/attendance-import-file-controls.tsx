import type { ChangeEventHandler } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AttendanceImportFileControlsProps {
  isTransforming: boolean;
  isCheckingConflicts: boolean;
  lookupsReady: boolean;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  onDownloadTemplate: () => void;
}

export function AttendanceImportFileControls({
  isTransforming,
  isCheckingConflicts,
  lookupsReady,
  onFileChange,
  onDownloadTemplate,
}: AttendanceImportFileControlsProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs font-medium">Attendance file</Label>
        <Input
          type="file"
          accept=".xls,.xlsx,.xlsm,.csv"
          onChange={onFileChange}
          disabled={!lookupsReady}
          className="max-w-xs text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownloadTemplate}
          disabled={isTransforming || !lookupsReady}
          className="text-xs"
        >
          <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
          Download template
        </Button>
      </div>
      <div className="space-y-0.5 text-xs text-gray-500">
        <p>
          Only Excel (.xls, .xlsx, .xlsm) and CSV (.csv) files are supported.
        </p>
        <p>Employee Name is required and must match an employee in the app.</p>
      </div>
      {!lookupsReady && (
        <p className="text-xs text-gray-500">
          Preparing employee and holiday data…
        </p>
      )}
      {isTransforming && (
        <p className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing…
        </p>
      )}
      {isCheckingConflicts && (
        <p className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking existing attendance…
        </p>
      )}
    </div>
  );
}
