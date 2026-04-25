"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export type DateRangeOption = "7" | "30" | "90";

type DashboardOverviewHeaderProps = {
  title?: string;
  dateRange?: DateRangeOption;
  onDateRangeChange?: (value: DateRangeOption) => void;
  compareLabel?: string;
  /** Right-side actions e.g. + Add, Edit */
  actions?: React.ReactNode;
  className?: string;
};

const DATE_LABELS: Record<DateRangeOption, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
};

export function DashboardOverviewHeader({
  title = "Your overview",
  dateRange = "7",
  onDateRangeChange,
  compareLabel = "Previous period",
  actions,
  className,
}: DashboardOverviewHeaderProps) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {title ? (
          <h1 className="text-xl font-semibold tracking-tight text-[#101828] sm:text-2xl">
            {title}
          </h1>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {onDateRangeChange && (
            <>
              <Select
                value={dateRange}
                onValueChange={(v) => onDateRangeChange(v as DateRangeOption)}
              >
                <SelectTrigger className="h-10 min-w-[138px] rounded-full border-[#d7ddeb] bg-white/90 px-4 text-sm font-medium text-[#344054] shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DATE_LABELS) as DateRangeOption[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {DATE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select defaultValue="previous">
                <SelectTrigger className="h-10 min-w-[176px] rounded-full border-[#d7ddeb] bg-white/90 px-4 text-sm font-medium text-[#344054] shadow-sm">
                  <SelectValue>Compare {compareLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="previous">{compareLabel}</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
