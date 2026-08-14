"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { LeavePolicyVersionRules } from "@/convex/leavePolicies";
import { validatePolicyVersionDraft } from "@/lib/leave/client-state";
import { LeavePolicyImpactDialog } from "./leave-policy-impact-dialog";

function toRules(version: Doc<"leavePolicyVersions">): LeavePolicyVersionRules {
  const roundingIncrement =
    version.roundingIncrement === 0.25 || version.roundingIncrement === 0.5
      ? version.roundingIncrement
      : 1;
  return {
    accountBehavior: version.accountBehavior,
    poolKey: version.poolKey,
    payTreatment: version.payTreatment,
    durationBasis: version.durationBasis,
    entitlementMethod: version.entitlementMethod,
    annualUnits: version.annualUnits,
    eligibility: {
      basis: version.eligibilityBasis,
      completedServiceMonths: version.completedServiceMonths,
    },
    prorationMethod: version.prorationMethod,
    roundingIncrement,
    carryover: {
      mode: version.carryoverMode,
      capUnits: version.carryoverCap,
    },
    conversion: {
      allowed: version.conversionAllowed,
      maxUnits: version.maxConvertibleUnits,
    },
    maximumConsecutiveUnits: version.maximumConsecutiveUnits,
    minimumNoticeDays: version.minimumNoticeDays,
    requiredDocumentRules: version.requiredDocumentRules,
    qualifyingEventRequired: version.qualifyingEventRequired,
    maximumUnitsPerEvent: version.maximumUnitsPerEvent,
    maximumUnitsPerYear: version.maximumUnitsPerYear,
    eventUseWindowDays: version.eventUseWindowDays,
  };
}

export function LeavePolicyEditor(props: {
  organizationId: Doc<"organizations">["_id"];
  policy: Doc<"leavePolicies">;
  currentVersion: Doc<"leavePolicyVersions">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const createVersion = useMutation(api.leavePolicies.createLeavePolicyVersion);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [annualUnits, setAnnualUnits] = useState(
    String(props.currentVersion.annualUnits ?? ""),
  );
  const [conversionAllowed, setConversionAllowed] = useState(
    props.currentVersion.conversionAllowed,
  );
  const [showImpact, setShowImpact] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const rules = useMemo<LeavePolicyVersionRules>(() => {
    const base = toRules(props.currentVersion);
    const parsedAnnualUnits = Number(annualUnits);
    return {
      ...base,
      annualUnits:
        annualUnits.trim() && Number.isFinite(parsedAnnualUnits)
          ? parsedAnnualUnits
          : undefined,
      conversion: {
        ...base.conversion,
        allowed: conversionAllowed,
        maxUnits: conversionAllowed ? base.conversion.maxUnits : undefined,
      },
    };
  }, [annualUnits, conversionAllowed, props.currentVersion]);
  const effectiveStart = effectiveDate
    ? Date.parse(`${effectiveDate}T00:00:00+08:00`)
    : 0;
  const impact = useQuery(
    api.leavePolicies.previewLeavePolicyImpact,
    showImpact && effectiveStart > 0
      ? {
          organizationId: props.organizationId,
          leavePolicyId: props.policy._id,
          effectiveStart,
          rules,
        }
      : "skip",
  );

  const preview = () => {
    const validation = validatePolicyVersionDraft({ effectiveDate, reason });
    if (!validation.valid) {
      toast({
        title: "Policy change is incomplete",
        description: validation.message,
        variant: "destructive",
      });
      return;
    }
    setShowImpact(true);
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await createVersion({
        organizationId: props.organizationId,
        leavePolicyId: props.policy._id,
        effectiveStart,
        changeReason: reason.trim(),
        rules,
      });
      toast({ title: "Policy version scheduled" });
      setShowImpact(false);
      props.onOpenChange(false);
    } catch (error: unknown) {
      toast({
        title: "Unable to update leave policy",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{props.policy.name}</DialogTitle>
            <DialogDescription>
              Create a new version. Historical balances and requests retain
              their original rules.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="policy-effective-date">Effective date</Label>
                <Input
                  id="policy-effective-date"
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy-annual-units">Annual entitlement</Label>
                <Input
                  id="policy-annual-units"
                  type="number"
                  min="0"
                  step={props.currentVersion.roundingIncrement}
                  value={annualUnits}
                  onChange={(event) => setAnnualUnits(event.target.value)}
                  disabled={props.currentVersion.entitlementMethod === "event_based"}
                />
              </div>
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={conversionAllowed}
                onCheckedChange={(checked) =>
                  setConversionAllowed(checked === true)
                }
              />
              <span>
                <span className="block text-sm font-medium">
                  Allow unused balance conversion
                </span>
                <span className="block text-xs text-muted-foreground">
                  Conversion creates a separate reviewed payroll liability.
                </span>
              </span>
            </label>
            <div className="space-y-2">
              <Label htmlFor="policy-change-reason">Change reason</Label>
              <Textarea
                id="policy-change-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this version is needed"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={preview}>Review impact</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <LeavePolicyImpactDialog
        open={showImpact}
        impact={impact}
        isSaving={isSaving}
        onOpenChange={setShowImpact}
        onConfirm={save}
      />
    </>
  );
}
