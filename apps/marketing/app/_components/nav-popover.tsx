"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/utils/utils";

type NavPopoverItem = {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
};

type NavPopoverProps = {
  label: string;
  sectionTitle: string;
  items: NavPopoverItem[];
  popoverId: string;
  isOpen: boolean;
  onActivate: (id: string) => void;
  onDeactivate: (id: string) => void;
  className?: string;
};

const LEAVE_DELAY_MS = 180;

export function NavPopover({
  label,
  sectionTitle,
  items,
  popoverId,
  isOpen,
  onActivate,
  onDeactivate,
  className,
}: NavPopoverProps) {
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeaveTimeout = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  };

  const handleEnter = () => {
    clearLeaveTimeout();
    onActivate(popoverId);
  };

  const handleLeave = () => {
    clearLeaveTimeout();
    leaveTimeoutRef.current = setTimeout(() => {
      onDeactivate(popoverId);
      leaveTimeoutRef.current = null;
    }, LEAVE_DELAY_MS);
  };

  return (
    <Popover open={isOpen}>
      <div
        className={cn("relative", className)}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-0.5 text-[15px] font-medium text-gray-700 hover:text-gray-900 transition-colors outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          >
            {label}
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "min-w-[520px] w-[560px] max-w-[90vw] p-0 rounded-2xl border-0 shadow-lg bg-white",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="p-4 pb-3">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-4">
              {sectionTitle}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="group flex gap-3 rounded-lg p-2 -m-2 transition-colors hover:bg-gray-50"
                  onClick={() => onDeactivate(popoverId)}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 group-hover:bg-brand-purple/10 group-hover:text-brand-purple">
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{item.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                      {item.description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </PopoverContent>
      </div>
    </Popover>
  );
}
