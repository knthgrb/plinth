"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  CalendarCheck2,
  Clock3,
  FileClock,
  CalendarPlus,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  buildEmployeeLeaveDashboardModel,
  type EmployeeLeaveCardModel,
  type EmployeeLeaveDashboardData,
  type EmployeeLeavePolicyOption,
  type EmployeeLeaveRequestSummary,
} from "@/lib/leave/employee-workspace";
import { LeaveRequestDrawer } from "./leave-request-drawer";
import {
  LeaveRequestTimeline,
  type EmployeeLeaveTimelineRequest,
} from "./leave-request-timeline";

function formatUnits(value: number): string {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(
    value,
  );
}

function BalanceCard({ balance }: { balance: EmployeeLeaveCardModel }) {
  return (
    <Card className="border-[rgb(230,230,230)] shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {balance.label}
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">
              {formatUnits(balance.available)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                days available
              </span>
            </p>
          </div>
          <WalletCards className="h-5 w-5 text-brand-purple" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 border-t pt-4 text-xs">
          <div>
            <p className="text-muted-foreground">Granted</p>
            <p className="mt-1 font-semibold">{formatUnits(balance.granted)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Reserved</p>
            <p className="mt-1 font-semibold">{formatUnits(balance.reserved)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Used</p>
            <p className="mt-1 font-semibold">{formatUnits(balance.used)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmployeeLeaveDashboard(props: {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [referenceTime] = useState(() => Date.now());
  const dashboardResult = useQuery(api.leave.getMyLeaveDashboard, {
    organizationId: props.organizationId,
  });
  const requestsResult = usePaginatedQuery(
    api.leave.getMyLeaveRequests,
    { organizationId: props.organizationId },
    { initialNumItems: 20 },
  );

  const dashboard = dashboardResult as EmployeeLeaveDashboardData | undefined;
  const requests = useMemo<EmployeeLeaveRequestSummary[]>(
    () =>
      requestsResult.results.map((request) => ({
        id: String(request._id),
        policyId: request.policyId ? String(request.policyId) : undefined,
        status: request.status,
        startDate: request.requestedStart ?? request.startDate,
        endDate: request.requestedEnd ?? request.endDate,
        filedDate: request.filedDate,
        chargeableDuration:
          request.chargeableDuration ?? request.numberOfDays,
        reason: request.reason,
        payTreatment: request.payTreatment,
        decisionReason: request.decisionReason,
        reviewedAt: request.reviewedAt,
        cancellationReason: request.cancellationReason,
      })),
    [requestsResult.results],
  );
  const model = useMemo(
    () =>
      dashboard
        ? buildEmployeeLeaveDashboardModel({
            dashboard,
            requests,
            now: referenceTime,
          })
        : null,
    [dashboard, referenceTime, requests],
  );
  const policyOptions = useMemo<EmployeeLeavePolicyOption[]>(
    () =>
      (dashboard?.policies ?? []).map((policy) => ({
        policyId: policy.policyId as Id<"leavePolicies">,
        name: policy.name,
        category: policy.category,
        confidentiality: policy.confidentiality,
        allowHalfDay: false,
        allowHourly: false,
      })),
    [dashboard?.policies],
  );

  if (!model || requestsResult.status === "LoadingFirstPage") {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const timelineRequests: EmployeeLeaveTimelineRequest[] = model.recent.map(
    (request) => ({ ...request, id: request.id }),
  );

  return (
    <div className="space-y-7 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-purple">Employee workspace</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[rgb(64,64,64)]">
            My leave
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan time away, review balances, and track every request.
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)} className="sm:self-end">
          <CalendarPlus className="mr-2 h-4 w-4" /> Request leave
        </Button>
      </div>

      <section aria-labelledby="leave-balance-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="leave-balance-heading" className="text-base font-semibold">
              Available leave
            </h2>
            <p className="text-sm text-muted-foreground">
              Current {model.year} balances already include pending reservations.
            </p>
          </div>
          {model.pendingRequestCount > 0 ? (
            <Badge variant="secondary">
              {model.pendingRequestCount} pending
            </Badge>
          ) : null}
        </div>
        {model.companyBalances.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-sm text-muted-foreground">
              No company leave balance is available yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {model.companyBalances.map((balance) => (
              <BalanceCard key={balance.id} balance={balance} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)]">
        <Card className="border-[rgb(230,230,230)] shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Request history</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Status changes, reviewer decisions, and available actions.
              </p>
            </div>
            <FileClock className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <LeaveRequestTimeline
              organizationId={props.organizationId}
              requests={timelineRequests}
            />
            {requestsResult.status === "CanLoadMore" ? (
              <Button
                type="button"
                variant="outline"
                className="mt-4 w-full"
                onClick={() => requestsResult.loadMore(20)}
              >
                Load older requests
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-[rgb(230,230,230)] shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarCheck2 className="h-4 w-4 text-brand-purple" />
                Upcoming approved leave
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {model.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approved leave is coming up.
                </p>
              ) : (
                model.upcoming.slice(0, 4).map((request) => (
                  <div key={request.id} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">{request.policyLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("en-PH", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "Asia/Manila",
                      }).format(request.startDate)}
                      {request.endDate !== request.startDate
                        ? ` – ${new Intl.DateTimeFormat("en-PH", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "Asia/Manila",
                          }).format(request.endDate)}`
                        : ""}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-[rgb(230,230,230)] shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-brand-purple" />
                Statutory leave
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {model.statutoryPolicies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Qualified statutory benefits appear here when available.
                </p>
              ) : (
                model.statutoryPolicies.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                    <div>
                      <p className="text-sm font-medium">{policy.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Eligibility and evidence are verified privately.
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatUnits(policy.available)} days
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-brand-purple/20 bg-brand-purple/5 p-4 text-sm">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-brand-purple" />
            <p className="text-muted-foreground">
              Dates and chargeable time are calculated from your work schedule,
              rest days, and Philippine holiday setup before you submit.
            </p>
          </div>
        </div>
      </div>

      <LeaveRequestDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        organizationId={props.organizationId}
        employeeId={props.employeeId}
        policies={policyOptions}
      />
    </div>
  );
}
