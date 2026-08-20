"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import type { LeavePolicyRules } from "@/lib/leave/types";
import {
  buildCompanyPolicyQuickStart,
  type CompanyPolicyQuickStart,
  validatePolicyVersionDraft,
} from "@/lib/leave/client-state";

export function LeavePolicyCreateDialog(props: {
  organizationId: Id<"organizations">;
  companyModel: "pooled" | "by_type";
  scheduledModel?: {
    mode: "pooled" | "by_type";
    effectiveStart: number;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const createPolicy = useMutation(api.leavePolicies.createCompanyLeavePolicy);
  const [name, setName] = useState("");
  const [quickStart, setQuickStart] = useState<CompanyPolicyQuickStart>("custom");
  const [entitlementMethod, setEntitlementMethod] = useState<
    "annual" | "anniversary"
  >("annual");
  const [eligibilityBasis, setEligibilityBasis] = useState<
    "hire_date" | "regularization_date"
  >("hire_date");
  const [completedServiceMonths, setCompletedServiceMonths] = useState(0);
  const [annualUnits, setAnnualUnits] = useState("5");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectQuickStart = (kind: CompanyPolicyQuickStart) => {
    const draft = buildCompanyPolicyQuickStart(kind);
    setQuickStart(kind);
    setName(draft.name);
    setEntitlementMethod(draft.entitlementMethod);
    setAnnualUnits(String(draft.annualUnits));
    setEligibilityBasis(draft.eligibilityBasis);
    setCompletedServiceMonths(draft.completedServiceMonths);
  };

  const save = async () => {
    const validation = validatePolicyVersionDraft({ effectiveDate, reason });
    const units = Number(annualUnits);
    const effectiveStart = Date.parse(`${effectiveDate}T00:00:00+08:00`);
    const mode =
      props.scheduledModel &&
      effectiveStart >= props.scheduledModel.effectiveStart
        ? props.scheduledModel.mode
        : props.companyModel;
    if (!name.trim() || !Number.isFinite(units) || units < 0 || !validation.valid) {
      toast({
        title: "Company policy is incomplete",
        description: !name.trim()
          ? "Policy name is required"
          : !Number.isFinite(units) || units < 0
            ? "Annual entitlement must be a non-negative number"
            : validation.valid
              ? "Review the policy fields"
              : validation.message,
        variant: "destructive",
      });
      return;
    }
    const rules: LeavePolicyRules = {
      accountBehavior: mode === "pooled" ? "shared_pool" : "individual_account",
      ...(mode === "pooled" ? { poolKey: "company_leave" } : {}),
      payTreatment: "company_paid",
      durationBasis: "scheduled_work",
      entitlementMethod,
      annualUnits: units,
      eligibility: { basis: eligibilityBasis, completedServiceMonths },
      prorationMethod:
        entitlementMethod === "anniversary" ? "none" : "calendar_months",
      roundingIncrement: 0.5,
      carryover: { mode: "none" },
      conversion: { allowed: false },
    };
    setIsSaving(true);
    try {
      await createPolicy({
        organizationId: props.organizationId,
        name: name.trim(),
        sourceKey: name,
        effectiveStart,
        changeReason: reason.trim(),
        rules,
      });
      toast({ title: "Company leave policy created" });
      props.onOpenChange(false);
    } catch (error: unknown) {
      toast({
        title: "Unable to create company leave policy",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add company leave policy</DialogTitle>
          <DialogDescription>
            The organization model automatically determines whether this policy
            uses the shared pool or a separate balance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Start from</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["vacation", "Vacation"],
                ["sick", "Sick"],
                ["custom", "Custom"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={quickStart === value}
                  onClick={() => selectQuickStart(value)}
                  className={`rounded-lg border p-2 text-sm ${
                    quickStart === value
                      ? "border-brand-purple bg-brand-purple/5"
                      : "hover:bg-muted/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-policy-name">Policy name</Label>
            <Input
              id="new-policy-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Vacation Leave"
            />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <span className="font-medium">
              {props.companyModel === "pooled"
                ? "Shared annual pool"
                : "Separate balance by leave type"}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              Account behavior follows the organization model effective on the
              policy start date.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-policy-units">Annual days</Label>
              <p className="text-xs text-muted-foreground">
                {entitlementMethod === "anniversary"
                  ? "Maximum service-anniversary days granted in a policy year."
                  : "Yearly entitlement before any configured proration."}
              </p>
              <Input
                id="new-policy-units"
                type="number"
                min="0"
                step="0.5"
                value={annualUnits}
                onChange={(event) => setAnnualUnits(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-policy-effective">Effective date</Label>
              <Input
                id="new-policy-effective"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </div>
          </div>
          {entitlementMethod === "anniversary" ? (
            <div className="space-y-2">
              <Label>Service anniversary starts from</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["hire_date", "Hire date"],
                  ["regularization_date", "Regularization date"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={eligibilityBasis === value}
                    onClick={() => setEligibilityBasis(value)}
                    className={`rounded-lg border p-3 text-left text-sm ${
                      eligibilityBasis === value
                        ? "border-brand-purple bg-brand-purple/5"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <span className="font-medium">{label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                One day is granted per completed service year, beginning on the
                first anniversary and capped by the annual days above.
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="new-policy-reason">Setup reason</Label>
            <Textarea
              id="new-policy-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Describe the company policy approval"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isSaving} onClick={save}>
              {isSaving ? "Creating…" : "Create policy"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
