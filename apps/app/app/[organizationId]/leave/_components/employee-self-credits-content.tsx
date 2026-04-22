"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Info } from "lucide-react";
import { cn } from "@/utils/utils";

type GeneralLeave = {
  proratedSil: number;
  anniversaryLeave: number;
  usedCombined: number;
  available: number;
  annualSilBase: number;
};

type Calculations = {
  proratedLeave: number;
  anniversaryLeave: number;
  totalEntitlement: number;
};

interface EmployeeSelfCreditsContentProps {
  leaveTrackerMode: "general" | "by_type";
  employeeLeaveCredits: {
    enableAnniversaryLeave?: boolean;
    calculations?: Calculations;
    generalLeave?: GeneralLeave;
    byTypeLeaves?: Array<{
      type: string;
      name: string;
      cap: number;
      used: number;
      balance: number;
    }>;
  } | null;
}

export function EmployeeSelfCreditsContent({
  leaveTrackerMode,
  employeeLeaveCredits,
}: EmployeeSelfCreditsContentProps) {
  if (!employeeLeaveCredits) {
    return (
      <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-12 text-center text-sm text-[rgb(133,133,133)]">
        Loading your leave summary…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[rgb(90,90,90)] max-w-2xl leading-relaxed">
        See what you are entitled to, what is already on leave requests, and how
        many days you can still file. Filing a request uses your vacation
        balance first, then sick, where applicable.
      </p>

      {leaveTrackerMode === "general" && employeeLeaveCredits.generalLeave && (
        <Card className="border-[rgb(230,230,230)] shadow-sm overflow-hidden">
          <CardHeader className="pb-2 pt-6 border-b border-[rgb(240,240,240)] bg-gradient-to-b from-[rgb(252,252,255)] to-white">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-[rgb(64,64,64)]">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-purple/10 text-brand-purple shadow-sm">
                <Calendar className="h-5 w-5" />
              </span>
              Your service incentive leave (SIL) balance
            </CardTitle>
            <p className="text-xs text-[rgb(133,133,133)] mt-2 pl-0 sm:pl-12">
              This pool combines prorated SIL and any anniversary day your org
              adds. What you can file is what is still unused.
            </p>
          </CardHeader>
          <CardContent className="space-y-5 pb-6 pt-5">
            {(() => {
              const g = employeeLeaveCredits.generalLeave;
              const used = Number(g.usedCombined) || 0;
              const available = Number(g.available) || 0;
              const totalUse = used + available;
              const usedPct = totalUse > 0 ? (used / totalUse) * 100 : 0;
              const ent = employeeLeaveCredits.calculations?.totalEntitlement;
              return (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-[rgb(133,133,133)]">
                        Available to file now
                      </p>
                      <p className="text-3xl sm:text-4xl font-bold tracking-tight text-brand-purple tabular-nums">
                        {available.toFixed(2)}
                        <span className="text-lg font-semibold text-[rgb(100,100,100)] ml-1.5">
                          days
                        </span>
                      </p>
                    </div>
                    {ent != null && (
                      <div className="text-right text-sm text-[rgb(133,133,133)]">
                        Total entitlement
                        <span className="block text-lg font-semibold text-[rgb(64,64,64)] tabular-nums">
                          {Number(ent).toFixed(2)} days
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-[rgb(235,235,240)]">
                      {totalUse > 0 && (
                        <>
                          <div
                            className="h-full bg-amber-400/90 transition-all"
                            style={{ width: `${usedPct}%` }}
                            title={`Used: ${used.toFixed(2)} days`}
                          />
                          <div
                            className="h-full bg-brand-purple transition-all"
                            style={{ width: `${100 - usedPct}%` }}
                            title={`Available: ${available.toFixed(2)} days`}
                          />
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-[rgb(120,120,120)]">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full bg-amber-400"
                          aria-hidden
                        />
                        Used on approved / pending leave: {used.toFixed(2)} days
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full bg-brand-purple"
                          aria-hidden
                        />
                        Still available: {available.toFixed(2)} days
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-[rgb(240,240,240)] bg-[rgb(250,250,252)] p-4 text-sm">
                    <div className="flex justify-between sm:flex-col sm:gap-0.5">
                      <span className="text-[rgb(133,133,133)]">
                        Prorated SIL (in pool)
                      </span>
                      <span className="font-medium text-[rgb(64,64,64)] tabular-nums">
                        {Number(g.proratedSil).toFixed(2)} days
                      </span>
                    </div>
                    {employeeLeaveCredits.enableAnniversaryLeave && (
                      <div className="flex justify-between sm:flex-col sm:gap-0.5">
                        <span className="text-[rgb(133,133,133)]">
                          Anniversary in pool
                        </span>
                        <span className="font-medium text-[rgb(64,64,64)] tabular-nums">
                          {Number(g.anniversaryLeave).toFixed(2)} days
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between sm:flex-col sm:gap-0.5 sm:col-span-2 border-t border-[rgb(230,230,235)] pt-3">
                      <span className="text-[rgb(133,133,133)]">
                        Used (vacation + sick from pool)
                      </span>
                      <span className="font-medium text-[rgb(64,64,64)] tabular-nums">
                        {used.toFixed(2)} days
                      </span>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex gap-2 rounded-lg border border-[rgb(240,240,250)]",
                      "bg-[rgb(248,248,255)] px-3 py-2.5 text-xs text-[rgb(90,90,100)]",
                    )}
                  >
                    <Info
                      className="h-4 w-4 shrink-0 text-brand-purple mt-0.5"
                      aria-hidden
                    />
                    <p>
                      Annual SIL base in your org:{" "}
                      <span className="font-medium text-[rgb(64,64,64)]">
                        {g.annualSilBase} days
                      </span>
                      . New requests use vacation (annual) first, then sick
                      leave from this pool.
                    </p>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {employeeLeaveCredits.calculations && (
        <Card className="border-[rgb(230,230,230)] shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
              How your entitlement is calculated
            </CardTitle>
            <p className="text-xs text-[rgb(133,133,133)] mt-1 max-w-2xl">
              {leaveTrackerMode === "general"
                ? "This matches the general leave tracker: prorated SIL (from hire and policy) plus any anniversary day when that option is on."
                : "Totals come from your org’s leave type caps (each can be prorated) plus any anniversary add-on."}
            </p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between text-[rgb(64,64,64)]">
              <span className="text-[rgb(133,133,133)]">
                {leaveTrackerMode === "general"
                  ? "Prorated SIL"
                  : "Leave types (prorated) total"}
              </span>
              <span className="font-medium tabular-nums">
                {Number(employeeLeaveCredits.calculations.proratedLeave).toFixed(2)} days
              </span>
            </div>
            {employeeLeaveCredits.enableAnniversaryLeave ? (
              <div className="flex justify-between text-[rgb(64,64,64)]">
                <span className="text-[rgb(133,133,133)]">Anniversary leave</span>
                <span className="font-medium tabular-nums">
                  {Number(employeeLeaveCredits.calculations.anniversaryLeave).toFixed(2)} days
                </span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-[rgb(230,230,230)] pt-3">
              <span className="font-medium text-[rgb(64,64,64)]">
                Total entitlement
              </span>
              <span className="font-semibold text-brand-purple tabular-nums">
                {Number(employeeLeaveCredits.calculations.totalEntitlement).toFixed(2)} days
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {leaveTrackerMode === "by_type" &&
        Array.isArray(employeeLeaveCredits.byTypeLeaves) && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[rgb(64,64,64)]">
              By leave type
            </h3>
            {employeeLeaveCredits.byTypeLeaves.length === 0 ? (
              <p className="text-sm text-[rgb(133,133,133)]">
                No leave types are configured yet. Your HR team can set these in
                organization settings.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {employeeLeaveCredits.byTypeLeaves.map((row) => {
                  const cap = Number(row.cap) || 0;
                  const usedT = Number(row.used) || 0;
                  const usedOfCap = cap > 0 ? (usedT / cap) * 100 : 0;
                  return (
                    <Card
                      key={row.type}
                      className="border-[rgb(230,230,230)] shadow-sm overflow-hidden"
                    >
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[rgb(64,64,64)]">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple">
                            <Calendar className="h-3.5 w-3.5" />
                          </span>
                          {row.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 pb-5 text-sm">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[rgb(235,235,240)]">
                          {cap > 0 && (
                            <div
                              className="h-full bg-brand-purple/80 rounded-full transition-all"
                              style={{ width: `${usedOfCap}%` }}
                            />
                          )}
                        </div>
                        <div className="flex justify-between text-[rgb(133,133,133)]">
                          <span>Cap (this year)</span>
                          <span className="font-medium text-[rgb(64,64,64)] tabular-nums">
                            {Number(row.cap).toFixed(2)} days
                          </span>
                        </div>
                        <div className="flex justify-between text-[rgb(133,133,133)]">
                          <span>Used</span>
                          <span className="font-medium text-[rgb(64,64,64)] tabular-nums">
                            {Number(row.used).toFixed(2)} days
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-[rgb(230,230,230)] pt-2.5">
                          <span className="font-medium text-[rgb(64,64,64)]">
                            Available
                          </span>
                          <span className="font-semibold text-brand-purple tabular-nums">
                            {Number(row.balance).toFixed(2)} days
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
