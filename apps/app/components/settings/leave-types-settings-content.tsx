"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  Check,
  FilePenLine,
  Landmark,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import { useSettingsModal } from "@/hooks/settings-modal-context";
import {
  buildLeaveSettingsViewModel,
  completeLeaveMigration,
  type LeaveSettingsSector,
} from "@/lib/leave/client-state";
import { getOrganizationPath } from "@/utils/organization-routing";
import { LeavePolicyEditor } from "./leave-policy-editor";
import { LeavePolicyCreateDialog } from "./leave-policy-create-dialog";

type ConfiguredPolicy = {
  policy: Doc<"leavePolicies">;
  versions: Doc<"leavePolicyVersions">[];
};

function formatRuleSummary(version: Doc<"leavePolicyVersions">): string {
  if (version.entitlementMethod === "event_based") {
    return `${version.durationBasis.replaceAll("_", " ")} · event qualified`;
  }
  const units = version.annualUnits ?? 0;
  return `${units} day${units === 1 ? "" : "s"} · ${version.entitlementMethod.replaceAll("_", " ")}`;
}

function PolicySection(props: {
  title: string;
  description: string;
  policies: ConfiguredPolicy[];
  onEdit: (policy: ConfiguredPolicy) => void;
  onCreate?: () => void;
  onSync?: () => void;
  isSyncing?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
          <p className="text-xs text-muted-foreground">{props.description}</p>
        </div>
        {props.onCreate ? (
          <Button type="button" size="sm" onClick={props.onCreate}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Add policy
          </Button>
        ) : props.onSync ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.isSyncing}
            onClick={props.onSync}
          >
            <RefreshCw
              className={`mr-2 h-3.5 w-3.5 ${props.isSyncing ? "animate-spin" : ""}`}
            />
            {props.isSyncing ? "Syncing…" : "Sync statutory policies"}
          </Button>
        ) : null}
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-background">
        {props.policies.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No policies in this section.
          </p>
        ) : (
          props.policies.map(({ policy, versions }) => {
            const current = versions.at(-1);
            if (!current) return null;
            return (
              <div
                key={policy._id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{policy.name}</p>
                    {policy.category === "statutory" ? (
                      <Badge variant="secondary" className="gap-1">
                        <LockKeyhole className="h-3 w-3" /> Protected baseline
                      </Badge>
                    ) : null}
                    {policy.coveredByPolicyId ? (
                      <Badge variant="outline">Company coverage linked</Badge>
                    ) : null}
                    <Badge variant="outline">v{current.version}</Badge>
                  </div>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {formatRuleSummary(current)} · {current.payTreatment.replaceAll("_", " ")}
                  </p>
                  {current.sourceCitation ? (
                    <a
                      href={current.sourceCitation}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-brand-purple hover:underline"
                    >
                      View legal source
                    </a>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => props.onEdit({ policy, versions })}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" /> New version
                </Button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function LeaveTypesSettingsContent() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { closeModal } = useSettingsModal();
  const { toast } = useToast();
  const configuration = useQuery(
    api.leavePolicies.getLeaveConfiguration,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const companyModel = useQuery(
    api.leavePolicies.getCompanyLeaveModel,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const configureSector = useMutation(api.leavePolicies.configureLeaveSector);
  const scheduleCompanyModel = useMutation(
    api.leavePolicies.scheduleCompanyLeaveModelChange,
  );
  const configureAnniversary = useMutation(
    api.leavePolicies.configureAnniversaryLeave,
  );
  const synchronizeStatutory = useMutation(
    api.leavePolicies.synchronizeStatutoryPolicies,
  );
  const activateMigration = useMutation(
    api.leaveMigration.activateOrganizationLeaveEngine,
  );
  const runMigrationBatch = useMutation(
    api.leaveMigration.runOrganizationLeaveMigrationBatch,
  );
  const [sector, setSector] = useState<LeaveSettingsSector>("private");
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [pendingCompanyMode, setPendingCompanyMode] = useState<
    "pooled" | "by_type"
  >();
  const nextPolicyYear = `${new Date().getFullYear() + 1}-01-01`;
  const [modelEffectiveDate, setModelEffectiveDate] = useState(nextPolicyYear);
  const [modelChangeReason, setModelChangeReason] = useState("");
  const [anniversaryEnabled, setAnniversaryEnabled] = useState(false);
  const [anniversaryMaximumDays, setAnniversaryMaximumDays] = useState("5");
  const [anniversaryBasis, setAnniversaryBasis] = useState<
    "hire_date" | "regularization_date"
  >("hire_date");
  const [anniversaryEffectiveDate, setAnniversaryEffectiveDate] =
    useState(nextPolicyYear);
  const [anniversaryReason, setAnniversaryReason] = useState("");
  const [isSavingAnniversary, setIsSavingAnniversary] = useState(false);
  const [isSyncingStatutory, setIsSyncingStatutory] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<ConfiguredPolicy>();
  const [showCreatePolicy, setShowCreatePolicy] = useState(false);

  useEffect(() => {
    if (!configuration?.settings) return;
    setAnniversaryEnabled(
      configuration.settings.enableAnniversaryLeave === true,
    );
    setAnniversaryMaximumDays(
      String(configuration.settings.anniversaryLeaveMaxDays ?? 5),
    );
    setAnniversaryBasis(
      configuration.settings.anniversaryLeaveServiceDateBasis ?? "hire_date",
    );
  }, [configuration?.settings]);

  const model = useMemo(
    () =>
      buildLeaveSettingsViewModel({
        settings: configuration?.settings
          ? {
              migrationState: configuration.settings.migrationState,
              employmentSector: configuration.settings.employmentSector,
              leaveTrackerMode: configuration.settings.leaveTrackerMode,
              companyLeaveDefaultMode:
                configuration.settings.companyLeaveDefaultMode,
            }
          : null,
        policies: (configuration?.policies ?? []).map(({ policy }) => ({
          id: policy._id,
          name: policy.name,
          category: policy.category,
          state: policy.state,
        })),
      }),
    [configuration],
  );
  const policyById = new Map<string, ConfiguredPolicy>(
    (configuration?.policies ?? []).map((configured) => [
      String(configured.policy._id),
      configured,
    ]),
  );
  const statutoryPolicies = model.statutoryPolicies
    .map((policy) => policyById.get(policy.id))
    .filter((policy): policy is ConfiguredPolicy => policy !== undefined);
  const companyPolicies = model.companyPolicies
    .map((policy) => policyById.get(policy.id))
    .filter((policy): policy is ConfiguredPolicy => policy !== undefined);
  const archivedPolicies = model.archivedPolicies
    .map((policy) => policyById.get(policy.id))
    .filter((policy): policy is ConfiguredPolicy => policy !== undefined);
  const effectiveCompanyMode =
    companyModel?.effectiveMode ?? model.companyLeaveDefaultMode ?? "pooled";
  const hasPooledBaseEntitlement = companyPolicies.some(({ versions }) => {
    const current = versions.find(
      (version) =>
        version.effectiveStart <= Date.now() &&
        (version.effectiveEnd === undefined || version.effectiveEnd >= Date.now()),
    );
    return (
      current?.accountBehavior === "shared_pool" &&
      current.entitlementMethod !== "none" &&
      current.entitlementMethod !== "anniversary"
    );
  });

  const completeSectorSetup = async () => {
    if (!currentOrganizationId) return;
    setIsSaving(true);
    try {
      if (configuration?.settings) {
        await completeLeaveMigration({
          runBatch: () =>
            runMigrationBatch({
              organizationId: currentOrganizationId,
              batchSize: 100,
            }),
          activate: async () => {
            await activateMigration({
              organizationId: currentOrganizationId,
              employmentSector: sector,
            });
          },
        });
      } else {
        await configureSector({
          organizationId: currentOrganizationId,
          employmentSector: sector,
          effectiveStart: Date.now(),
          changeReason: "Initial Philippine leave policy setup",
        });
      }
      toast({ title: "Leave policies are ready" });
    } catch (error: unknown) {
      toast({
        title: "Unable to complete leave setup",
        description:
          error instanceof Error
            ? error.message
            : "Migration comparison may still be in progress.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveCompanyModelChange = async () => {
    if (!currentOrganizationId || !pendingCompanyMode) return;
    if (!modelChangeReason.trim()) {
      toast({ title: "Change reason is required", variant: "destructive" });
      return;
    }
    setIsSavingModel(true);
    try {
      await scheduleCompanyModel({
        organizationId: currentOrganizationId,
        mode: pendingCompanyMode,
        effectiveStart: Date.parse(`${modelEffectiveDate}T00:00:00+08:00`),
        changeReason: modelChangeReason.trim(),
      });
      toast({ title: "Company leave model change scheduled" });
      setPendingCompanyMode(undefined);
      setModelChangeReason("");
    } catch (error: unknown) {
      toast({
        title: "Unable to schedule the company leave model",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingModel(false);
    }
  };

  const saveAnniversarySettings = async () => {
    if (!currentOrganizationId) return;
    const maximumDays = Number(anniversaryMaximumDays);
    if (!anniversaryReason.trim()) {
      toast({ title: "Change reason is required", variant: "destructive" });
      return;
    }
    setIsSavingAnniversary(true);
    try {
      await configureAnniversary({
        organizationId: currentOrganizationId,
        enabled: anniversaryEnabled,
        maximumDays,
        serviceDateBasis: anniversaryBasis,
        effectiveStart: Date.parse(
          `${anniversaryEffectiveDate}T00:00:00+08:00`,
        ),
        changeReason: anniversaryReason.trim(),
      });
      toast({ title: "Anniversary leave settings saved" });
      setAnniversaryReason("");
    } catch (error: unknown) {
      toast({
        title: "Unable to save anniversary leave",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingAnniversary(false);
    }
  };

  const syncStatutoryPolicies = async () => {
    if (!currentOrganizationId) return;
    setIsSyncingStatutory(true);
    try {
      const result = await synchronizeStatutory({
        organizationId: currentOrganizationId,
      });
      toast({
        title: "Statutory policies synchronized",
        description:
          result.createdPolicyCount > 0
            ? `${result.createdPolicyCount} missing ${result.createdPolicyCount === 1 ? "policy was" : "policies were"} restored.`
            : "All required policies were already present.",
      });
    } catch (error: unknown) {
      toast({
        title: "Unable to synchronize statutory policies",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSyncingStatutory(false);
    }
  };

  if (!currentOrganizationId || configuration === undefined) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center p-6">
          <Spinner size="lg" />
        </CardContent>
      </Card>
    );
  }

  if (model.setupStatus !== "configured") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{model.setupTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose the organization sector. Existing settings, balances, and
            request history remain unchanged during migration.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["private", Building2, "Private company", "SIL plus flexible pooled or by-type company leave."],
              ["government", Landmark, "Government agency", "Separate vacation and sick credits plus CSC leave types."],
            ] as const).map(([value, Icon, title, description]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSector(value)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  sector === value
                    ? "border-brand-purple bg-brand-purple/5"
                    : "hover:bg-muted/40"
                }`}
              >
                <Icon className="mb-3 h-5 w-5 text-brand-purple" />
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={completeSectorSetup} disabled={isSaving}>
              {isSaving ? "Saving…" : "Confirm sector and continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Leave policy settings</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {model.sector === "government" ? "Government" : "Private"} ·
              effective-dated rules with preserved history
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!currentOrganizationId) return;
              closeModal();
              router.push(
                getOrganizationPath(currentOrganizationId, "/leave/form-template"),
              );
            }}
          >
            <FilePenLine className="mr-2 h-4 w-4" /> Edit request form
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-8 p-6">
        <section className="rounded-xl border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold">Company leave model</h3>
          {model.sector === "private" ? (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {([
                  {
                    mode: "pooled" as const,
                    title: "Shared annual pool",
                    description:
                      "One balance covers vacation, sick, and other company leave.",
                  },
                  {
                    mode: "by_type" as const,
                    title: "Balances by leave type",
                    description:
                      "Vacation, sick, and custom policies keep separate balances.",
                  },
                ]).map((option) => {
                  const selected = effectiveCompanyMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      aria-pressed={selected}
                      disabled={isSavingModel || selected}
                      onClick={() => setPendingCompanyMode(option.mode)}
                      className={`rounded-lg border bg-background p-3 text-left transition-colors ${
                        selected
                          ? "border-brand-purple ring-1 ring-brand-purple"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {option.title}
                        </span>
                        {selected ? (
                          <Check className="h-4 w-4 text-brand-purple" />
                        ) : null}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>
              {companyModel?.scheduled ? (
                <p className="mt-3 text-xs font-medium text-brand-purple">
                  {companyModel.scheduled.mode === "pooled"
                    ? "Shared annual pool"
                    : "Balances by leave type"}{" "}
                  is scheduled for{" "}
                  {new Intl.DateTimeFormat("en-PH", {
                    dateStyle: "medium",
                    timeZone: "Asia/Manila",
                  }).format(companyModel.scheduled.effectiveStart)}.
                </p>
              ) : null}
              {companyModel?.requiresNormalization &&
              !companyModel.scheduled ? (
                <div className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    Historical setup contains policies from both models.
                    Normalize them prospectively without deleting balances.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPendingCompanyMode(effectiveCompanyMode)
                    }
                  >
                    Schedule normalization
                  </Button>
                </div>
              ) : null}
              {pendingCompanyMode ? (
                <div className="mt-4 space-y-3 rounded-lg border bg-background p-4">
                  <p className="text-sm font-medium">
                    Schedule the model change
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Historical balances and ledgers remain intact. New
                    entitlement periods use the selected model.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="company-model-effective-date">
                        Effective date
                      </Label>
                      <Input
                        id="company-model-effective-date"
                        type="date"
                        value={modelEffectiveDate}
                        onChange={(event) =>
                          setModelEffectiveDate(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="company-model-reason">Reason</Label>
                      <Input
                        id="company-model-reason"
                        value={modelChangeReason}
                        onChange={(event) =>
                          setModelChangeReason(event.target.value)
                        }
                        placeholder="Approved policy-year change"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPendingCompanyMode(undefined)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      disabled={isSavingModel}
                      onClick={() => void saveCompanyModelChange()}
                    >
                      {isSavingModel ? "Scheduling…" : "Schedule change"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Vacation Leave and Sick Leave remain separate monthly credit
              accounts as required by the government preset.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Exactly one model governs company entitlement periods. Changes are
            effective-dated and never delete historical balances.
          </p>
        </section>

        {model.sector === "private" ? (
          <section className="space-y-4 rounded-xl border p-4">
            <div>
              <h3 className="text-sm font-semibold">Anniversary leave</h3>
              <p className="text-xs text-muted-foreground">
                Grants one day per completed service year. It adds to the shared
                pool or becomes its own balance under the by-type model.
              </p>
            </div>
            <label className="flex items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={anniversaryEnabled}
                onChange={(event) =>
                  setAnniversaryEnabled(event.target.checked)
                }
              />
              Enable anniversary leave
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="anniversary-maximum">Maximum bonus days</Label>
                <Input
                  id="anniversary-maximum"
                  type="number"
                  min="1"
                  max="30"
                  value={anniversaryMaximumDays}
                  onChange={(event) =>
                    setAnniversaryMaximumDays(event.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="anniversary-basis">Service date basis</Label>
                <select
                  id="anniversary-basis"
                  value={anniversaryBasis}
                  onChange={(event) =>
                    setAnniversaryBasis(
                      event.target.value as
                        | "hire_date"
                        | "regularization_date",
                    )
                  }
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="hire_date">Hire date</option>
                  <option value="regularization_date">
                    Regularization date
                  </option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="anniversary-effective">Effective date</Label>
                <Input
                  id="anniversary-effective"
                  type="date"
                  value={anniversaryEffectiveDate}
                  onChange={(event) =>
                    setAnniversaryEffectiveDate(event.target.value)
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="anniversary-reason">Change reason</Label>
              <Textarea
                id="anniversary-reason"
                value={anniversaryReason}
                onChange={(event) => setAnniversaryReason(event.target.value)}
                placeholder="Document the approved anniversary benefit"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={isSavingAnniversary}
                onClick={() => void saveAnniversarySettings()}
              >
                {isSavingAnniversary ? "Saving…" : "Save anniversary settings"}
              </Button>
            </div>
          </section>
        ) : null}

        <PolicySection
          title="Company leave"
          description="Company-provided leave and operational rules."
          policies={companyPolicies}
          onEdit={setSelectedPolicy}
          onCreate={
            effectiveCompanyMode === "by_type" || !hasPooledBaseEntitlement
              ? () => setShowCreatePolicy(true)
              : undefined
          }
        />
        <PolicySection
          title="Statutory leave"
          description="Protected Philippine baselines are added automatically from the selected sector. They define legal eligibility and limits; event-based leave is created only when a qualifying event is verified. A qualifying company pool may cover SIL, so it is not granted twice."
          policies={statutoryPolicies}
          onEdit={setSelectedPolicy}
          onSync={syncStatutoryPolicies}
          isSyncing={isSyncingStatutory}
        />
        {archivedPolicies.length > 0 ? (
          <PolicySection
            title="Archived policy history"
            description="Archived policies remain visible for audit and historical requests."
            policies={archivedPolicies}
            onEdit={setSelectedPolicy}
          />
        ) : null}
      </CardContent>
      {selectedPolicy?.versions.at(-1) ? (
        <LeavePolicyEditor
          organizationId={currentOrganizationId}
          policy={selectedPolicy.policy}
          currentVersion={selectedPolicy.versions.at(-1)!}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedPolicy(undefined);
          }}
        />
      ) : null}
      <LeavePolicyCreateDialog
        organizationId={currentOrganizationId}
        companyModel={effectiveCompanyMode}
        scheduledModel={companyModel?.scheduled}
        open={showCreatePolicy}
        onOpenChange={setShowCreatePolicy}
      />
    </Card>
  );
}
