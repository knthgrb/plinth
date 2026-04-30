"use client";

import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { getNotificationTimeMeta } from "./notification-time";

export type NotificationRowType =
  | "leave_submitted"
  | "leave_approved"
  | "leave_rejected"
  | "payslip_ready"
  | string;

function iconForType(type: NotificationRowType) {
  switch (type) {
    case "leave_submitted":
      return CalendarDays;
    case "leave_approved":
      return CheckCircle2;
    case "leave_rejected":
      return XCircle;
    case "payslip_ready":
      return Banknote;
    default:
      return CalendarDays;
  }
}

type NotificationRowProps = {
  type: NotificationRowType;
  title: string;
  body?: string;
  read: boolean;
  createdAt: number;
  onClick: () => void;
  /** Slightly tighter padding in the bell popover */
  compact?: boolean;
};

export function NotificationRow({
  type,
  title,
  body,
  read,
  createdAt,
  onClick,
  compact,
}: NotificationRowProps) {
  const Icon = iconForType(type);
  const { relative, absolute } = getNotificationTimeMeta(createdAt);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex w-full gap-3 rounded-xl text-left transition-colors",
          compact ? "p-2.5" : "p-3.5",
          "hover:bg-slate-100/80",
          !read && "bg-slate-50/90",
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            "bg-slate-100 text-slate-600",
            "group-hover:bg-slate-200/80",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "text-sm leading-snug text-slate-800",
                !read && "font-semibold",
                read && "font-medium",
              )}
            >
              {title}
            </p>
            <time
              className="shrink-0 text-xs text-slate-400"
              dateTime={new Date(createdAt).toISOString()}
            >
              {relative}
            </time>
          </div>
          {body ? (
            <p className="mt-0.5 line-clamp-2 text-sm font-normal text-slate-500">
              {body}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-400">{absolute}</p>
        </div>
        {!read && (
          <span
            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-500"
            aria-label="Unread"
          />
        )}
      </button>
    </div>
  );
}
