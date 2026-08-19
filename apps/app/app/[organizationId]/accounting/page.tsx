"use client";

import {
  Fragment,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  AlertCircle,
  Calendar,
  FileText,
  X,
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import {
  createCostItem,
  updateCostItem,
  deleteCostItem,
  repairPayrollAccounting,
} from "@/actions/accounting";
import { getFileUrl } from "@/actions/files";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { useToast } from "@/components/ui/use-toast";
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";
import {
  DashboardMetricCard,
} from "@/components/dashboard";
import {
  groupPayrollCostItems,
  isPayrollGeneratedCostItem,
} from "@/lib/accounting/payroll-cost-groups";

const REQUIRED_CATEGORIES = [
  {
    name: "Employee Related Cost",
    description:
      "Costs related to employees including payroll, benefits, and leave",
  },
  {
    name: "Operational Cost",
    description: "Operational expenses for running the business",
  },
] as const;

const PAGE_SIZE_OPTIONS = [30, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 30;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_ATTACHMENT_TYPES = [
  "image/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];
const ACCEPTED_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
];
type AccountingCostItem = FunctionReturnType<
  typeof api.accounting.getCostItems
>[number];
type PayrollRun = FunctionReturnType<typeof api.payroll.getPayrollRuns>[number];
type PayrollBreakdownRow = {
  employeeId: Id<"employees">;
  employeeName: string;
  grossPay?: number;
  nonTaxableAllowance?: number;
  totalIncentives?: number;
  totalDeductions?: number;
  incentiveItems?: Array<{ name: string; amount: number; type?: string }>;
  deductionItems?: Array<{ name: string; amount: number; type?: string }>;
  netPay?: number;
};
type ContributionBreakdownRow = {
  employeeId: Id<"employees">;
  employeeName: string;
  employeeAmount?: number;
  companyAmount?: number;
};

function formatCurrency(value: number | null | undefined) {
  return `₱${Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function AccountingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const orgId = currentOrganizationId as Id<"organizations"> | undefined;

  const user = useQuery(
    api.organizations.getCurrentUser,
    orgId ? { organizationId: orgId } : "skip",
  );
  const costItemsFromQuery = useQuery(
    api.accounting.getCostItems,
    orgId ? { organizationId: orgId } : "skip",
  );
  const payrollRuns = useQuery(
    api.payroll.getPayrollRuns,
    orgId ? { organizationId: orgId } : "skip",
  );
  const payrollAccountingDrift = useQuery(
    api.accounting.findPayrollAccountingDrift,
    orgId ? { organizationId: orgId } : "skip",
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AccountingCostItem | null>(
    null,
  );
  const [selectedCategoryName, setSelectedCategoryName] = useState<
    string | null
  >(null);
  const [uploadingReceipts, setUploadingReceipts] = useState(false);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [receiptUrls, setReceiptUrls] = useState<{ url: string; id: string }[]>(
    [],
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [breakdownDialogOpen, setBreakdownDialogOpen] = useState(false);
  const [selectedBreakdownItem, setSelectedBreakdownItem] =
    useState<AccountingCostItem | null>(null);
  const [detailAttachmentUrls, setDetailAttachmentUrls] = useState<
    { url: string; id: string }[]
  >([]);
  const [detailImageLoadErrors, setDetailImageLoadErrors] = useState<
    Record<string, boolean>
  >({});
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [categoryPage, setCategoryPage] = useState<Record<string, number>>({});
  const [repairingPayrollAccounting, setRepairingPayrollAccounting] =
    useState(false);
  const [expandedPayrollCostGroup, setExpandedPayrollCostGroup] = useState<
    string | null
  >(null);

  const [itemFormData, setItemFormData] = useState({
    name: "",
    description: "",
    amount: "",
    amountPaid: "",
    frequency: "one-time" as
      | "one-time"
      | "daily"
      | "weekly"
      | "monthly"
      | "yearly",
    status: "pending" as "pending" | "partial" | "paid" | "overdue",
    dueDate: "",
    notes: "",
  });

  const hasAccess =
    user !== undefined &&
    user != null &&
    (user.role === "accounting" ||
      user.role === "admin" ||
      user.role === "owner");

  const categories = REQUIRED_CATEGORIES;
  const costItems = useMemo(
    () => costItemsFromQuery ?? [],
    [costItemsFromQuery],
  );
  const loading = costItemsFromQuery === undefined;
  const payrollRunsLoading = payrollRuns === undefined;
  const dataLoading = user === undefined || loading;
  const reconciliationLoading = dataLoading || payrollRunsLoading;

  // Redirect if no access
  useEffect(() => {
    if (user !== undefined && !hasAccess) {
      router.replace(
        getOrganizationPath(currentOrganizationId ?? "", "/forbidden"),
      );
    }
  }, [user, hasAccess, router, currentOrganizationId]);

  const itemsByCategoryName = useMemo(() => {
    const map = new Map<string, AccountingCostItem[]>();
    for (const item of costItems) {
      const name = item.categoryName ?? "Employee Related Cost";
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(item);
    }
    return map;
  }, [costItems]);

  const getItemsForCategory = useCallback(
    (categoryName: string) => {
      const items = itemsByCategoryName.get(categoryName) ?? [];
      return categoryName === "Employee Related Cost"
        ? items.filter((item) => !isPayrollGeneratedCostItem(item))
        : items;
    },
    [itemsByCategoryName],
  );

  const getPaginatedItems = useCallback(
    (categoryName: string) => {
      const items = getItemsForCategory(categoryName);
      const page = categoryPage[categoryName] ?? 1;
      const start = (page - 1) * pageSize;
      return items.slice(start, start + pageSize);
    },
    [getItemsForCategory, categoryPage, pageSize],
  );

  const setPageForCategory = useCallback(
    (categoryName: string, page: number) => {
      setCategoryPage((prev) => ({ ...prev, [categoryName]: page }));
    },
    [],
  );

  const totalPagesForCategory = useCallback(
    (categoryName: string) => {
      const total = getItemsForCategory(categoryName).length;
      return Math.max(1, Math.ceil(total / pageSize));
    },
    [getItemsForCategory, pageSize],
  );

  const categoryTotals = useMemo(() => {
    const out: Record<
      string,
      { total: number; paid: number; remaining: number }
    > = {};
    for (const cat of categories) {
      const items = itemsByCategoryName.get(cat.name) ?? [];
      const total = items.reduce((s, i) => s + (i.amount ?? 0), 0);
      const paid = items.reduce((s, i) => s + (i.amountPaid ?? 0), 0);
      out[cat.name] = { total, paid, remaining: total - paid };
    }
    return out;
  }, [categories, itemsByCategoryName]);

  const handleOpenItemDialog = useCallback(
    (categoryName?: string, item?: AccountingCostItem) => {
      if (item) {
        setEditingItem(item);
        setItemFormData({
          name: item.name,
          description: item.description || "",
          amount: item.amount.toString(),
          amountPaid: (item.amountPaid || 0).toString(),
          frequency: item.frequency || "one-time",
          status: item.status || "pending",
          dueDate: item.dueDate
            ? new Date(item.dueDate).toISOString().split("T")[0]
            : "",
          notes: item.notes || "",
        });
        setSelectedCategoryName(item.categoryName ?? "Employee Related Cost");
        // Load existing receipt URLs
        if (
          currentOrganizationId &&
          item.receipts &&
          item.receipts.length > 0
        ) {
          Promise.all(
            item.receipts.map(async (id: string) => {
              const url = await getFileUrl(currentOrganizationId, id);
              return { url, id };
            }),
          ).then((receipts) => setReceiptUrls(receipts));
        } else {
          setReceiptUrls([]);
        }
        setReceiptFiles([]);
      } else {
        setEditingItem(null);
        setItemFormData({
          name: "",
          description: "",
          amount: "",
          amountPaid: "",
          frequency: "one-time",
          status: "pending",
          dueDate: "",
          notes: "",
        });
        setSelectedCategoryName(categoryName ?? null);
        setReceiptUrls([]);
        setReceiptFiles([]);
      }
      setIsItemDialogOpen(true);
    },
    [currentOrganizationId],
  );

  const handleCloseItemDialog = () => {
    setIsItemDialogOpen(false);
    setEditingItem(null);
    setItemFormData({
      name: "",
      description: "",
      amount: "",
      amountPaid: "",
      frequency: "one-time",
      status: "pending",
      dueDate: "",
      notes: "",
    });
    setSelectedCategoryName(null);
    setReceiptUrls([]);
    setReceiptFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const validFiles = files.filter((file) => {
        if (!isAcceptedAttachment(file)) {
          toast({
            title: "Invalid attachment type",
            description:
              "Only images, document files, and spreadsheet files are allowed.",
            variant: "destructive",
          });
          return false;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          toast({
            title: "Attachment too large",
            description: "Each attachment must be 10 MB or smaller.",
            variant: "destructive",
          });
          return false;
        }

        return true;
      });
      setReceiptFiles((prev) => [...prev, ...validFiles]);
      e.target.value = "";
    }
  };

  const removeReceiptFile = (index: number) => {
    setReceiptFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeReceiptUrl = (index: number) => {
    setReceiptUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !selectedCategoryName) return;

    try {
      setUploadingReceipts(true);
      const receiptIds: string[] = [];

      // Upload new receipt files
      for (const file of receiptFiles) {
        const storageId = await uploadFileToStorage({
          organizationId: currentOrganizationId,
          purpose: "accounting_receipt",
          file,
        });
        receiptIds.push(storageId);
      }

      // Add existing receipt IDs that weren't removed
      if (editingItem && editingItem.receipts) {
        const remainingReceiptIds = receiptUrls
          .map((r) => r.id)
          .filter((id) => editingItem.receipts.includes(id));
        receiptIds.push(...remainingReceiptIds);
      }

      // Calculate status based on amountPaid
      const amount = parseFloat(itemFormData.amount);
      const amountPaid = parseFloat(itemFormData.amountPaid || "0");
      if (amountPaid > amount) {
        toast({
          title: "Invalid amount paid",
          description: "Amount paid cannot be greater than the total amount.",
          variant: "destructive",
        });
        return;
      }
      let status = itemFormData.status;

      if (amountPaid === 0) {
        status = "pending";
      } else if (amountPaid >= amount) {
        status = "paid";
      } else {
        status = "partial";
      }

      // Check if overdue
      if (itemFormData.dueDate) {
        const dueDate = new Date(itemFormData.dueDate).getTime();
        if (dueDate < Date.now() && status !== "paid") {
          status = "overdue";
        }
      }

      if (editingItem) {
        await updateCostItem({
          itemId: editingItem._id,
          name: itemFormData.name,
          description: itemFormData.description || undefined,
          amount: amount,
          amountPaid: amountPaid,
          frequency: itemFormData.frequency,
          status: status,
          dueDate: itemFormData.dueDate
            ? new Date(itemFormData.dueDate).getTime()
            : undefined,
          notes: itemFormData.notes || undefined,
          receipts: receiptIds.length > 0 ? receiptIds : undefined,
        });
        toast({
          title: "Success",
          description: "Expense updated successfully",
        });
      } else {
        await createCostItem({
          organizationId: currentOrganizationId,
          categoryName: selectedCategoryName,
          name: itemFormData.name,
          description: itemFormData.description || undefined,
          amount: amount,
          amountPaid: amountPaid,
          frequency: itemFormData.frequency,
          status: status,
          dueDate: itemFormData.dueDate
            ? new Date(itemFormData.dueDate).getTime()
            : undefined,
          notes: itemFormData.notes || undefined,
          receipts: receiptIds.length > 0 ? receiptIds : undefined,
        });
        toast({
          title: "Success",
          description: "Expense created successfully",
        });
      }

      handleCloseItemDialog();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to save expense"),
        variant: "destructive",
      });
    } finally {
      setUploadingReceipts(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    setDeleting(true);
    try {
      await deleteCostItem(itemId);
      toast({
        title: "Success",
        description: "Expense deleted successfully",
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error, "Failed to delete expense"),
        variant: "destructive",
      });
    }
    setDeleting(false);
    setDeleteDialogOpen(false);
    setDeleteItemId(null);
  };

  const handleRepairPayrollAccounting = async () => {
    if (!currentOrganizationId) return;

    try {
      setRepairingPayrollAccounting(true);
      const result = await repairPayrollAccounting({
        organizationId: currentOrganizationId,
      });
      toast({
        title: "Payroll accounting repaired",
        description: `${result.repairedRuns} run(s), ${result.created} created, ${result.updated} updated, ${result.deleted} removed.`,
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(
          error,
          "Failed to repair payroll accounting",
        ),
        variant: "destructive",
      });
    } finally {
      setRepairingPayrollAccounting(false);
    }
  };

  // Using centralized color system from utils/colors

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return "--";
    return new Date(timestamp).toLocaleDateString();
  };

  const isAcceptedAttachment = (file: File) =>
    ACCEPTED_ATTACHMENT_TYPES.some((type) =>
      type.endsWith("/") ? file.type.startsWith(type) : file.type === type,
    ) ||
    ACCEPTED_ATTACHMENT_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext),
    );

  const isImageAttachment = (value: File | string) => {
    if (typeof value !== "string") {
      return value.type.startsWith("image/");
    }
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(value);
  };

  const openDetailsDialog = async (item: AccountingCostItem) => {
    setSelectedBreakdownItem(item);
    setBreakdownDialogOpen(true);
    setDetailImageLoadErrors({});

    if (currentOrganizationId && item.receipts?.length) {
      const attachments = await Promise.all(
        item.receipts.map(async (id: string) => ({
          id,
          url: await getFileUrl(currentOrganizationId, id),
        })),
      );
      setDetailAttachmentUrls(attachments);
      return;
    }

    setDetailAttachmentUrls([]);
  };

  const payrollCostGroups = useMemo(
    () =>
      groupPayrollCostItems(
        costItems.map((item) => ({
          id: String(item._id),
          payrollRunId: item.payrollRunId
            ? String(item.payrollRunId)
            : undefined,
          sourceType: item.sourceType,
          name: item.name,
          amount: item.amount,
          amountPaid: item.amountPaid,
          status: item.status,
          updatedAt: item.updatedAt,
          createdAt: item.createdAt,
          source: item,
        })),
        (payrollRuns ?? []).map((run: PayrollRun) => ({
          id: String(run._id),
          status: run.status,
          runType: run.runType ?? "regular",
          period: run.period,
          updatedAt: run.updatedAt,
          createdAt: run.createdAt,
        })),
      ),
    [costItems, payrollRuns],
  );

  const isEditingLockedCostItem =
    editingItem && isPayrollGeneratedCostItem(editingItem);
  const isTaxBreakdownItem =
    selectedBreakdownItem?.name?.startsWith("Tax Employee Deductions - ");
  const receiptFilePreviews = useMemo(
    () =>
      receiptFiles.map((file) => ({
        file,
        previewUrl: isImageAttachment(file) ? URL.createObjectURL(file) : null,
      })),
    [receiptFiles],
  );

  useEffect(() => {
    return () => {
      receiptFilePreviews.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [receiptFilePreviews]);

  if (user === null) return null;
  if (user !== undefined && !hasAccess) return null;

  return (
    <>
      <MainLayout>
        <div className="p-4 sm:p-6 lg:p-8">
          <header>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Accounting
            </h1>
            <p className="mt-1 text-sm text-[rgb(105,105,105)]">
              Track payroll-generated costs and operational expenses.
            </p>
          </header>

          {/* Summary metric cards */}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {dataLoading
              ? categories.map((category) => (
                  <div
                    key={category.name}
                    className="rounded-xl border border-[rgb(230,230,230)] bg-white p-4 sm:p-6 animate-pulse"
                  >
                    <div className="h-4 w-40 rounded bg-[rgb(240,240,240)]" />
                    <div className="mt-3 h-8 w-32 rounded bg-[rgb(245,245,245)]" />
                    <div className="mt-2 h-3 w-full max-w-xs rounded bg-[rgb(248,248,248)]" />
                  </div>
                ))
              : categories.map((category) => {
                  const { total, paid, remaining } = categoryTotals[
                    category.name
                  ] ?? {
                    total: 0,
                    paid: 0,
                    remaining: 0,
                  };
                  return (
                    <DashboardMetricCard
                      key={category.name}
                      title={category.name}
                      value={
                        <>
                          ₱
                          {total.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </>
                      }
                      secondary={`₱${paid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid · ₱${remaining.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remaining`}
                      moreDetailsHref="#expenses"
                      moreDetailsLabel="View expenses"
                    />
                  );
                })}
          </div>

          {(reconciliationLoading || payrollCostGroups.length > 0) && (
            <div className="mt-6 rounded-lg border border-[rgb(230,230,230)] bg-white">
              <div className="flex flex-col gap-3 border-b border-[rgb(230,230,230)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 className="text-base font-semibold text-[rgb(64,64,64)]">
                    Payroll costs
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-[rgb(105,105,105)]">
                    One record per payroll run. Expand a run to review and
                    manage net pay, statutory contributions, and withholding
                    tax separately.
                  </p>
                </div>
                {payrollAccountingDrift?.driftCount ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRepairPayrollAccounting}
                    disabled={
                      repairingPayrollAccounting ||
                      !currentOrganizationId ||
                      reconciliationLoading
                    }
                    className="shrink-0 border-red-200 text-red-700 sm:self-center"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    {repairingPayrollAccounting
                      ? "Repairing records..."
                      : "Repair payroll accounting"}
                    <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                      {payrollAccountingDrift.driftCount}
                    </span>
                  </Button>
                ) : null}
              </div>
              {reconciliationLoading ? (
                <div className="overflow-x-auto p-4 sm:p-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <TableHead key={index}>
                            <div className="h-4 w-20 animate-pulse rounded bg-[rgb(245,245,245)]" />
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from({ length: 3 }).map((_, rowIndex) => (
                        <TableRow key={rowIndex}>
                          {Array.from({ length: 6 }).map((__, cellIndex) => (
                            <TableCell key={cellIndex}>
                              <div className="h-4 w-full max-w-[96px] animate-pulse rounded bg-[rgb(245,245,245)]" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="overflow-x-auto p-4 sm:p-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payroll Period</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-12">
                          <span className="sr-only">Details</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollCostGroups.map((group) => {
                        const expanded = expandedPayrollCostGroup === group.key;
                        return (
                          <Fragment key={group.key}>
                            <TableRow>
                              <TableCell className="font-medium">
                                <div>{group.period}</div>
                                <div className="mt-1 text-xs capitalize text-[rgb(133,133,133)]">
                                  {String(group.runType ?? "regular").replaceAll(
                                    "_",
                                    " ",
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatCurrency(group.total)}
                              </TableCell>
                              <TableCell className="text-right text-green-700">
                                {formatCurrency(group.paidTotal)}
                              </TableCell>
                              <TableCell className="text-right text-orange-700">
                                {formatCurrency(group.remaining)}
                              </TableCell>
                              <TableCell>
                                {group.status === "missing" ? (
                                  <Badge className="border border-red-200 bg-red-50 text-red-700 hover:bg-red-50">
                                    Missing records
                                  </Badge>
                                ) : (
                                  <Badge
                                    className={getStatusBadgeClass(group.status)}
                                    style={getStatusBadgeStyle(group.status)}
                                  >
                                    {group.status.charAt(0).toUpperCase() +
                                      group.status.slice(1)}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-expanded={expanded}
                                  aria-label={
                                    expanded
                                      ? "Collapse payroll cost details"
                                      : "Expand payroll cost details"
                                  }
                                  onClick={() =>
                                    setExpandedPayrollCostGroup(
                                      expanded ? null : group.key,
                                    )
                                  }
                                >
                                  {expanded ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {expanded ? (
                              <TableRow className="bg-muted/20 hover:bg-muted/20">
                                <TableCell colSpan={6} className="p-0">
                                  {group.components.length === 0 ? (
                                    <div className="px-6 py-5 text-sm text-red-700">
                                      This finalized run has no matching accounting
                                      records. Use Repair payroll accounting above.
                                    </div>
                                  ) : (
                                    <div className="divide-y border-t">
                                      {group.components.map((component) => {
                                        const item = component.item.source;
                                        const remaining = Math.max(
                                          0,
                                          (item.amount ?? 0) -
                                            (item.amountPaid ?? 0),
                                        );
                                        return (
                                          <div
                                            key={component.item.id}
                                            className="grid gap-3 px-6 py-4 sm:grid-cols-[minmax(180px,1fr)_repeat(3,minmax(100px,auto))_auto] sm:items-center"
                                          >
                                            <div>
                                              <p className="font-medium">
                                                {component.label}
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                Paid or remitted separately
                                              </p>
                                            </div>
                                            <div className="text-sm sm:text-right">
                                              <span className="mr-2 text-muted-foreground sm:hidden">
                                                Amount
                                              </span>
                                              {formatCurrency(item.amount)}
                                            </div>
                                            <div className="text-sm text-green-700 sm:text-right">
                                              <span className="mr-2 text-muted-foreground sm:hidden">
                                                Paid
                                              </span>
                                              {formatCurrency(item.amountPaid)}
                                            </div>
                                            <div className="text-sm text-orange-700 sm:text-right">
                                              <span className="mr-2 text-muted-foreground sm:hidden">
                                                Remaining
                                              </span>
                                              {formatCurrency(remaining)}
                                            </div>
                                            <div className="flex justify-end gap-1">
                                              {item.breakdown ? (
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  onClick={() =>
                                                    void openDetailsDialog(item)
                                                  }
                                                  aria-label={`View ${component.label} breakdown`}
                                                >
                                                  <Eye className="h-4 w-4" />
                                                </Button>
                                              ) : null}
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                  handleOpenItemDialog(
                                                    "Employee Related Cost",
                                                    item,
                                                  )
                                                }
                                                aria-label={`Update ${component.label} payment`}
                                              >
                                                <Edit className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {/* Expense Categories */}
          <div id="expenses" className="mt-6 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Expense records
                </h2>
                <p className="mt-1 text-sm text-[rgb(105,105,105)]">
                  Review manually recorded employee and operational expenses.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="accounting-page-size"
                  className="whitespace-nowrap text-sm font-normal text-[rgb(105,105,105)]"
                >
                  Rows per page
                </Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setCategoryPage({});
                  }}
                >
                  <SelectTrigger
                    id="accounting-page-size"
                    className="h-9 w-[76px] border-[rgb(230,230,230)] bg-white"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {categories.map((category) => {
              const allCategoryItems = getItemsForCategory(category.name);
              const categoryItems = getPaginatedItems(category.name);
              const currentPage = categoryPage[category.name] ?? 1;
              const totalPages = totalPagesForCategory(category.name);
              const start = (currentPage - 1) * pageSize;
              const end = Math.min(start + pageSize, allCategoryItems.length);
              return (
                <Card key={category.name} className="border-[rgb(230,230,230)]">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-xl">
                          {category.name === "Employee Related Cost"
                            ? "Other employee costs"
                            : category.name}
                        </CardTitle>
                        {category.description && (
                          <p className="text-sm text-gray-600 mt-1">
                            {category.name === "Employee Related Cost"
                              ? "Manual employee costs outside payroll runs"
                              : category.description}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() => handleOpenItemDialog(category.name)}
                        size="sm"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Expense
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {dataLoading ? (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Paid</TableHead>
                              <TableHead>Remaining</TableHead>
                              <TableHead>Frequency</TableHead>
                              <TableHead>Due Date</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Array.from({ length: 5 }).map((_, skelIdx) => (
                              <TableRow key={skelIdx}>
                                {Array.from({ length: 8 }).map((__, cellIdx) => (
                                  <TableCell key={cellIdx}>
                                    <div className="h-4 w-full max-w-[100px] rounded bg-[rgb(245,245,245)] animate-pulse" />
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : allCategoryItems.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <AlertCircle className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                        <p>
                          {category.name === "Employee Related Cost"
                            ? "No other employee costs recorded."
                            : "No expenses yet. Add your first expense above."}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Paid</TableHead>
                                <TableHead>Remaining</TableHead>
                                <TableHead>Frequency</TableHead>
                                <TableHead>Due Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">
                                  Actions
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {categoryItems.map((item) => {
                                const remaining =
                                  (item.amount || 0) - (item.amountPaid || 0);
                                return (
                                  <TableRow key={item._id}>
                                    <TableCell className="font-medium">
                                      <div>
                                        {item.name}
                                        {item.description && (
                                          <p className="text-xs text-gray-500 mt-1">
                                            {item.description}
                                          </p>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <span className="font-medium">
                                        ₱
                                        {item.amount?.toLocaleString("en-US", {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        }) || "0.00"}
                                      </span>
                                    </TableCell>
                                    <TableCell>
                                      <span className="text-green-600">
                                        ₱
                                        {(item.amountPaid || 0).toLocaleString(
                                          "en-US",
                                          {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          },
                                        )}
                                      </span>
                                    </TableCell>
                                    <TableCell>
                                      <span className="text-orange-600">
                                        ₱
                                        {remaining.toLocaleString("en-US", {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        })}
                                      </span>
                                    </TableCell>
                                    <TableCell>
                                      {item.frequency ? (
                                        <Badge variant="outline">
                                          {item.frequency
                                            .charAt(0)
                                            .toUpperCase() +
                                            item.frequency.slice(1)}
                                        </Badge>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {isPayrollGeneratedCostItem(item) ||
                                      !item.dueDate ? (
                                        <span className="text-sm text-gray-500">
                                          --
                                        </span>
                                      ) : (
                                        <div className="flex items-center gap-1">
                                          <Calendar className="h-3 w-3 text-gray-400" />
                                          <span className="text-sm">
                                            {formatDate(item.dueDate)}
                                          </span>
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        className={getStatusBadgeClass(
                                          item.status || "pending",
                                        )}
                                        style={getStatusBadgeStyle(
                                          item.status || "pending",
                                        )}
                                      >
                                        {item.status?.charAt(0).toUpperCase() +
                                          item.status?.slice(1) || "Pending"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex justify-end gap-2">
                                        {isPayrollGeneratedCostItem(item) && item.breakdown && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => void openDetailsDialog(item)}
                                          >
                                            <Eye className="h-4 w-4" />
                                          </Button>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() =>
                                            handleOpenItemDialog(
                                              category.name,
                                              item,
                                            )
                                          }
                                        >
                                          <Edit className="h-4 w-4" />
                                        </Button>
                                        {!isPayrollGeneratedCostItem(item) && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              setDeleteItemId(item._id);
                                              setDeleteDialogOpen(true);
                                            }}
                                          >
                                            <Trash2 className="h-4 w-4 text-red-600" />
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                        {allCategoryItems.length > pageSize && (
                          <div className="flex items-center justify-between border-t pt-4 mt-4">
                            <p className="text-sm text-gray-600">
                              Showing {start + 1}–{end} of{" "}
                              {allCategoryItems.length}
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setPageForCategory(
                                    category.name,
                                    Math.max(1, currentPage - 1),
                                  )
                                }
                                disabled={currentPage <= 1}
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </Button>
                              <span className="text-sm text-gray-600">
                                Page {currentPage} of {totalPages}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setPageForCategory(
                                    category.name,
                                    Math.min(totalPages, currentPage + 1),
                                  )
                                }
                                disabled={currentPage >= totalPages}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Dialog for adding/editing expenses */}
          <Dialog
            open={isItemDialogOpen}
            onOpenChange={(open) => {
              if (!open) handleCloseItemDialog();
            }}
          >
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingItem ? "Edit Expense" : "Add Expense"}
                </DialogTitle>
                <DialogDescription>
                  {editingItem
                    ? "Update the expense details"
                    : "Add a new expense to this category"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmitItem}>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Expense Name <span className="text-red-500">*</span></Label>
                    <Input
                      id="name"
                      value={itemFormData.name}
                      onChange={(e) =>
                        setItemFormData({
                          ...itemFormData,
                          name: e.target.value,
                        })
                      }
                      required
                      placeholder="e.g., Office Rent, Payroll, Utilities"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={itemFormData.description}
                      onChange={(e) =>
                        setItemFormData({
                          ...itemFormData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Optional description"
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="frequency">Frequency <span className="text-red-500">*</span></Label>
                    <Select
                      value={itemFormData.frequency}
                      onValueChange={(value) =>
                        setItemFormData({
                          ...itemFormData,
                          frequency:
                            value as AccountingCostItem["frequency"],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one-time">One-time</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Total Amount (₱) <span className="text-red-500">*</span></Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        min="0"
                        value={itemFormData.amount}
                        onChange={(e) =>
                          setItemFormData({
                            ...itemFormData,
                            amount: e.target.value,
                          })
                        }
                        disabled={Boolean(isEditingLockedCostItem)}
                        required
                        placeholder="0.00"
                      />
                      {isEditingLockedCostItem && (
                        <p className="text-xs text-gray-500">
                          Amount is locked for payroll-generated cost records.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="amountPaid">Amount Paid (₱)</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setItemFormData({
                              ...itemFormData,
                              amountPaid: itemFormData.amount || "0",
                            })
                          }
                        >
                          Full
                        </Button>
                      </div>
                      <Input
                        id="amountPaid"
                        type="number"
                        step="0.01"
                        min="0"
                        value={itemFormData.amountPaid}
                        onChange={(e) =>
                          setItemFormData({
                            ...itemFormData,
                            amountPaid: e.target.value,
                          })
                        }
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dueDate">Due Date</Label>
                    <Input
                      id="dueDate"
                      type="date"
                      value={itemFormData.dueDate}
                      onChange={(e) =>
                        setItemFormData({
                          ...itemFormData,
                          dueDate: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      value={itemFormData.notes}
                      onChange={(e) =>
                        setItemFormData({
                          ...itemFormData,
                          notes: e.target.value,
                        })
                      }
                      placeholder="Additional notes about this expense"
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Receipts & Attachments</Label>
                    <div className="space-y-2">
                      <Input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                        onChange={handleFileChange}
                        className="cursor-pointer"
                      />
                      <p className="text-xs text-gray-500">
                        Upload images, documents, or spreadsheet files. Max 10 MB
                        per attachment.
                      </p>

                      {/* Display uploaded files */}
                      {receiptFilePreviews.length > 0 && (
                        <div className="space-y-1">
                          {receiptFilePreviews.map(({ file, previewUrl }, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between gap-3 p-2 bg-gray-50 rounded text-sm"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {previewUrl ? (
                                  <img
                                    src={previewUrl}
                                    alt={file.name}
                                    className="h-12 w-12 rounded object-cover border"
                                  />
                                ) : (
                                  <FileText className="h-4 w-4 text-gray-400" />
                                )}
                                <div className="min-w-0">
                                  <div className="truncate max-w-xs">
                                    {file.name}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                                  </div>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeReceiptFile(index)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Display existing receipt URLs */}
                      {receiptUrls.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-gray-500 font-medium">
                            Existing attachments:
                          </p>
                          {receiptUrls.map((receipt, index) => (
                            <div
                              key={receipt.id}
                              className="flex items-center justify-between gap-3 p-2 bg-gray-50 rounded text-sm"
                            >
                              <a
                                href={receipt.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-blue-600 hover:underline min-w-0"
                              >
                                {isImageAttachment(receipt.url) ? (
                                  <img
                                    src={receipt.url}
                                    alt={`Attachment ${index + 1}`}
                                    className="h-12 w-12 rounded object-cover border"
                                  />
                                ) : (
                                  <Download className="h-4 w-4" />
                                )}
                                <span className="truncate">
                                  Attachment {index + 1}
                                </span>
                              </a>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeReceiptUrl(index)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCloseItemDialog}
                    disabled={uploadingReceipts}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={uploadingReceipts}>
                    {uploadingReceipts ? (
                      <>
                        <Upload className="mr-2 h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : editingItem ? (
                      "Update"
                    ) : (
                      "Create"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </MainLayout>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete expense?</DialogTitle>
            <DialogDescription>
              This action cannot be undone and will remove this expense record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteItemId(null);
                toast({
                  title: "Deletion cancelled",
                  description: "The expense was not deleted.",
                });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteItemId && handleDeleteItem(deleteItemId)}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={breakdownDialogOpen}
        onOpenChange={(open) => {
          setBreakdownDialogOpen(open);
          if (!open) {
            setSelectedBreakdownItem(null);
            setDetailAttachmentUrls([]);
            setDetailImageLoadErrors({});
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Details</DialogTitle>
            <DialogDescription>
              {selectedBreakdownItem?.name || "Expense breakdown"}
            </DialogDescription>
          </DialogHeader>

          {selectedBreakdownItem?.breakdown?.kind === "payroll" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Gross Pay</TableHead>
                  <TableHead className="text-right">Allowance</TableHead>
                  <TableHead className="text-right">Incentives</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  selectedBreakdownItem.breakdown
                    .rows as PayrollBreakdownRow[]
                ).map((row) => (
                  <TableRow key={row.employeeId}>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{row.employeeName}</div>
                        {row.incentiveItems?.length ? (
                          <div className="text-xs text-gray-500">
                            Incentives:{" "}
                            {row.incentiveItems
                              .map(
                                (item) =>
                                  `${item.name} (₱${(item.amount ?? 0).toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })})`,
                              )
                              .join(", ")}
                          </div>
                        ) : null}
                        {row.deductionItems?.length ? (
                          <div className="text-xs text-gray-500">
                            Deductions:{" "}
                            {row.deductionItems
                              .map(
                                (item) =>
                                  `${item.name} (₱${(item.amount ?? 0).toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })})`,
                              )
                              .join(", ")}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      ₱
                      {(row.grossPay ?? 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      ₱
                      {(row.nonTaxableAllowance ?? 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      ₱
                      {(row.totalIncentives ?? 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      ₱
                      {(row.totalDeductions ?? 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ₱
                      {(row.netPay ?? 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {selectedBreakdownItem?.breakdown?.kind === "contributions" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">
                    {isTaxBreakdownItem ? "Amount" : "Employee"}
                  </TableHead>
                  {!isTaxBreakdownItem && (
                    <TableHead className="text-right">Company</TableHead>
                  )}
                  {!isTaxBreakdownItem && (
                    <TableHead className="text-right">Total</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  selectedBreakdownItem.breakdown
                    .rows as ContributionBreakdownRow[]
                ).map((row) => (
                  <TableRow key={row.employeeId}>
                    <TableCell>{row.employeeName}</TableCell>
                    <TableCell className="text-right">
                      ₱
                      {(row.employeeAmount ?? 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    {!isTaxBreakdownItem && (
                      <TableCell className="text-right">
                        ₱
                        {(row.companyAmount ?? 0).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                    )}
                    {!isTaxBreakdownItem && (
                      <TableCell className="text-right font-medium">
                        ₱
                        {(
                          (row.employeeAmount ?? 0) + (row.companyAmount ?? 0)
                        ).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {detailAttachmentUrls.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Attachments</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {detailAttachmentUrls.map((attachment, index) => (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border p-3 hover:bg-gray-50"
                  >
                    {!detailImageLoadErrors[attachment.id] ? (
                      <img
                        src={attachment.url}
                        alt={`Attachment ${index + 1}`}
                        className="mb-2 h-40 w-full rounded object-cover"
                        onError={() =>
                          setDetailImageLoadErrors((prev) => ({
                            ...prev,
                            [attachment.id]: true,
                          }))
                        }
                      />
                    ) : (
                      <div className="mb-2 flex items-center gap-2 text-sm text-gray-600">
                        <FileText className="h-4 w-4" />
                        Attachment {index + 1}
                      </div>
                    )}
                    <div className="text-sm text-blue-600">Open attachment</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBreakdownDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
