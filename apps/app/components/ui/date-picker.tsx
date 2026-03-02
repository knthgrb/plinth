"use client";

import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { DayPicker } from "react-day-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/utils";

// react-day-picker styles are imported globally

interface DatePickerProps {
  value?: string; // YYYY-MM-DD format
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function DatePicker({
  value,
  onValueChange,
  disabled = false,
  placeholder = "Pick a date",
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = value ? new Date(value) : undefined;
  const [month, setMonth] = useState<Date>(selectedDate || new Date());

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onValueChange(format(date, "yyyy-MM-dd"));
      setOpen(false);
    }
  };

  const handleMonthChange = (newMonth: Date) => {
    setMonth(newMonth);
  };

  // Generate years list
  const years = useMemo(() => {
    const yearList = [];
    const startYear = 1900;
    const endYear = new Date().getFullYear() + 10;
    for (let year = startYear; year <= endYear; year++) {
      yearList.push(year);
    }
    return yearList;
  }, []);

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-9 focus-visible:ring-[#695eff] focus-visible:border-[#695eff]",
            !value && "text-gray-500",
            className,
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(new Date(value), "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
        <div className="p-4">
          {/* Custom Month and Year Selectors */}
          <div className="flex justify-center gap-2 items-center mb-4">
            <Select
              value={month.getMonth().toString()}
              onValueChange={(value) => {
                const newMonth = new Date(month);
                newMonth.setMonth(parseInt(value));
                handleMonthChange(newMonth);
              }}
            >
              <SelectTrigger className="h-8 w-[120px] text-sm">
                <SelectValue>{months[month.getMonth()]}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {months.map((monthName, index) => (
                  <SelectItem key={monthName} value={index.toString()}>
                    {monthName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={month.getFullYear().toString()}
              onValueChange={(value) => {
                const newMonth = new Date(month);
                newMonth.setFullYear(parseInt(value));
                handleMonthChange(newMonth);
              }}
            >
              <SelectTrigger className="h-8 w-[90px] text-sm">
                <SelectValue>{month.getFullYear()}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[200px] overflow-y-auto">
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            month={month}
            onMonthChange={handleMonthChange}
            initialFocus
            className="p-0"
            captionLayout="label"
            classNames={{
              months:
                "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
              month: "space-y-4",
              caption: "hidden",
              caption_label: "hidden",
              caption_dropdowns: "hidden",
              nav: "hidden",
              nav_button: "hidden",
              nav_button_previous: "hidden",
              nav_button_next: "hidden",
              table: "w-full border-collapse space-y-1",
              head_row: "flex",
              head_cell:
                "text-gray-500 rounded-md w-9 font-normal text-[0.8rem]",
              row: "flex w-full mt-2",
              cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-gray-100/50 [&:has([aria-selected])]:bg-gray-100 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
              day: cn(
                "h-9 w-9 p-0 font-normal aria-selected:opacity-100 hover:bg-gray-100 rounded-md transition-colors",
              ),
              day_selected:
                "bg-brand-purple text-white hover:bg-brand-purple hover:text-white focus:bg-brand-purple focus:text-white",
              day_today: "bg-gray-100 text-brand-purple font-semibold",
              day_outside:
                "day-outside text-gray-400 opacity-50 aria-selected:bg-gray-100/50 aria-selected:text-gray-400 aria-selected:opacity-30",
              day_disabled: "text-gray-400 opacity-50",
              day_range_middle:
                "aria-selected:bg-gray-100 aria-selected:text-brand-purple",
              day_hidden: "invisible",
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
