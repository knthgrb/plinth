"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import {
  AlertTriangle,
  ClipboardCheck,
  FileWarning,
  Search,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildAdminApprovalQueues,
  type AdminApprovalRow,
} from "@/lib/leave/admin-workspace";
import {
  LeaveReviewDrawer,
  type LeaveReviewSelection,
} from "./leave-review-drawer";

type QueueStatus = "pending" | "cancellation_requested";

function formatDateRange(startDate: number, endDate: number): string {
  const formatter = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
  const start = formatter.format(startDate);
  const end = formatter.format(endDate);
  return start === end ? start : `${start} – ${end}`;
}

export function LeaveApprovalInbox(props: {
  organizationId: Id<"organizations">;
  reviewer: { displayName: string; role: "owner" | "admin" | "hr" };
  signatureRequired: boolean;
}) {
  const [status, setStatus] = useState<QueueStatus>("pending");
  const [search, setSearch] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selection, setSelection] = useState<LeaveReviewSelection | null>(null);
  const pending = usePaginatedQuery(
    api.leave.getLeaveApprovalInbox,
    { organizationId: props.organizationId, status: "pending" },
    { initialNumItems: 20 },
  );
  const cancellations = usePaginatedQuery(
    api.leave.getLeaveApprovalInbox,
    { organizationId: props.organizationId, status: "cancellation_requested" },
    { initialNumItems: 20 },
  );
  const source = status === "pending" ? pending : cancellations;
  const rows = useMemo<AdminApprovalRow[]>(
    () =>
      source.results.map((request) => ({
        id: String(request._id),
        status:
          request.status === "cancellation_requested"
            ? "cancellation_requested"
            : "pending",
        employeeName: request.employeeName,
        policyName: request.policyName,
        startDate: request.requestedStart ?? request.startDate,
        endDate: request.requestedEnd ?? request.endDate,
        filedDate: request.filedDate,
        reason: request.reason,
        confidentiality: request.confidentiality,
        hasSensitiveAccess: request.hasSensitiveAccess,
        requiredDocumentCount: request.requiredDocumentCount,
        submittedDocumentCount: request.submittedDocumentCount,
        hasConflict: request.hasConflict,
      })),
    [source.results],
  );
  const queues = buildAdminApprovalQueues(rows);
  const filtered = (
    status === "pending" ? queues.pending : queues.cancellations
  ).filter((row) => {
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      row.employeeName.toLowerCase().includes(term) ||
      row.policyName.toLowerCase().includes(term);
    const matchesPolicy = !policyFilter || row.policyName === policyFilter;
    const matchesDate =
      !dateFilter ||
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
        row.startDate,
      ) === dateFilter;
    return matchesSearch && matchesPolicy && matchesDate;
  });

  return (
    <>
      <Card className="border-[rgb(230,230,230)] shadow-sm">
        <CardHeader className="space-y-4 border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-5 w-5 text-brand-purple" />{" "}
                Approval inbox
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Final leave decisions and employee cancellation requests.
              </p>
            </div>
            <div className="flex gap-2">
              {queues.evidence.length > 0 ? (
                <Badge variant="secondary">
                  <FileWarning className="mr-1 h-3 w-3" />{" "}
                  {queues.evidence.length} evidence
                </Badge>
              ) : null}
              {queues.conflicts.length > 0 ? (
                <Badge variant="secondary">
                  <AlertTriangle className="mr-1 h-3 w-3" />{" "}
                  {queues.conflicts.length} conflicts
                </Badge>
              ) : null}
            </div>
          </div>
          <Tabs
            value={status}
            onValueChange={(value) => setStatus(value as QueueStatus)}
          >
            <TabsList>
              <TabsTrigger value="pending">
                Pending ({pending.results.length})
              </TabsTrigger>
              <TabsTrigger value="cancellation_requested">
                Cancellations ({cancellations.results.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_220px_170px]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee or policy"
                className="pl-9"
              />
            </div>
            <select
              value={policyFilter}
              onChange={(event) => setPolicyFilter(event.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">All policies</option>
              {[...new Set(rows.map((row) => row.policyName))]
                .sort()
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
            <Input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              aria-label="Filter by start date"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No requests match this queue.
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() =>
                    setSelection({
                      requestId: row.id as Id<"leaveRequests">,
                      employeeName: row.employeeName,
                      policyName: row.policyName,
                      confidentiality: row.confidentiality ?? "standard",
                      hasSensitiveAccess: row.hasSensitiveAccess === true,
                      status: row.status,
                    })
                  }
                  className="grid w-full gap-3 p-4 text-left transition-colors hover:bg-muted/30 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:items-center"
                >
                  <div>
                    <p className="font-medium">{row.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      Filed{" "}
                      {new Intl.DateTimeFormat("en-PH", {
                        month: "short",
                        day: "numeric",
                        timeZone: "Asia/Manila",
                      }).format(row.filedDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm">
                      {row.confidentiality === "restricted"
                        ? "Protected leave"
                        : row.policyName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateRange(row.startDate, row.endDate)}
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit capitalize">
                    {row.status.replaceAll("_", " ")}
                  </Badge>
                </button>
              ))}
            </div>
          )}
          {source.status === "CanLoadMore" ? (
            <div className="border-t p-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => source.loadMore(20)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <LeaveReviewDrawer
        selection={selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        reviewer={props.reviewer}
        signatureRequired={props.signatureRequired}
      />
    </>
  );
}
