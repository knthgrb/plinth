"use client";

import { useState } from "react";
import { format, getYear } from "date-fns";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MonthPickerProps = {
  value: string | "";
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  triggerClassName?: string;
};

// Reusable month picker aligned with attendance UI
export function MonthPicker({
  value,
  onChange,
  label,
  className,
  triggerClassName,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false);

  const currentDate = value ? new Date(value + "-01") : new Date();

  const handleSetMonth = (date: Date, close = true) => {
    onChange(format(date, "yyyy-MM"));
    if (close) setOpen(false);
  };

  const handlePrev = () => {
    const prev = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - 1,
      1
    );
    handleSetMonth(prev, false);
  };

  const handleNext = () => {
    const next = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      1
    );
    handleSetMonth(next, false);
  };

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return (
    <div className={className}>
      {label ? (
        <Label className="text-sm text-gray-600 mb-1 block">{label}</Label>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={`w-[220px] justify-start text-left font-normal h-10 px-3 gap-2 ${triggerClassName ?? ""}`}
          >
            <span>
              {value
                ? format(new Date(value + "-01"), "MMMM yyyy")
                : "Select month"}
            </span>
            <Calendar className="h-4 w-4 shrink-0 ml-auto" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-3">
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handlePrev}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2">
                <Select
                  value={getYear(currentDate).toString()}
                  onValueChange={(year) => {
                    const newDate = new Date(
                      parseInt(year, 10),
                      currentDate.getMonth(),
                      1
                    );
                    handleSetMonth(newDate, false);
                  }}
                >
                  <SelectTrigger className="w-[100px] h-8 text-sm font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 10 }, (_, i) => {
                      const year = new Date().getFullYear() - 5 + i;
                      return (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handleNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {months.map((month, index) => {
                const isSelected = currentDate.getMonth() === index;
                return (
                  <Button
                    key={month}
                    variant={isSelected ? "default" : "ghost"}
                    className="h-9 text-sm"
                    onClick={() => {
                      const newDate = new Date(
                        currentDate.getFullYear(),
                        index,
                        1
                      );
                      handleSetMonth(newDate);
                    }}
                  >
                    {month.slice(0, 3)}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => handleSetMonth(new Date())}
              >
                This month
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}









