"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileCheck2,
  Landmark,
  MoreHorizontal,
  Paperclip,
  Plus,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { getFileUrl } from "@/actions/files";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useOrganization } from "@/hooks/organization-context";
import type {
  GovernmentAgency,
  GovernmentRemittanceStatus,
} from "@/lib/government-remittance";
import {
  getGovernmentRemittanceActions,
  validateGovernmentRemittanceLifecycleInput,
  type GovernmentRemittanceAction,
  type GovernmentRemittanceUiRole,
} from "@/lib/government-remittance-ui";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { getOrganizationPath } from "@/utils/organization-routing";

type Remittance = FunctionReturnType<
  typeof api.governmentRemittances.listGovernmentRemittances
>[number];
type RemittanceDetail = FunctionReturnType<
  typeof api.governmentRemittances.getGovernmentRemittance
>;
type LifecycleDialogAction =
  | "file"
  | "pay"
  | "fail_filing"
  | "fail_payment"
  | "return_to_draft"
  | "cancel"
  | "reverse"
  | "attach_evidence";

type DraftForm = {
  agency: GovernmentAgency;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  penaltyAmount: string;
  interestAmount: string;
  advancePaymentAmount: string;
  notes: string;
};

const AGENCY_OPTIONS = [
  { value: "bir", label: "BIR Withholding Tax" },
  { value: "sss", label: "SSS" },
  { value: "philhealth", label: "PhilHealth" },
  { value: "pagibig", label: "Pag-IBIG" },
] as const satisfies readonly { value: GovernmentAgency; label: string }[];

const STATUS_LABELS: Record<GovernmentRemittanceStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  filed: "Filed",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  reversed: "Reversed",
};

const ACTION_LABELS: Record<GovernmentRemittanceAction, string> = {
  view: "View details",
  attach_evidence: "Attach evidence",
  edit: "Edit draft",
  submit: "Submit for review",
  return_to_draft: "Return to draft",
  approve: "Approve",
  file: "Record filing",
  pay: "Record payment",
  fail_filing: "Record filing failure",
  fail_payment: "Record payment failure",
  retry: "Retry failed step",
  cancel: "Cancel remittance",
  reverse: "Reverse payment",
};

const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;

function toInputDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function fromInputDate(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

function initialDraftForm(): DraftForm {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 10);
  return {
    agency: "bir",
    periodStart: toInputDate(periodStart.getTime()),
    periodEnd: toInputDate(periodEnd.getTime()),
    dueDate: toInputDate(dueDate.getTime()),
    penaltyAmount: "0",
    interestAmount: "0",
    advancePaymentAmount: "0",
    notes: "",
  };
}

function numberFromInput(value: string): number {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatCurrency(value: number | undefined): string {
  return `₱${Number(value ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: number | undefined): string {
  if (value === undefined) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(
    value,
  );
}

function statusClass(status: GovernmentRemittanceStatus): string {
  switch (status) {
    case "paid":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "approved":
    case "filed":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "reviewed":
      return "border-purple-200 bg-purple-50 text-purple-700";
    case "failed":
      return "border-red-200 bg-red-50 text-red-700";
    case "cancelled":
    case "reversed":
      return "border-gray-200 bg-gray-50 text-gray-600";
    case "draft":
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function agencyLabel(agency: GovernmentAgency): string {
  return (
    AGENCY_OPTIONS.find((option) => option.value === agency)?.label ?? agency
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed.";
}

export default function RemittancesPageClient() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const organizationId = currentOrganizationId as
    | Id<"organizations">
    | undefined;
  const user = useQuery(
    api.organizations.getCurrentUser,
    organizationId ? { organizationId } : "skip",
  );
  const remittances = useQuery(
    api.governmentRemittances.listGovernmentRemittances,
    organizationId ? { organizationId, limit: 200 } : "skip",
  );

  const [summaryAgency, setSummaryAgency] = useState<GovernmentAgency>("bir");
  const summaryPeriod = useMemo(() => {
    const now = new Date();
    return {
      periodStart: new Date(now.getFullYear(), 0, 1).getTime(),
      periodEnd: new Date(now.getFullYear(), 11, 31, 23, 59, 59).getTime(),
    };
  }, []);
  const liabilityOverview = useQuery(
    api.governmentRemittances.getGovernmentLiabilityCandidates,
    organizationId
      ? { organizationId, agency: summaryAgency, ...summaryPeriod }
      : "skip",
  );

  const [draftOpen, setDraftOpen] = useState(false);
  const [editingId, setEditingId] =
    useState<Id<"governmentRemittances"> | null>(null);
  const [draftForm, setDraftForm] = useState<DraftForm>(initialDraftForm);
  const [allocationAmounts, setAllocationAmounts] = useState<
    Record<string, string>
  >({});
  const [advanceAmounts, setAdvanceAmounts] = useState<Record<string, string>>(
    {},
  );
  const hydratedEditIdRef = useRef<string | null>(null);

  const editingDetail = useQuery(
    api.governmentRemittances.getGovernmentRemittance,
    editingId ? { remittanceId: editingId } : "skip",
  );
  const draftDatesValid =
    Boolean(draftForm.periodStart) && Boolean(draftForm.periodEnd);
  const liabilityCandidates = useQuery(
    api.governmentRemittances.getGovernmentLiabilityCandidates,
    draftOpen && organizationId && draftDatesValid
      ? {
          organizationId,
          agency: draftForm.agency,
          periodStart: fromInputDate(draftForm.periodStart),
          periodEnd: fromInputDate(draftForm.periodEnd),
          excludeRemittanceId: editingId ?? undefined,
        }
      : "skip",
  );

  const [selectedDetailId, setSelectedDetailId] =
    useState<Id<"governmentRemittances"> | null>(null);
  const selectedDetail = useQuery(
    api.governmentRemittances.getGovernmentRemittance,
    selectedDetailId ? { remittanceId: selectedDetailId } : "skip",
  );
  const [lifecycleDialog, setLifecycleDialog] = useState<{
    action: LifecycleDialogAction;
    remittanceId: Id<"governmentRemittances">;
  } | null>(null);
  const [lifecycleValue, setLifecycleValue] = useState("");
  const [bankAccountLabel, setBankAccountLabel] = useState("");
  const [lifecycleDate, setLifecycleDate] = useState(() =>
    toInputDate(Date.now()),
  );
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const createRemittance = useMutation(
    api.governmentRemittances.createGovernmentRemittance,
  );
  const updateDraft = useMutation(
    api.governmentRemittances.updateGovernmentRemittanceDraft,
  );
  const submitForReview = useMutation(
    api.governmentRemittances.submitGovernmentRemittanceForReview,
  );
  const returnToDraft = useMutation(
    api.governmentRemittances.returnGovernmentRemittanceToDraft,
  );
  const approveRemittance = useMutation(
    api.governmentRemittances.approveGovernmentRemittance,
  );
  const recordFiling = useMutation(
    api.governmentRemittances.recordGovernmentRemittanceFiling,
  );
  const recordPayment = useMutation(
    api.governmentRemittances.recordGovernmentRemittancePayment,
  );
  const recordFailure = useMutation(
    api.governmentRemittances.recordGovernmentRemittanceFailure,
  );
  const retryRemittance = useMutation(
    api.governmentRemittances.retryGovernmentRemittance,
  );
  const cancelRemittance = useMutation(
    api.governmentRemittances.cancelGovernmentRemittance,
  );
  const reverseRemittance = useMutation(
    api.governmentRemittances.reverseGovernmentRemittance,
  );
  const attachEvidence = useMutation(
    api.governmentRemittances.attachGovernmentRemittanceEvidence,
  );

  const hasAccess =
    user != null &&
    (user.role === "owner" ||
      user.role === "admin" ||
      user.role === "accounting");

  useEffect(() => {
    if (user !== undefined && !hasAccess && organizationId) {
      router.replace(getOrganizationPath(organizationId, "/forbidden"));
    }
  }, [hasAccess, organizationId, router, user]);

  useEffect(() => {
    if (
      !editingId ||
      !editingDetail ||
      hydratedEditIdRef.current === String(editingId)
    ) {
      return;
    }
    hydratedEditIdRef.current = String(editingId);
    setDraftForm({
      agency: editingDetail.agency,
      periodStart: toInputDate(editingDetail.periodStart),
      periodEnd: toInputDate(editingDetail.periodEnd),
      dueDate: toInputDate(editingDetail.dueDate),
      penaltyAmount: String(editingDetail.penaltyAmount),
      interestAmount: String(editingDetail.interestAmount),
      advancePaymentAmount: String(editingDetail.advancePaymentAmount),
      notes: editingDetail.notes ?? "",
    });
    setAllocationAmounts(
      Object.fromEntries(
        editingDetail.allocations.map((allocation) => [
          String(allocation.payrollRunId),
          String(allocation.amount),
        ]),
      ),
    );
    setAdvanceAmounts(
      Object.fromEntries(
        editingDetail.advanceApplications.map((application) => [
          String(application.sourceRemittanceId),
          String(application.amount),
        ]),
      ),
    );
  }, [editingDetail, editingId]);

  const role = hasAccess ? (user.role as GovernmentRemittanceUiRole) : null;
  const remittanceRows = remittances ?? [];
  const remittedTotal = remittanceRows
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + row.cashAmount, 0);
  const awaitingFiling = remittanceRows.filter(
    (row) => row.status === "approved",
  ).length;
  const awaitingPayment = remittanceRows.filter(
    (row) => row.status === "filed" || row.status === "failed",
  ).length;

  const selectedLiabilityAmount = Object.values(allocationAmounts).reduce(
    (sum, value) => sum + Math.max(0, numberFromInput(value)),
    0,
  );
  const selectedAdvanceAmount = Object.values(advanceAmounts).reduce(
    (sum, value) => sum + Math.max(0, numberFromInput(value)),
    0,
  );
  const projectedCashAmount =
    selectedLiabilityAmount +
    numberFromInput(draftForm.penaltyAmount) +
    numberFromInput(draftForm.interestAmount) +
    numberFromInput(draftForm.advancePaymentAmount) -
    selectedAdvanceAmount;

  function openCreateDialog() {
    hydratedEditIdRef.current = null;
    setEditingId(null);
    setDraftForm(initialDraftForm());
    setAllocationAmounts({});
    setAdvanceAmounts({});
    setDraftOpen(true);
  }

  function openEditDialog(remittanceId: Id<"governmentRemittances">) {
    hydratedEditIdRef.current = null;
    setEditingId(remittanceId);
    setAllocationAmounts({});
    setAdvanceAmounts({});
    setDraftOpen(true);
  }

  function fillOutstandingLiabilities() {
    if (!liabilityCandidates) return;
    setAllocationAmounts(
      Object.fromEntries(
        liabilityCandidates.candidates
          .filter((candidate) => candidate.outstandingAmount > 0)
          .map((candidate) => [
            String(candidate.payrollRunId),
            candidate.outstandingAmount.toFixed(2),
          ]),
      ),
    );
  }

  async function saveDraft() {
    if (!organizationId) return;
    const allocations = Object.entries(allocationAmounts)
      .map(([payrollRunId, value]) => ({
        payrollRunId: payrollRunId as Id<"payrollRuns">,
        amount: numberFromInput(value),
      }))
      .filter((allocation) => allocation.amount > 0);
    const advanceApplications = Object.entries(advanceAmounts)
      .map(([sourceRemittanceId, value]) => ({
        sourceRemittanceId: sourceRemittanceId as Id<"governmentRemittances">,
        amount: numberFromInput(value),
      }))
      .filter((application) => application.amount > 0);
    if (allocations.length === 0) {
      toast({
        title: "Select a liability",
        description: "Enter an amount for at least one payroll liability.",
        variant: "destructive",
      });
      return;
    }
    if (selectedAdvanceAmount > selectedLiabilityAmount) {
      toast({
        title: "Advance is too large",
        description: "Applied advances cannot exceed the allocated liability.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const common = {
        periodStart: fromInputDate(draftForm.periodStart),
        periodEnd: fromInputDate(draftForm.periodEnd),
        dueDate: fromInputDate(draftForm.dueDate),
        allocations,
        penaltyAmount: numberFromInput(draftForm.penaltyAmount),
        interestAmount: numberFromInput(draftForm.interestAmount),
        advancePaymentAmount: numberFromInput(draftForm.advancePaymentAmount),
        advanceApplications,
        notes: draftForm.notes || undefined,
      };
      if (editingId) {
        await updateDraft({ remittanceId: editingId, ...common });
      } else {
        await createRemittance({
          organizationId,
          agency: draftForm.agency,
          ...common,
        });
      }
      setDraftOpen(false);
      setEditingId(null);
      toast({
        title: editingId ? "Draft updated" : "Remittance created",
        description: "The draft is ready for review.",
      });
    } catch (error) {
      toast({
        title: "Could not save remittance",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runImmediateAction(
    action: "submit" | "approve" | "retry",
    remittanceId: Id<"governmentRemittances">,
  ) {
    setBusy(true);
    try {
      if (action === "submit") await submitForReview({ remittanceId });
      if (action === "approve") await approveRemittance({ remittanceId });
      if (action === "retry") await retryRemittance({ remittanceId });
      toast({ title: "Remittance updated" });
    } catch (error) {
      toast({
        title: "Could not update remittance",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function openLifecycleDialog(
    action: LifecycleDialogAction,
    remittanceId: Id<"governmentRemittances">,
  ) {
    setLifecycleDialog({ action, remittanceId });
    setLifecycleValue("");
    setBankAccountLabel("");
    setLifecycleDate(toInputDate(Date.now()));
    setEvidenceFiles([]);
  }

  async function uploadEvidenceFiles(): Promise<Id<"_storage">[]> {
    if (!organizationId) return [];
    for (const file of evidenceFiles) {
      if (file.size > MAX_EVIDENCE_SIZE) {
        throw new Error(`${file.name} exceeds the 10 MB evidence limit.`);
      }
    }
    const storageIds = await Promise.all(
      evidenceFiles.map((file) =>
        uploadFileToStorage({
          organizationId: String(organizationId),
          purpose: "government_remittance_evidence",
          file,
        }),
      ),
    );
    return storageIds.map((storageId) => storageId as Id<"_storage">);
  }

  async function submitLifecycleDialog() {
    if (!lifecycleDialog) return;
    const { action, remittanceId } = lifecycleDialog;
    setBusy(true);
    try {
      if (action === "attach_evidence") {
        if (evidenceFiles.length === 0) {
          throw new Error("Select at least one evidence file.");
        }
        const storageIds = await uploadEvidenceFiles();
        await attachEvidence({ remittanceId, storageIds });
      } else if (action === "file") {
        const referenceNumber = validateGovernmentRemittanceLifecycleInput(
          "file",
          lifecycleValue,
        );
        const evidenceStorageIds =
          evidenceFiles.length > 0 ? await uploadEvidenceFiles() : undefined;
        await recordFiling({
          remittanceId,
          filedAt: fromInputDate(lifecycleDate),
          referenceNumber,
          evidenceStorageIds,
        });
      } else if (action === "pay") {
        const referenceNumber = validateGovernmentRemittanceLifecycleInput(
          "pay",
          lifecycleValue,
        );
        const evidenceStorageIds =
          evidenceFiles.length > 0 ? await uploadEvidenceFiles() : undefined;
        await recordPayment({
          remittanceId,
          paidAt: fromInputDate(lifecycleDate),
          referenceNumber,
          bankAccountLabel: bankAccountLabel.trim() || undefined,
          evidenceStorageIds,
        });
      } else if (action === "return_to_draft") {
        await returnToDraft({
          remittanceId,
          reason: validateGovernmentRemittanceLifecycleInput(
            action,
            lifecycleValue,
          ),
        });
      } else if (action === "cancel") {
        await cancelRemittance({
          remittanceId,
          reason: validateGovernmentRemittanceLifecycleInput(
            action,
            lifecycleValue,
          ),
        });
      } else if (action === "reverse") {
        await reverseRemittance({
          remittanceId,
          reason: validateGovernmentRemittanceLifecycleInput(
            action,
            lifecycleValue,
          ),
        });
      } else {
        await recordFailure({
          remittanceId,
          stage: action === "fail_filing" ? "filing" : "payment",
          reason: validateGovernmentRemittanceLifecycleInput(
            action,
            lifecycleValue,
          ),
        });
      }
      setLifecycleDialog(null);
      toast({ title: "Remittance updated" });
    } catch (error) {
      toast({
        title: "Could not update remittance",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleAction(action: GovernmentRemittanceAction, row: Remittance) {
    if (action === "view") {
      setSelectedDetailId(row._id);
      return;
    }
    if (action === "edit") {
      openEditDialog(row._id);
      return;
    }
    if (action === "submit" || action === "approve" || action === "retry") {
      void runImmediateAction(action, row._id);
      return;
    }
    openLifecycleDialog(action, row._id);
  }

  async function openEvidence(storageId: Id<"_storage">) {
    if (!organizationId) return;
    try {
      const url = await getFileUrl(String(organizationId), String(storageId));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Evidence is unavailable",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  }

  if (user === null || (user !== undefined && !hasAccess)) return null;

  return (
    <MainLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Button
              type="button"
              variant="ghost"
              className="mb-2 -ml-3 text-gray-600"
              onClick={() =>
                organizationId &&
                router.push(getOrganizationPath(organizationId, "/accounting"))
              }
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Accounting
            </Button>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Government Remittances
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Reconcile, file, and settle BIR, SSS, PhilHealth, and Pag-IBIG
              liabilities separately from employee payroll payments.
            </p>
          </div>
          <Button onClick={openCreateDialog} disabled={!organizationId || busy}>
            <Plus className="mr-2 h-4 w-4" />
            New remittance
          </Button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Outstanding liabilities
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <p className="text-2xl font-semibold">
                  {liabilityOverview
                    ? formatCurrency(liabilityOverview.totals.outstandingAmount)
                    : "—"}
                </p>
                <Landmark className="h-5 w-5 text-purple-600" />
              </div>
              <Select
                value={summaryAgency}
                onValueChange={(value) =>
                  setSummaryAgency(value as GovernmentAgency)
                }
              >
                <SelectTrigger className="mt-3 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {liabilityOverview &&
              liabilityOverview.totals.overRemittedAmount > 0 ? (
                <p className="mt-2 text-xs font-medium text-red-600">
                  {formatCurrency(liabilityOverview.totals.overRemittedAmount)}{" "}
                  over-remitted after payroll corrections
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Awaiting filing
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-2xl font-semibold">{awaitingFiling}</p>
              <FileCheck2 className="h-5 w-5 text-blue-600" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Awaiting payment or retry
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-2xl font-semibold">{awaitingPayment}</p>
              <WalletCards className="h-5 w-5 text-amber-600" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Cash remitted
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-2xl font-semibold">
                {formatCurrency(remittedTotal)}
              </p>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Remittance register</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Agency</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Liability</TableHead>
                    <TableHead>Cash amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remittances === undefined ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={8}>
                          <div className="h-5 animate-pulse rounded bg-gray-100" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : remittanceRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-40 text-center">
                        <Landmark className="mx-auto mb-3 h-8 w-8 text-gray-300" />
                        <p className="font-medium text-gray-700">
                          No government remittances yet
                        </p>
                        <p className="mt-1 text-sm text-gray-500">
                          Create one from a finalized payroll liability.
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    remittanceRows.map((row) => {
                      const actions = role
                        ? getGovernmentRemittanceActions(row.status, role)
                        : [];
                      return (
                        <TableRow key={row._id}>
                          <TableCell className="font-medium">
                            {row.remittanceNumber}
                          </TableCell>
                          <TableCell>{agencyLabel(row.agency)}</TableCell>
                          <TableCell>
                            {formatDate(row.periodStart)} –{" "}
                            {formatDate(row.periodEnd)}
                          </TableCell>
                          <TableCell>{formatDate(row.dueDate)}</TableCell>
                          <TableCell>
                            {formatCurrency(row.liabilityAmount)}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(row.cashAmount)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={statusClass(row.status)}
                            >
                              {STATUS_LABELS[row.status]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={busy}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">
                                    Remittance actions
                                  </span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {actions.map((action) => (
                                  <DropdownMenuItem
                                    key={action}
                                    onClick={() => handleAction(action, row)}
                                    className={
                                      action === "reverse" ||
                                      action === "cancel"
                                        ? "text-red-600"
                                        : undefined
                                    }
                                  >
                                    {ACTION_LABELS[action]}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={draftOpen}
        onOpenChange={(open) => {
          if (!busy) setDraftOpen(open);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? "Edit remittance draft"
                : "New government remittance"}
            </DialogTitle>
            <DialogDescription>
              Drafts do not reserve liabilities. Availability is checked again
              when an owner or admin approves the remittance.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Agency</Label>
              <Select
                value={draftForm.agency}
                disabled={Boolean(editingId)}
                onValueChange={(value) => {
                  setDraftForm((current) => ({
                    ...current,
                    agency: value as GovernmentAgency,
                  }));
                  setAllocationAmounts({});
                  setAdvanceAmounts({});
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(["periodStart", "periodEnd", "dueDate"] as const).map((field) => (
              <div key={field} className="space-y-2">
                <Label>
                  {field === "periodStart"
                    ? "Period start"
                    : field === "periodEnd"
                      ? "Period end"
                      : "Due date"}
                </Label>
                <Input
                  type="date"
                  value={draftForm[field]}
                  onChange={(event) =>
                    setDraftForm((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h3 className="font-medium">Payroll liabilities</h3>
                <p className="text-xs text-gray-500">
                  Enter the amount to remit from each payroll run.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fillOutstandingLiabilities}
                disabled={!liabilityCandidates}
              >
                Use outstanding
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payroll period</TableHead>
                    <TableHead>Accrued</TableHead>
                    <TableHead>Reserved</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead className="w-40">This remittance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liabilityCandidates === undefined ? (
                    <TableRow>
                      <TableCell colSpan={6}>Loading liabilities…</TableCell>
                    </TableRow>
                  ) : liabilityCandidates.candidates.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-gray-500"
                      >
                        No payroll liabilities found for this agency and period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    liabilityCandidates.candidates.map((candidate) => (
                      <TableRow key={candidate.payrollRunId}>
                        <TableCell>{candidate.period}</TableCell>
                        <TableCell>
                          {formatCurrency(candidate.accruedAmount)}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(candidate.reservedAmount)}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(candidate.paidAmount)}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(candidate.outstandingAmount)}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={
                              allocationAmounts[
                                String(candidate.payrollRunId)
                              ] ?? ""
                            }
                            onChange={(event) =>
                              setAllocationAmounts((current) => ({
                                ...current,
                                [String(candidate.payrollRunId)]:
                                  event.target.value,
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {liabilityCandidates && liabilityCandidates.advances.length > 0 ? (
            <div className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <h3 className="font-medium">Available agency advances</h3>
                <p className="text-xs text-gray-500">
                  Apply a prior same-agency overpayment before cash is
                  calculated.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead className="w-40">Apply</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liabilityCandidates.advances.map((advance) => (
                    <TableRow key={advance.sourceRemittanceId}>
                      <TableCell>{advance.remittanceNumber}</TableCell>
                      <TableCell>
                        {formatCurrency(advance.availableAmount)}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max={advance.availableAmount}
                          step="0.01"
                          value={
                            advanceAmounts[
                              String(advance.sourceRemittanceId)
                            ] ?? ""
                          }
                          onChange={(event) =>
                            setAdvanceAmounts((current) => ({
                              ...current,
                              [String(advance.sourceRemittanceId)]:
                                event.target.value,
                            }))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                ["penaltyAmount", "Penalties"],
                ["interestAmount", "Interest"],
                ["advancePaymentAmount", "New advance / overpayment"],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="space-y-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftForm[field]}
                  onChange={(event) =>
                    setDraftForm((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Internal notes</Label>
            <Textarea
              value={draftForm.notes}
              onChange={(event) =>
                setDraftForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              maxLength={2_000}
            />
          </div>
          <div className="grid gap-3 rounded-lg bg-gray-50 p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">Liability</p>
              <p className="font-semibold">
                {formatCurrency(selectedLiabilityAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Advance applied</p>
              <p className="font-semibold">
                {formatCurrency(selectedAdvanceAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Projected cash</p>
              <p className="font-semibold">
                {formatCurrency(projectedCashAmount)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDraftOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={saveDraft} disabled={busy || !liabilityCandidates}>
              {busy ? "Saving…" : "Save draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(lifecycleDialog)}
        onOpenChange={(open) => !open && !busy && setLifecycleDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {lifecycleDialog
                ? ACTION_LABELS[lifecycleDialog.action]
                : "Update remittance"}
            </DialogTitle>
            <DialogDescription>
              {lifecycleDialog?.action === "reverse"
                ? "This posts an equal and opposite journal. The original payment remains in the audit history."
                : lifecycleDialog?.action === "file"
                  ? "Filing records the return but does not post an accounting entry."
                  : lifecycleDialog?.action === "pay"
                    ? "Payment settles the government liability and posts the cash journal."
                    : "This action is recorded in the operational audit trail."}
            </DialogDescription>
          </DialogHeader>
          {lifecycleDialog?.action === "file" ||
          lifecycleDialog?.action === "pay" ? (
            <>
              <div className="space-y-2">
                <Label>
                  {lifecycleDialog.action === "file"
                    ? "Filing date"
                    : "Payment date"}
                </Label>
                <Input
                  type="date"
                  value={lifecycleDate}
                  onChange={(event) => setLifecycleDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {lifecycleDialog.action === "file"
                    ? "Filing reference number"
                    : "Payment reference number"}
                </Label>
                <Input
                  value={lifecycleValue}
                  onChange={(event) => setLifecycleValue(event.target.value)}
                  maxLength={200}
                />
              </div>
              {lifecycleDialog.action === "pay" ? (
                <div className="space-y-2">
                  <Label>Bank account label or last four digits</Label>
                  <Input
                    value={bankAccountLabel}
                    onChange={(event) =>
                      setBankAccountLabel(event.target.value)
                    }
                    maxLength={200}
                  />
                </div>
              ) : null}
            </>
          ) : lifecycleDialog?.action !== "attach_evidence" ? (
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea
                value={lifecycleValue}
                onChange={(event) => setLifecycleValue(event.target.value)}
                maxLength={1_000}
              />
            </div>
          ) : null}
          {lifecycleDialog?.action === "file" ||
          lifecycleDialog?.action === "pay" ||
          lifecycleDialog?.action === "attach_evidence" ? (
            <div className="space-y-2">
              <Label>
                Evidence files{" "}
                {lifecycleDialog.action === "attach_evidence"
                  ? ""
                  : "(optional)"}
              </Label>
              <Input
                type="file"
                multiple
                accept="application/pdf,image/*,.csv,.xls,.xlsx,.doc,.docx"
                onChange={(event) =>
                  setEvidenceFiles(Array.from(event.target.files ?? []))
                }
              />
              <p className="text-xs text-gray-500">
                Up to 20 files, 10 MB each.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLifecycleDialog(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={submitLifecycleDialog}
              disabled={busy}
              variant={
                lifecycleDialog?.action === "reverse"
                  ? "destructive"
                  : "default"
              }
            >
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedDetailId)}
        onOpenChange={(open) => !open && setSelectedDetailId(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedDetail?.remittanceNumber ?? "Remittance details"}
            </DialogTitle>
            <DialogDescription>
              Filing, payment, allocation, and accounting details.
            </DialogDescription>
          </DialogHeader>
          {selectedDetail ? (
            <RemittanceDetailContent
              detail={selectedDetail}
              onOpenEvidence={(storageId) => void openEvidence(storageId)}
            />
          ) : (
            <div className="py-10 text-center text-gray-500">
              Loading details…
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDetailId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

function RemittanceDetailContent({
  detail,
  onOpenEvidence,
}: {
  detail: RemittanceDetail;
  onOpenEvidence: (storageId: Id<"_storage">) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-lg bg-gray-50 p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-gray-500">Agency</p>
          <p className="font-medium">{agencyLabel(detail.agency)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Status</p>
          <Badge variant="outline" className={statusClass(detail.status)}>
            {STATUS_LABELS[detail.status]}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-gray-500">Due date</p>
          <p className="font-medium">{formatDate(detail.dueDate)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Liability</p>
          <p className="font-medium">
            {formatCurrency(detail.liabilityAmount)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Advance applied</p>
          <p className="font-medium">
            {formatCurrency(detail.advanceAppliedAmount)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Cash amount</p>
          <p className="font-medium">{formatCurrency(detail.cashAmount)}</p>
        </div>
      </div>
      {detail.filingDetails ? (
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 font-medium">
            <FileCheck2 className="h-4 w-4" />
            Filing
          </div>
          <p className="mt-2 text-sm">
            Reference: {detail.filingDetails.referenceNumber}
          </p>
          <p className="text-sm text-gray-500">
            Filed {formatDate(detail.filedAt)}
          </p>
        </div>
      ) : null}
      {detail.paymentDetails ? (
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4" />
            Payment
          </div>
          <p className="mt-2 text-sm">
            Reference: {detail.paymentDetails.referenceNumber}
          </p>
          {detail.paymentDetails.bankAccountLabel ? (
            <p className="text-sm">
              Bank: {detail.paymentDetails.bankAccountLabel}
            </p>
          ) : null}
          <p className="text-sm text-gray-500">
            Paid {formatDate(detail.paidAt)}
          </p>
        </div>
      ) : null}
      {detail.failureDetails ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {detail.failureDetails.stage === "filing"
              ? "Filing"
              : "Payment"}{" "}
            failure
          </div>
          <p className="mt-2 text-sm">{detail.failureDetails.reason}</p>
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 font-medium">Payroll allocations</h3>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payroll run</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.allocations.map((allocation) => (
                <TableRow key={allocation._id}>
                  <TableCell className="font-mono text-xs">
                    {String(allocation.payrollRunId)}
                  </TableCell>
                  <TableCell>{allocation.liabilityAccountCode}</TableCell>
                  <TableCell>{formatCurrency(allocation.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <div>
        <h3 className="mb-2 font-medium">Evidence</h3>
        {detail.evidence.length === 0 ? (
          <p className="text-sm text-gray-500">No evidence attached.</p>
        ) : (
          <div className="space-y-2">
            {detail.evidence.map((file) => (
              <button
                key={String(file.storageId)}
                type="button"
                onClick={() => onOpenEvidence(file.storageId)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-gray-50"
              >
                <Paperclip className="h-4 w-4 text-gray-500" />
                <span className="flex-1 truncate text-sm">
                  {file.fileName ?? "Evidence file"}
                </span>
                <Eye className="h-4 w-4 text-gray-400" />
              </button>
            ))}
          </div>
        )}
      </div>
      {detail.notes ? (
        <div>
          <h3 className="font-medium">Internal notes</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">
            {detail.notes}
          </p>
        </div>
      ) : null}
      {detail.reversalReason ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2 font-medium">
            <RotateCcw className="h-4 w-4" />
            Reversal reason
          </div>
          <p className="mt-2 text-sm">{detail.reversalReason}</p>
        </div>
      ) : null}
    </div>
  );
}
