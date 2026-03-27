"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Check, FilePenLine, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { useSettingsModal } from "@/hooks/settings-modal-context";
import { useToast } from "@/components/ui/use-toast";
import { getOrganizationPath } from "@/utils/organization-routing";

export function LeaveTypesSettingsContent() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { closeModal } = useSettingsModal();
  const { toast } = useToast();
  const settings = useQuery(
    api.settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const updateLeaveTypes = useMutation(api.settings.updateLeaveTypes);

  const [proratedLeave, setProratedLeave] = useState(true);
  const [leaveTrackerMode, setLeaveTrackerMode] = useState<"general" | "by_type">("general");
  const [enableAnniversaryLeave, setEnableAnniversaryLeave] = useState(true);
  const [annualSil, setAnnualSil] = useState("8");
  const [grantLeaveUponRegularization, setGrantLeaveUponRegularization] =
    useState(true);
  const [maxConvertibleLeaveDays, setMaxConvertibleLeaveDays] =
    useState("5");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setProratedLeave(settings?.proratedLeave ?? true);
    setLeaveTrackerMode(settings?.leaveTrackerMode ?? "general");
    setEnableAnniversaryLeave(settings?.enableAnniversaryLeave ?? true);
    setAnnualSil(String(settings?.annualSil ?? 8));
    setGrantLeaveUponRegularization(
      settings?.grantLeaveUponRegularization ?? true,
    );
    setMaxConvertibleLeaveDays(
      String(settings?.maxConvertibleLeaveDays ?? 5),
    );
  }, [settings]);

  const handleSave = async () => {
    if (!currentOrganizationId) return;
    const parsedAnnualSil = Number(annualSil);
    if (!Number.isFinite(parsedAnnualSil) || parsedAnnualSil < 0) {
      toast({
        title: "Error",
        description: "Annual SIL must be a valid non-negative number.",
        variant: "destructive",
      });
      return;
    }
    const parsedMaxConvertible = Number(maxConvertibleLeaveDays);
    if (
      !Number.isFinite(parsedMaxConvertible) ||
      parsedMaxConvertible < 0 ||
      parsedMaxConvertible !== Math.floor(parsedMaxConvertible)
    ) {
      toast({
        title: "Error",
        description:
          "Max convertible leave days must be a valid non-negative integer.",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      await updateLeaveTypes({
        organizationId: currentOrganizationId,
        proratedLeave,
        leaveTrackerMode,
        enableAnniversaryLeave,
        annualSil: parsedAnnualSil,
        grantLeaveUponRegularization,
        maxConvertibleLeaveDays: parsedMaxConvertible,
      });
      toast({
        title: "Success",
        description: "Leave tracker settings updated successfully",
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to save leave settings",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditForm = () => {
    if (!currentOrganizationId) return;
    closeModal();
    router.push(getOrganizationPath(currentOrganizationId, "/leave/form-template"));
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
          Leave tracker settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="space-y-2">
            <Label
              htmlFor="maxConvertibleLeaveDays"
              className="text-sm font-medium text-[rgb(64,64,64)]"
            >
              Max convertible leave days
            </Label>
            <Input
              id="maxConvertibleLeaveDays"
              value={maxConvertibleLeaveDays}
              onChange={(event) =>
                setMaxConvertibleLeaveDays(event.target.value)
              }
              inputMode="numeric"
              className="max-w-[220px] bg-white"
            />
            <p className="text-xs text-[rgb(133,133,133)]">
              Maximum unused leave days convertible to cash per year. Default is
              5.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="mb-3 text-sm font-medium text-[rgb(64,64,64)]">
            Leave tracker mode
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setLeaveTrackerMode("general")}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${
                leaveTrackerMode === "general"
                  ? "border-brand-purple bg-brand-purple/5"
                  : "border-[#DDDDDD] bg-white"
              }`}
            >
              <div className="mt-0.5 h-4 w-4 shrink-0">
                {leaveTrackerMode === "general" ? (
                  <Check className="h-4 w-4 text-brand-purple" />
                ) : null}
              </div>
              <div>
                <p className="text-sm font-medium text-[rgb(64,64,64)]">
                  General leave
                </p>
                <p className="text-xs text-[rgb(133,133,133)]">
                  Uses Annual SIL as the base pool in leave tracker.
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setLeaveTrackerMode("by_type")}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${
                leaveTrackerMode === "by_type"
                  ? "border-brand-purple bg-brand-purple/5"
                  : "border-[#DDDDDD] bg-white"
              }`}
            >
              <div className="mt-0.5 h-4 w-4 shrink-0">
                {leaveTrackerMode === "by_type" ? (
                  <Check className="h-4 w-4 text-brand-purple" />
                ) : null}
              </div>
              <div>
                <p className="text-sm font-medium text-[rgb(64,64,64)]">
                  By leave type
                </p>
                <p className="text-xs text-[rgb(133,133,133)]">
                  Uses configured leave types in tracker calculations.
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="space-y-2">
            <Label
              htmlFor="annualSil"
              className="text-sm font-medium text-[rgb(64,64,64)]"
            >
              Annual SIL
            </Label>
            <Input
              id="annualSil"
              value={annualSil}
              onChange={(event) => setAnnualSil(event.target.value)}
              inputMode="decimal"
              className="max-w-[220px] bg-white"
            />
            <p className="text-xs text-[rgb(133,133,133)]">
              Base SIL used by the leave tracker before proration. Default is
              `8.00`.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="proratedLeave"
              checked={proratedLeave}
              onCheckedChange={(checked) =>
                setProratedLeave(checked as boolean)
              }
            />
            <div className="space-y-1">
              <Label
                htmlFor="proratedLeave"
                className="cursor-pointer text-sm font-medium"
              >
                Enable proration in leave tracker
              </Label>
              <p className="text-xs text-[rgb(133,133,133)]">
                When enabled, `Annual SIL` is computed from the remaining months
                of the current year. When disabled, the tracker uses the full
                configured SIL base.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="mb-3 flex items-start gap-2 text-sm text-[rgb(64,64,64)]">
            <Info className="mt-0.5 h-4 w-4 text-[rgb(133,133,133)]" />
            <span>
              Start calculating leave from:
            </span>
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setGrantLeaveUponRegularization(true)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${
                grantLeaveUponRegularization
                  ? "border-brand-purple bg-brand-purple/5"
                  : "border-[#DDDDDD] bg-white"
              }`}
            >
              <div className="mt-0.5 h-4 w-4 shrink-0">
                {grantLeaveUponRegularization ? (
                  <Check className="h-4 w-4 text-brand-purple" />
                ) : null}
              </div>
              <div>
                <p className="text-sm font-medium text-[rgb(64,64,64)]">
                  Date of regularization
                </p>
                <p className="text-xs text-[rgb(133,133,133)]">
                  Default. If a regularization date exists, proration starts
                  from that date. Otherwise it falls back to the hire date.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setGrantLeaveUponRegularization(false)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${
                !grantLeaveUponRegularization
                  ? "border-brand-purple bg-brand-purple/5"
                  : "border-[#DDDDDD] bg-white"
              }`}
            >
              <div className="mt-0.5 h-4 w-4 shrink-0">
                {!grantLeaveUponRegularization ? (
                  <Check className="h-4 w-4 text-brand-purple" />
                ) : null}
              </div>
              <div>
                <p className="text-sm font-medium text-[rgb(64,64,64)]">
                  Date hired
                </p>
                <p className="text-xs text-[rgb(133,133,133)]">
                  Proration always starts from the employee&apos;s hire date.
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <p className="text-sm font-medium text-[rgb(64,64,64)]">
            Anniversary leave
          </p>
          <div className="mt-3 flex items-start gap-3">
            <Checkbox
              id="enableAnniversaryLeave"
              checked={enableAnniversaryLeave}
              onCheckedChange={(checked) =>
                setEnableAnniversaryLeave(checked as boolean)
              }
            />
            <Label
              htmlFor="enableAnniversaryLeave"
              className="cursor-pointer text-sm"
            >
              Enable anniversary leave in tracker totals
            </Label>
          </div>
          <p className="mt-1 text-xs text-[rgb(133,133,133)]">
            Anniversary leave uses the selected start rule (regularization or
            hire date).
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium text-[rgb(64,64,64)]">
              Leave request form template
            </Label>
            <p className="text-xs text-[rgb(133,133,133)]">
              Employees fill a default leave request form when submitting leave
              requests. You can customize that form in a dedicated editor page.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-[rgb(230,230,230)] bg-white p-4">
            <div>
              <p className="text-sm font-medium text-[rgb(64,64,64)]">
                Open form editor
              </p>
              <p className="text-xs text-[rgb(133,133,133)]">
                Edit the default leave request form in a full page editor.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={handleEditForm}>
              <FilePenLine className="mr-2 h-4 w-4" />
              Edit form
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
