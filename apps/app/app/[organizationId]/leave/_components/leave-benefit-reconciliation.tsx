"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { HeartHandshake } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

type AmountDraft = {
  externalBenefitAmount: string;
  salaryDifferentialAmount: string;
  reimbursedAmount: string;
};

const emptyDraft: AmountDraft = {
  externalBenefitAmount: "",
  salaryDifferentialAmount: "",
  reimbursedAmount: "",
};

function currency(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);
}

export function LeaveBenefitReconciliation(props: {
  organizationId: Id<"organizations">;
}) {
  const { toast } = useToast();
  const result = useQuery(api.leaveBenefitPayroll.getBenefitReconciliationQueue, {
    organizationId: props.organizationId,
  });
  const save = useMutation(api.leaveBenefitPayroll.saveBenefitReconciliation);
  const [editingId, setEditingId] = useState<Id<"leaveRequests"> | null>(null);
  const [draft, setDraft] = useState<AmountDraft>(emptyDraft);
  const [isSaving, setIsSaving] = useState(false);

  const edit = (row: NonNullable<typeof result>["rows"][number]) => {
    setEditingId(row.leaveRequestId);
    setDraft({
      externalBenefitAmount: String(row.externalBenefitAmount),
      salaryDifferentialAmount: String(row.salaryDifferentialAmount),
      reimbursedAmount: String(row.reimbursedAmount),
    });
  };

  const submit = async () => {
    if (!editingId) return;
    const externalBenefitAmount = Number(draft.externalBenefitAmount);
    const salaryDifferentialAmount = Number(draft.salaryDifferentialAmount);
    const reimbursedAmount = Number(draft.reimbursedAmount);
    setIsSaving(true);
    try {
      await save({
        organizationId: props.organizationId,
        leaveRequestId: editingId,
        employerAdvanceAmount:
          externalBenefitAmount + salaryDifferentialAmount,
        externalBenefitAmount,
        salaryDifferentialAmount,
        reimbursedAmount,
      });
      setEditingId(null);
      setDraft(emptyDraft);
      toast({ title: "Benefit reconciliation updated" });
    } catch (error: unknown) {
      toast({
        title: "Unable to update reconciliation",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-[rgb(230,230,230)] shadow-sm">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshake className="h-5 w-5 text-brand-purple" /> Statutory
          benefit reconciliation
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Track the employer advance, external benefit, salary differential,
          and reimbursement separately from ordinary leave pay.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {result === undefined ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading benefit reconciliations…</p>
        ) : !result.hasSensitiveAccess ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            An active sensitive-leave access grant is required to view protected benefit records.
          </p>
        ) : result.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No approved benefit-supported leave requires reconciliation.
          </p>
        ) : (
          <div className="divide-y">
            {result.rows.map((row) => (
              <div key={row._id} className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      Expected {currency(row.expectedGrossBenefitAmount)} · Advanced {currency(row.employerAdvanceAmount)} · Reimbursed {currency(row.reimbursedAmount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{row.status.replaceAll("_", " ")}</Badge>
                    <Button size="sm" variant="outline" onClick={() => edit(row)}>Reconcile</Button>
                  </div>
                </div>
                {editingId === row.leaveRequestId ? (
                  <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-4">
                    {(
                      [
                        ["externalBenefitAmount", "External benefit"],
                        ["salaryDifferentialAmount", "Salary differential"],
                        ["reimbursedAmount", "Amount reimbursed"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`${row._id}-${key}`}>{label}</Label>
                        <Input
                          id={`${row._id}-${key}`}
                          inputMode="decimal"
                          value={draft[key]}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, [key]: event.target.value }))
                          }
                        />
                      </div>
                    ))}
                    <div className="flex gap-2 md:col-span-4 md:justify-end">
                      <Button variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                      <Button disabled={isSaving} onClick={() => void submit()}>{isSaving ? "Saving…" : "Save reconciliation"}</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
