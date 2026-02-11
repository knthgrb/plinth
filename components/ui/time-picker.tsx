"use client";

import { useState, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Clock, ChevronDown } from "lucide-react";
import { cn } from "@/utils/utils";

interface TimePickerProps {
  value?: string; // HH:mm format (24-hour)
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
  required?: boolean;
  showLabel?: boolean;
}

// Convert 24-hour format (HH:mm) to 12-hour format with AM/PM
function formatTo12Hour(time24: string): { hour: number; minute: number; period: "AM" | "PM" } | null {
  if (!time24) return null;
  const [hours, minutes] = time24.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;
  
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  
  return { hour: hour12, minute: minutes, period };
}

// Convert 12-hour format to 24-hour format (HH:mm)
function formatTo24Hour(hour: number, minute: number, period: "AM" | "PM"): string {
  let hour24 = hour;
  if (period === "PM" && hour !== 12) {
    hour24 = hour + 12;
  } else if (period === "AM" && hour === 12) {
    hour24 = 0;
  }
  return `${hour24.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

// Format time for display
function formatTimeDisplay(time24: string): string {
  const time12 = formatTo12Hour(time24);
  if (!time12) return "";
  return `${time12.hour}:${time12.minute.toString().padStart(2, "0")} ${time12.period}`;
}

export function TimePicker({
  value,
  onValueChange,
  disabled = false,
  placeholder = "Select time",
  label,
  className,
  required = false,
  showLabel = true,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const inputId = label?.toLowerCase().replace(/\s+/g, "-") || "time-input";
  
  const time12 = useMemo(() => formatTo12Hour(value || ""), [value]);
  const [localHour, setLocalHour] = useState(time12?.hour || 12);
  const [localMinute, setLocalMinute] = useState(time12?.minute || 0);
  const [localPeriod, setLocalPeriod] = useState<"AM" | "PM">(time12?.period || "AM");

  // Update local state when value prop changes
  const time12Current = useMemo(() => formatTo12Hour(value || ""), [value]);
  if (time12Current && (time12Current.hour !== localHour || time12Current.minute !== localMinute || time12Current.period !== localPeriod)) {
    setLocalHour(time12Current.hour);
    setLocalMinute(time12Current.minute);
    setLocalPeriod(time12Current.period);
  }

  const handleTimeChange = (hour: number, minute: number, period: "AM" | "PM") => {
    setLocalHour(hour);
    setLocalMinute(minute);
    setLocalPeriod(period);
    const time24 = formatTo24Hour(hour, minute, period);
    onValueChange(time24);
  };

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const displayValue = value ? formatTimeDisplay(value) : "";

  return (
    <div className={cn("space-y-2", className)}>
      {showLabel && label && (
        <Label htmlFor={inputId}>
          {label}
          {required && " *"}
        </Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-start text-left font-normal h-9",
              !value && "text-gray-500",
              disabled && "cursor-not-allowed opacity-50"
            )}
            disabled={disabled}
            type="button"
          >
            <Clock className="mr-2 h-4 w-4 shrink-0" />
            <span className="flex-1 text-left truncate">
              {displayValue || placeholder}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start" sideOffset={4}>
          <div className="flex items-center gap-2">
            {/* Hours */}
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-1 text-center">Hour</div>
              <div 
                className="h-32 w-14 overflow-y-auto overflow-x-hidden border rounded-lg hide-scrollbar"
                onWheel={(e) => {
                  e.stopPropagation();
                  const target = e.currentTarget;
                  target.scrollTop += e.deltaY;
                  e.preventDefault();
                }}
              >
                {hours.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => handleTimeChange(hour, localMinute, localPeriod)}
                    onWheel={(e) => {
                      e.stopPropagation();
                      const container = e.currentTarget.parentElement;
                      if (container) {
                        container.scrollTop += e.deltaY;
                        e.preventDefault();
                      }
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 rounded-md",
                      localHour === hour &&
                        "bg-gray-100 font-medium"
                    )}
                  >
                    {hour.toString().padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutes */}
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-1 text-center">Min</div>
              <div 
                className="h-32 w-14 overflow-y-auto overflow-x-hidden border rounded-lg hide-scrollbar"
                onWheel={(e) => {
                  e.stopPropagation();
                  const target = e.currentTarget;
                  target.scrollTop += e.deltaY;
                  e.preventDefault();
                }}
              >
                {minutes.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    onClick={() => handleTimeChange(localHour, minute, localPeriod)}
                    onWheel={(e) => {
                      e.stopPropagation();
                      const container = e.currentTarget.parentElement;
                      if (container) {
                        container.scrollTop += e.deltaY;
                        e.preventDefault();
                      }
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 rounded-md",
                      localMinute === minute &&
                        "bg-gray-100 font-medium"
                    )}
                  >
                    {minute.toString().padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            {/* AM/PM */}
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-1 text-center">Period</div>
              <div className="h-32 w-12 border rounded-lg flex flex-col overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleTimeChange(localHour, localMinute, "AM")}
                  className={cn(
                    "flex-1 px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 rounded-t-lg",
                    localPeriod === "AM" &&
                      "bg-gray-100 font-medium"
                  )}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => handleTimeChange(localHour, localMinute, "PM")}
                  className={cn(
                    "flex-1 px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 rounded-b-lg",
                    localPeriod === "PM" &&
                      "bg-gray-100 font-medium"
                  )}
                >
                  PM
                </button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
