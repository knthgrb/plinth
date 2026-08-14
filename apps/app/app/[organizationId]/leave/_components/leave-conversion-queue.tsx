"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Banknote, CheckCircle2, XCircle } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { buildConversionQueueRows } from "@/lib/leave/admin-workspace";

export function LeaveConversionQueue(props: {
  organizationId: Id<"organizations">;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"all" | "pending" | "approved">("all");
  const [search, setSearch] = useState("");
  const approve = useMutation(api.leaveConversions.approveLeaveConversion);
  const cancel = useMutation(api.leaveConversions.cancelLeaveConversion);
  const queue = useQuery(api.leaveConversions.getLeaveConversionQueue, {
    organizationId: props.organizationId,
    status: status === "all" ? undefined : status,
  });
  const rows = useMemo(
    () =>
      buildConversionQueueRows(
        (queue ?? []).map((row) => ({
          id: String(row._id),
          employeeName: row.employeeName,
          policyName: row.policyName,
          requestedDays: row.requestedDays,
          status: row.status,
          paymentStatus: row.paymentStatus,
          settlementContext: row.finalSettlementId
            ? "final_settlement"
            : row.payrollRunId
              ? "payroll"
              : undefined,
        })),
      ).filter((row) => {
        const term = search.trim().toLowerCase();
        return (
          !term ||
          row.employeeName.toLowerCase().includes(term) ||
          row.policyName.toLowerCase().includes(term)
        );
      }),
    [queue, search],
  );

  const approveRow = async (id: string) => {
    try {
      await approve({
        organizationId: props.organizationId,
        conversionRequestId: id as Id<"leaveConversionRequests">,
      });
      toast({ title: "Leave conversion approved" });
    } catch (error: unknown) {
      toast({
        title: "Unable to approve conversion",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const cancelRow = async (id: string) => {
    try {
      await cancel({
        organizationId: props.organizationId,
        conversionRequestId: id as Id<"leaveConversionRequests">,
        reason: "Cancelled from leave conversion queue",
      });
      toast({ title: "Leave conversion cancelled" });
    } catch (error: unknown) {
      toast({
        title: "Unable to cancel conversion",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-[rgb(230,230,230)] shadow-sm">
      <CardHeader className="space-y-4 border-b">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="h-5 w-5 text-brand-purple" /> Leave conversion
            queue
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Review conversion liabilities and follow them through payroll or
            final settlement.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[220px_minmax(220px,1fr)]">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
          </select>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search employee or policy"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {queue === undefined ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Loading conversion queue…
          </p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No leave conversions match this view.
          </p>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_100px_minmax(180px,0.8fr)_auto] sm:items-center"
              >
                <div>
                  <p className="font-medium">{row.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.policyName}
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  {row.requestedDays} days
                </p>
                <div>
                  <Badge variant="outline">{row.workflowLabel}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.paymentLabel}
                  </p>
                </div>
                <div className="flex gap-2">
                  {row.status === "pending" ? (
                    <Button size="sm" onClick={() => void approveRow(row.id)}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                  ) : null}
                  {row.status !== "paid" && row.status !== "cancelled" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void cancelRow(row.id)}
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" /> Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
