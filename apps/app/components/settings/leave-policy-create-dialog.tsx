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
import { validatePolicyVersionDraft } from "@/lib/leave/client-state";

export function LeavePolicyCreateDialog(props: {
  organizationId: Id<"organizations">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const createPolicy = useMutation(api.leavePolicies.createCompanyLeavePolicy);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"pooled" | "by_type">("by_type");
  const [annualUnits, setAnnualUnits] = useState("5");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    const validation = validatePolicyVersionDraft({ effectiveDate, reason });
    const units = Number(annualUnits);
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
      entitlementMethod: "annual",
      annualUnits: units,
      eligibility: { basis: "hire_date", completedServiceMonths: 0 },
      prorationMethod: "calendar_months",
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
        effectiveStart: Date.parse(`${effectiveDate}T00:00:00+08:00`),
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
            Create a separate balance or charge this policy to the shared annual pool.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-policy-name">Policy name</Label>
            <Input
              id="new-policy-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Vacation Leave"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["by_type", "pooled"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`rounded-lg border p-3 text-left text-sm ${
                  mode === value ? "border-brand-purple bg-brand-purple/5" : ""
                }`}
              >
                <span className="font-medium">
                  {value === "by_type" ? "Separate balance" : "Shared annual pool"}
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-policy-units">Annual days</Label>
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
