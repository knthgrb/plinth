"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Check, FilePenLine, Info, Lock, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { useSettingsModal } from "@/hooks/settings-modal-context";
import { useToast } from "@/components/ui/use-toast";
import { getOrganizationPath } from "@/utils/organization-routing";

type TrackerTypeRow = {
  typeKey: string;
  name: string;
  maxDays: string;
  isPaid: boolean;
};

/** Matches `settings.leaveTypes` from Convex schema. */
type SettingsLeaveType = {
  type: string;
  name: string;
  defaultCredits: number;
  isPaid?: boolean;
  requiresApproval?: boolean;
  maxConsecutiveDays?: number;
  carryOver?: boolean;
  maxCarryOver?: number;
  isAnniversary?: boolean;
};

/** Payload shape expected by `api.settings.updateLeaveTypes` for each entry. */
type LeaveTypeMutationEntry = {
  type: string;
  name: string;
  defaultCredits: number;
  isPaid: boolean;
  requiresApproval: boolean;
  maxConsecutiveDays?: number;
  carryOver?: boolean;
  maxCarryOver?: number;
  isAnniversary?: boolean;
};

/** Canonical key for the fixed anniversary row in by-type mode (matches schema examples). */
const ANNIVERSARY_LEAVE_TYPE_KEY = "anniversary";

function slugifyLeaveType(name: string, index: number) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const slug = base || `leave_type_${index + 1}`;
  if (slug === ANNIVERSARY_LEAVE_TYPE_KEY) {
    return `leave_type_${index + 1}`;
  }
  return slug;
}

function fixedAnniversaryLeaveEntry(): LeaveTypeMutationEntry {
  return {
    type: ANNIVERSARY_LEAVE_TYPE_KEY,
    name: "Anniversary leave",
    defaultCredits: 0,
    isPaid: true,
    requiresApproval: true,
    isAnniversary: true,
  };
}

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
  const [leaveAccrualFrequency, setLeaveAccrualFrequency] = useState<
    "monthly" | "semi_annual" | "annual"
  >("monthly");
  const [leaveTrackerMode, setLeaveTrackerMode] = useState<"general" | "by_type">("general");
  const [enableAnniversaryLeave, setEnableAnniversaryLeave] = useState(true);
  const [anniversaryLeaveMaxDays, setAnniversaryLeaveMaxDays] =
    useState("15");
  const [annualSil, setAnnualSil] = useState("8");
  const [grantLeaveUponRegularization, setGrantLeaveUponRegularization] =
    useState(true);
  const [paidLeaveRequiresRegularization, setPaidLeaveRequiresRegularization] =
    useState(true);
  const [maxConvertibleLeaveDays, setMaxConvertibleLeaveDays] =
    useState("5");
  const [leaveGuidelines, setLeaveGuidelines] = useState("");
  const [trackerTypeRows, setTrackerTypeRows] = useState<TrackerTypeRow[]>(
    [],
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setProratedLeave(settings?.proratedLeave ?? true);
    setLeaveAccrualFrequency(settings?.leaveAccrualFrequency ?? "monthly");
    setLeaveTrackerMode(settings?.leaveTrackerMode ?? "general");
    setEnableAnniversaryLeave(settings?.enableAnniversaryLeave ?? true);
    setAnniversaryLeaveMaxDays(
      String(settings?.anniversaryLeaveMaxDays ?? 15),
    );
    setAnnualSil(String(settings?.annualSil ?? 8));
    setGrantLeaveUponRegularization(
      settings?.grantLeaveUponRegularization ?? true,
    );
    setPaidLeaveRequiresRegularization(
      settings?.paidLeaveRequiresRegularization ?? true,
    );
    setMaxConvertibleLeaveDays(
      String(settings?.maxConvertibleLeaveDays ?? 5),
    );
    setLeaveGuidelines(settings?.leaveGuidelines ?? "");
    const leaveTypesList = (settings?.leaveTypes ?? []) as SettingsLeaveType[];
    const work = leaveTypesList.filter((t) => !t.isAnniversary);
    if (work.length > 0) {
      setTrackerTypeRows(
        work.map((t) => ({
          typeKey: t.type,
          name: t.name,
          maxDays: String(t.defaultCredits ?? 0),
          isPaid: t.isPaid ?? true,
        })),
      );
    } else if ((settings?.leaveTrackerMode ?? "general") === "by_type") {
      setTrackerTypeRows([
        { typeKey: "", name: "", maxDays: "5", isPaid: true },
      ]);
    } else {
      setTrackerTypeRows([]);
    }
  }, [settings]);

  const setLeaveTrackerModeWithDefaultRows = (
    mode: "general" | "by_type",
  ) => {
    setLeaveTrackerMode(mode);
    if (mode === "by_type") {
      setTrackerTypeRows((rows) =>
        rows.length > 0
          ? rows
          : [{ typeKey: "", name: "", maxDays: "5", isPaid: true }],
      );
    }
  };

  const handleSave = async () => {
    if (!currentOrganizationId) return;
    const parsedAnnualSil = Number(annualSil);
    if (leaveTrackerMode === "general") {
      if (!Number.isFinite(parsedAnnualSil) || parsedAnnualSil < 0) {
        toast({
          title: "Error",
          description: "Annual SIL must be a valid non-negative number.",
          variant: "destructive",
        });
        return;
      }
    }
    const parsedAnniversaryMax = Number(anniversaryLeaveMaxDays);
    if (
      !Number.isFinite(parsedAnniversaryMax) ||
      parsedAnniversaryMax < 0 ||
      parsedAnniversaryMax !== Math.floor(parsedAnniversaryMax)
    ) {
      toast({
        title: "Error",
        description:
          "Anniversary leave max must be a valid non-negative integer.",
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

    const workPayload: LeaveTypeMutationEntry[] =
      leaveTrackerMode === "by_type"
        ? trackerTypeRows
            .filter(
              (r) =>
                r.name.trim().length > 0 ||
                (Number.isFinite(Number(r.maxDays)) && Number(r.maxDays) > 0),
            )
            .map((r, idx) => ({
              type: r.typeKey.trim() || slugifyLeaveType(r.name, idx),
              name: r.name.trim() || `Leave ${idx + 1}`,
              defaultCredits: Math.max(0, Number(r.maxDays) || 0),
              isPaid: r.isPaid,
              requiresApproval: true,
            }))
            .filter((e) => e.type !== ANNIVERSARY_LEAVE_TYPE_KEY)
        : [];

    if (leaveTrackerMode === "by_type" && workPayload.length === 0) {
      toast({
        title: "Error",
        description:
          "Add at least one leave type with a name or a positive max days value.",
        variant: "destructive",
      });
      return;
    }

    const leaveTypesForMutation: LeaveTypeMutationEntry[] | undefined =
      leaveTrackerMode === "by_type"
        ? [
            ...workPayload,
            ...(enableAnniversaryLeave ? [fixedAnniversaryLeaveEntry()] : []),
          ]
        : undefined;

    setIsSaving(true);
    try {
      await updateLeaveTypes({
        organizationId: currentOrganizationId,
        proratedLeave,
        leaveAccrualFrequency,
        leaveTrackerMode,
        enableAnniversaryLeave,
        anniversaryLeaveMaxDays: parsedAnniversaryMax,
        annualSil:
          leaveTrackerMode === "general"
            ? parsedAnnualSil
            : (settings?.annualSil ?? 8),
        grantLeaveUponRegularization,
        paidLeaveRequiresRegularization,
        maxConvertibleLeaveDays: parsedMaxConvertible,
        leaveGuidelines: leaveGuidelines.trim() || undefined,
        ...(leaveTypesForMutation !== undefined
          ? { leaveTypes: leaveTypesForMutation }
          : {}),
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
              onClick={() => setLeaveTrackerModeWithDefaultRows("general")}
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
              onClick={() => setLeaveTrackerModeWithDefaultRows("by_type")}
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
          <div className="mt-4 flex items-start gap-3 border-t border-[#DDDDDD] pt-4">
            <Checkbox
              id="enableAnniversaryLeave"
              checked={enableAnniversaryLeave}
              onCheckedChange={(checked) =>
                setEnableAnniversaryLeave(checked as boolean)
              }
            />
            <div className="space-y-1">
              <Label
                htmlFor="enableAnniversaryLeave"
                className="cursor-pointer text-sm font-medium text-[rgb(64,64,64)]"
              >
                Enable anniversary leave
              </Label>
              <p className="text-xs text-[rgb(133,133,133)]">
                Adds 1 day per full year of service using the start rule below.
                In By leave type mode, Anniversary leave is a fixed row in the
                list.
              </p>
              {enableAnniversaryLeave ? (
                <div className="pt-2">
                  <Label
                    htmlFor="anniversaryLeaveMaxDays"
                    className="text-xs text-[rgb(100,100,100)]"
                  >
                    Max anniversary leave days
                  </Label>
                  <Input
                    id="anniversaryLeaveMaxDays"
                    value={anniversaryLeaveMaxDays}
                    onChange={(event) =>
                      setAnniversaryLeaveMaxDays(event.target.value)
                    }
                    inputMode="numeric"
                    className="mt-1 max-w-[160px] bg-white"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="mb-3 text-sm font-medium text-[rgb(64,64,64)]">
            Accrual schedule
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              {
                value: "monthly" as const,
                title: "Monthly",
                body: "Accrues evenly each month.",
              },
              {
                value: "semi_annual" as const,
                title: "Semi-annual",
                body: "Releases half in the first half and full in the second half.",
              },
              {
                value: "annual" as const,
                title: "Annual",
                body: "Releases the annual entitlement at once.",
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setLeaveAccrualFrequency(option.value)}
                className={`flex min-h-[92px] items-start gap-3 rounded-lg border p-3 text-left ${
                  leaveAccrualFrequency === option.value
                    ? "border-brand-purple bg-brand-purple/5"
                    : "border-[#DDDDDD] bg-white"
                }`}
              >
                <div className="mt-0.5 h-4 w-4 shrink-0">
                  {leaveAccrualFrequency === option.value ? (
                    <Check className="h-4 w-4 text-brand-purple" />
                  ) : null}
                </div>
                <div>
                  <p className="text-sm font-medium text-[rgb(64,64,64)]">
                    {option.title}
                  </p>
                  <p className="text-xs text-[rgb(133,133,133)]">
                    {option.body}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {leaveTrackerMode === "general" ? (
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
        ) : (
          <div className="rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
            <div className="mb-3 text-sm font-medium text-[rgb(64,64,64)]">
              Leave types (max days per year)
            </div>
            <p className="mb-3 text-xs text-[rgb(133,133,133)]">
              Each type is tracked separately in the leave tracker. When
              proration is on, each type&apos;s max is prorated from the same
              employee start date.
            </p>
            <div className="space-y-3">
              {enableAnniversaryLeave ? (
                <div className="flex flex-col gap-2 rounded-md border border-dashed border-brand-purple/40 bg-brand-purple/5 p-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label className="text-xs text-[rgb(100,100,100)] flex items-center gap-1.5">
                      <Lock className="h-3 w-3 text-brand-purple" aria-hidden />
                      Name
                    </Label>
                    <Input
                      value="Anniversary leave"
                      readOnly
                      disabled
                      className="bg-[rgb(250,250,250)] text-[rgb(64,64,64)]"
                    />
                  </div>
                  <div className="w-full space-y-1 sm:w-32">
                    <Label className="text-xs text-[rgb(100,100,100)]">
                      Max days
                    </Label>
                    <Input
                      value="Auto (1/yr)"
                      readOnly
                      disabled
                      title="Accrues 1 day per full year; not edited here."
                      className="bg-[rgb(250,250,250)] text-[rgb(100,100,100)]"
                    />
                  </div>
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-[rgb(180,180,180)]"
                    title="Fixed leave type"
                  >
                    <Lock className="h-4 w-4" />
                  </div>
                </div>
              ) : null}
              {trackerTypeRows.map((row, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 rounded-md border border-[rgb(230,230,230)] bg-white p-3 sm:flex-row sm:items-end"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label className="text-xs text-[rgb(100,100,100)]">
                      Name
                    </Label>
                    <Input
                      value={row.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        setTrackerTypeRows((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, name } : r,
                          ),
                        );
                      }}
                      placeholder="e.g. Vacation"
                      className="bg-white"
                    />
                  </div>
                  <div className="w-full space-y-1 sm:w-32">
                    <Label className="text-xs text-[rgb(100,100,100)]">
                      Max days
                    </Label>
                    <Input
                      value={row.maxDays}
                      onChange={(event) => {
                        const maxDays = event.target.value;
                        setTrackerTypeRows((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, maxDays } : r,
                          ),
                        );
                      }}
                      inputMode="decimal"
                      className="bg-white"
                    />
                  </div>
                  <div className="flex w-full items-center gap-2 pb-2 sm:w-24">
                    <Checkbox
                      id={`leave-type-paid-${index}`}
                      checked={row.isPaid}
                      onCheckedChange={(checked) => {
                        const isPaid = checked as boolean;
                        setTrackerTypeRows((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, isPaid } : r,
                          ),
                        );
                      }}
                    />
                    <Label
                      htmlFor={`leave-type-paid-${index}`}
                      className="cursor-pointer text-xs text-[rgb(100,100,100)]"
                    >
                      Paid
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-[rgb(133,133,133)] hover:text-destructive"
                    onClick={() =>
                      setTrackerTypeRows((rows) =>
                        rows.filter((_, i) => i !== index),
                      )
                    }
                    disabled={trackerTypeRows.length <= 1}
                    aria-label="Remove leave type"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() =>
                  setTrackerTypeRows((rows) => [
                    ...rows,
                    { typeKey: "", name: "", maxDays: "5", isPaid: true },
                  ])
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add leave type
              </Button>
            </div>
          </div>
        )}

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
                {leaveTrackerMode === "by_type"
                  ? "When enabled, each leave type's annual max is prorated from the remaining months of the year (15th-day cutoff). When disabled, full max days apply."
                  : "When enabled, Annual SIL is computed from the remaining months of the current year. When disabled, the tracker uses the full configured SIL base."}
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
                  Prorated SIL / leave types start from regularization when set,
                  otherwise from hire. Anniversary leave only starts after a
                  regularization date is recorded (no hire-date fallback).
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
                  Proration and anniversary leave both use the hire date.
                </p>
              </div>
            </button>
          </div>
          <div className="mt-4 flex items-start gap-3 border-t border-[#DDDDDD] pt-4">
            <Checkbox
              id="paidLeaveRequiresRegularization"
              checked={paidLeaveRequiresRegularization}
              onCheckedChange={(checked) =>
                setPaidLeaveRequiresRegularization(checked as boolean)
              }
            />
            <div className="space-y-1">
              <Label
                htmlFor="paidLeaveRequiresRegularization"
                className="cursor-pointer text-sm font-medium text-[rgb(64,64,64)]"
              >
                Paid leave requires regularization
              </Label>
              <p className="text-xs text-[rgb(133,133,133)]">
                Employees without a regularization date do not receive paid
                leave entitlement. They can still file without pay.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
          <div className="space-y-1">
            <Label
              htmlFor="leaveGuidelines"
              className="text-sm font-medium text-[rgb(64,64,64)]"
            >
              Leave memo / guidelines
            </Label>
            <p className="text-xs text-[rgb(133,133,133)]">
              This appears in the employee leave tab for quick policy reference.
            </p>
          </div>
          <Textarea
            id="leaveGuidelines"
            value={leaveGuidelines}
            onChange={(event) => setLeaveGuidelines(event.target.value)}
            className="min-h-[140px] bg-white"
          />
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
