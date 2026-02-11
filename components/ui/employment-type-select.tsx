"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/utils";

export type EmploymentType = "probationary" | "regular" | "contractual" | "part-time";

interface EmploymentTypeSelectProps {
  value?: EmploymentType;
  onValueChange: (value: EmploymentType) => void;
  disabled?: boolean;
}

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "probationary", label: "Probationary" },
  { value: "regular", label: "Regular" },
  { value: "contractual", label: "Contractual" },
  { value: "part-time", label: "Part-time" },
];

export function EmploymentTypeSelect({
  value,
  onValueChange,
  disabled = false,
}: EmploymentTypeSelectProps) {
  const [open, setOpen] = useState(false);

  const selectedType = EMPLOYMENT_TYPES.find((type) => type.value === value);

  const handleSelect = (typeValue: EmploymentType) => {
    onValueChange(typeValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9"
          disabled={disabled}
        >
          <span className={cn(value ? "text-[rgb(64,64,64)]" : "text-gray-500")}>
            {selectedType ? selectedType.label : "Select employment type..."}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start" sideOffset={4}>
        <div className="p-1">
          <div className="max-h-[200px] overflow-y-auto">
            <div className="space-y-1">
              {EMPLOYMENT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => handleSelect(type.value)}
                  className={cn(
                    "w-full flex items-center px-3 py-2 text-sm rounded-md hover:bg-gray-100 transition-colors text-left",
                    value === type.value && "bg-gray-100"
                  )}
                >
                  <span className="flex-1">{type.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
