"use client";

import { useMemo, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { BookOpenCheck, Plus, Search } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { buildLedgerRows } from "@/lib/leave/admin-workspace";

export interface EmployeeBalanceOption {
  balanceId: Id<"employeeLeaveBalances">;
  employeeName: string;
  policyName: string;
  available: number;
  periodStart?: number;
  periodEnd?: number;
  engineStatus: "open" | "closed" | "reconciliation_required";
}

export function EmployeeBalanceLedger(props: {
  organizationId: Id<"organizations">;
}) {
  const { toast } = useToast();
  const adjust = useMutation(api.leave.adjustLeaveBalance);
  const currentYear = new Date(
    Date.now() + 8 * 60 * 60 * 1_000,
  ).getUTCFullYear();
  const balancesResult = usePaginatedQuery(
    api.leave.getLeaveBalanceAdministration,
    { organizationId: props.organizationId, year: currentYear },
    { initialNumItems: 24 },
  );
  const [search, setSearch] = useState("");
  const [selectedBalance, setSelectedBalance] =
    useState<EmployeeBalanceOption>();
  const [ledgerBalanceId, setLedgerBalanceId] =
    useState<Id<"employeeLeaveBalances">>();
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const ledgerResult = usePaginatedQuery(
    api.leave.getLeaveBalanceLedgerEntries,
    ledgerBalanceId ? { balanceId: ledgerBalanceId } : "skip",
    { initialNumItems: 30 },
  );
  const rows = useMemo(
    () => buildLedgerRows(ledgerResult.results),
    [ledgerResult.results],
  );
  const balances = balancesResult.results.filter((balance) => {
    const term = search.trim().toLowerCase();
    return (
      !term ||
      balance.employeeName.toLowerCase().includes(term) ||
      balance.policyName.toLowerCase().includes(term)
    );
  });

  const close = () => {
    setSelectedBalance(undefined);
    setAmount("");
    setEffectiveDate("");
    setReason("");
  };

  const save = async () => {
    if (!selectedBalance || !amount || !effectiveDate || !reason.trim()) return;
    setIsSaving(true);
    try {
      await adjust({
        balanceId: selectedBalance.balanceId,
        amount: Number(amount),
        effectiveDate: Date.parse(`${effectiveDate}T00:00:00+08:00`),
        reason: reason.trim(),
      });
      toast({ title: "Leave balance adjusted" });
      close();
    } catch (error: unknown) {
      toast({
        title: "Unable to adjust balance",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Card className="border-[rgb(230,230,230)] shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpenCheck className="h-5 w-5 text-brand-purple" /> Employee
            balance ledger
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Audited grants, reservations, usage, adjustments, conversions, and
            expirations.
          </p>
          <div className="relative pt-2">
            <Search className="absolute left-3 top-5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee or policy"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4">
          {balances.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {balances.map((balance) => (
                <div
                  key={balance.balanceId}
                  className={`rounded-xl border p-4 text-left transition-colors hover:border-brand-purple/50 ${ledgerBalanceId === balance.balanceId ? "border-brand-purple bg-brand-purple/5" : ""}`}
                >
                  <p className="font-medium">{balance.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {balance.policyName}
                  </p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <p className="text-2xl font-semibold">
                      {balance.available}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        days
                      </span>
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setLedgerBalanceId(balance.balanceId)}
                      >
                        View ledger
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedBalance(balance)}
                        disabled={balance.engineStatus !== "open"}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Adjust
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Canonical employee balances will appear here when loaded.
            </p>
          )}
          {balancesResult.status === "CanLoadMore" ? (
            <Button
              variant="outline"
              onClick={() => balancesResult.loadMore(24)}
            >
              Load more balances
            </Button>
          ) : null}
          <div className="divide-y overflow-hidden rounded-xl border">
            {rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Select an employee balance to review its append-only ledger.
              </p>
            ) : (
              rows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-2 p-4 text-sm sm:grid-cols-[minmax(150px,0.8fr)_100px_130px_minmax(180px,1fr)]"
                >
                  <div>
                    <p className="font-medium">{row.kindLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.actorLabel}
                    </p>
                  </div>
                  <p className="font-semibold">{row.unitsLabel}</p>
                  <p>{row.dateLabel}</p>
                  <p className="text-muted-foreground">{row.reasonLabel}</p>
                </div>
              ))
            )}
          </div>
          {ledgerResult.status === "CanLoadMore" ? (
            <Button variant="outline" onClick={() => ledgerResult.loadMore(30)}>
              Load more ledger entries
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <Dialog
        open={selectedBalance !== undefined}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust leave balance</DialogTitle>
            <DialogDescription>
              Creates an append-only adjustment. Existing ledger history remains
              unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adjustment-amount">Adjustment in days</Label>
              <Input
                id="adjustment-amount"
                type="number"
                step="0.25"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-date">Effective date</Label>
              <Input
                id="adjustment-date"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-reason">Reason</Label>
            <Textarea
              id="adjustment-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={isSaving || !amount || !effectiveDate || !reason.trim()}
            >
              {isSaving ? "Saving…" : "Record adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
