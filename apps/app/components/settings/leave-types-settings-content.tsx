"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Building2, FilePenLine, Landmark, LockKeyhole, Pencil, Plus } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import { useSettingsModal } from "@/hooks/settings-modal-context";
import {
  buildLeaveSettingsViewModel,
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
                    <Badge variant="outline">v{current.version}</Badge>
                  </div>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {formatRuleSummary(current)} · {current.payTreatment.replaceAll("_", " ")}
                  </p>
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
  const configureSector = useMutation(api.leavePolicies.configureLeaveSector);
  const activateMigration = useMutation(
    api.leaveMigration.activateOrganizationLeaveEngine,
  );
  const [sector, setSector] = useState<LeaveSettingsSector>("private");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<ConfiguredPolicy>();
  const [showCreatePolicy, setShowCreatePolicy] = useState(false);

  const model = useMemo(
    () =>
      buildLeaveSettingsViewModel({
        settings: configuration?.settings
          ? {
              migrationState: configuration.settings.migrationState,
              employmentSector: configuration.settings.employmentSector,
              leaveTrackerMode: configuration.settings.leaveTrackerMode,
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

  const completeSectorSetup = async () => {
    if (!currentOrganizationId) return;
    setIsSaving(true);
    try {
      if (configuration?.settings) {
        await activateMigration({
          organizationId: currentOrganizationId,
          employmentSector: sector,
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

  if (!currentOrganizationId || configuration === undefined) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading leave policy settings…
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
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-background p-3">
                <p className="text-sm font-medium">Shared annual pool</p>
                <p className="text-xs text-muted-foreground">
                  One balance can cover vacation, sick, and other company leave.
                </p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-sm font-medium">Balances by leave type</p>
                <p className="text-xs text-muted-foreground">
                  Vacation, sick, and custom policies maintain separate balances.
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Vacation Leave and Sick Leave remain separate monthly credit
              accounts as required by the government preset.
            </p>
          )}
        </section>

        <PolicySection
          title="Company leave"
          description="Company-provided leave and operational rules."
          policies={companyPolicies}
          onEdit={setSelectedPolicy}
          onCreate={() => setShowCreatePolicy(true)}
        />
        <PolicySection
          title="Statutory leave"
          description="Philippine legal baselines cannot be reduced; more generous versions are allowed."
          policies={statutoryPolicies}
          onEdit={setSelectedPolicy}
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
        open={showCreatePolicy}
        onOpenChange={setShowCreatePolicy}
      />
    </Card>
  );
}
