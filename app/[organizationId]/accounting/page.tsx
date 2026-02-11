"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
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
  Users,
  Building2,
  AlertCircle,
  Calendar,
  FileText,
  X,
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import {
  createCostItem,
  updateCostItem,
  deleteCostItem,
} from "@/actions/accounting";
import { generateUploadUrl, getFileUrl } from "@/actions/files";
import { useToast } from "@/components/ui/use-toast";
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";
import { MainLoader } from "@/components/main-loader";

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [categoryPage, setCategoryPage] = useState<Record<string, number>>({});

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
  const costItems = costItemsFromQuery ?? [];
  const loading = costItemsFromQuery === undefined;

  // Redirect if no access
  useEffect(() => {
    if (user !== undefined && !hasAccess) {
      router.replace(
        getOrganizationPath(currentOrganizationId ?? "", "/forbidden"),
      );
    }
  }, [user, hasAccess, router, currentOrganizationId]);

  const itemsByCategoryName = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const item of costItems) {
      const name = item.categoryName ?? "Employee Related Cost";
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(item);
    }
    return map;
  }, [costItems]);

  const getItemsForCategory = useCallback(
    (categoryName: string) => itemsByCategoryName.get(categoryName) ?? [],
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
    (categoryName?: string, item?: any) => {
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
        if (item.receipts && item.receipts.length > 0) {
          Promise.all(
            item.receipts.map(async (id: string) => {
              const url = await getFileUrl(id);
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
    [],
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
      setReceiptFiles((prev) => [...prev, ...files]);
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
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!result.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        const responseText = await result.text();
        let storageId: string;
        try {
          const jsonResponse = JSON.parse(responseText);
          storageId = jsonResponse.storageId || jsonResponse;
        } catch {
          storageId = responseText;
        }
        storageId = storageId.trim().replace(/^["']|["']$/g, "");
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
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save expense",
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
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete expense",
        variant: "destructive",
      });
    }
    setDeleting(false);
    setDeleteDialogOpen(false);
    setDeleteItemId(null);
  };

  // Using centralized color system from utils/colors

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return "-";
    return new Date(timestamp).toLocaleDateString();
  };

  // Show loading or forbidden
  if (user === undefined || loading) {
    return <MainLoader />;
  }

  if (
    !user ||
    (user.role !== "accounting" &&
      user.role !== "admin" &&
      user.role !== "owner")
  ) {
    return null; // Will redirect to forbidden
  }

  return (
    <>
      <MainLayout>
        <div className="p-8">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h1 className="text-3xl font-bold text-gray-900">
              Expense Management
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setCategoryPage({});
                }}
              >
                <SelectTrigger className="w-[72px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 mb-6">
            {categories.map((category) => {
              const { total, paid, remaining } = categoryTotals[
                category.name
              ] ?? {
                total: 0,
                paid: 0,
                remaining: 0,
              };
              return (
                <Card key={category.name}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                      {category.name}
                    </CardTitle>
                    {category.name === "Employee Related Cost" ? (
                      <Users className="h-4 w-4 text-gray-600" />
                    ) : (
                      <Building2 className="h-4 w-4 text-gray-600" />
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div>
                        <div className="text-2xl font-bold">
                          ₱
                          {total.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <p className="text-xs text-gray-500">Total Amount</p>
                      </div>
                      <div className="flex justify-between text-sm">
                        <div>
                          <span className="text-green-600 font-medium">
                            ₱
                            {paid.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          <p className="text-xs text-gray-500">Paid</p>
                        </div>
                        <div>
                          <span className="text-orange-600 font-medium">
                            ₱
                            {remaining.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          <p className="text-xs text-gray-500">Remaining</p>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {getItemsForCategory(category.name).length} expenses
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Expense Categories */}
          <div className="space-y-6">
            {categories.map((category) => {
              const allCategoryItems = getItemsForCategory(category.name);
              const categoryItems = getPaginatedItems(category.name);
              const currentPage = categoryPage[category.name] ?? 1;
              const totalPages = totalPagesForCategory(category.name);
              const start = (currentPage - 1) * pageSize;
              const end = Math.min(start + pageSize, allCategoryItems.length);
              return (
                <Card key={category.name}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-xl">
                          {category.name}
                        </CardTitle>
                        {category.description && (
                          <p className="text-sm text-gray-600 mt-1">
                            {category.description}
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
                    {allCategoryItems.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <AlertCircle className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                        <p>No expenses yet. Add your first expense above.</p>
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
                                      <div className="flex items-center gap-1">
                                        <Calendar className="h-3 w-3 text-gray-400" />
                                        <span className="text-sm">
                                          {formatDate(item.dueDate)}
                                        </span>
                                      </div>
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
                    <Label htmlFor="name">Expense Name *</Label>
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
                    <Label htmlFor="frequency">Frequency *</Label>
                    <Select
                      value={itemFormData.frequency}
                      onValueChange={(value: any) =>
                        setItemFormData({
                          ...itemFormData,
                          frequency: value,
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
                      <Label htmlFor="amount">Total Amount (₱) *</Label>
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
                        required
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="amountPaid">Amount Paid (₱)</Label>
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
                        accept="image/*,.pdf"
                        onChange={handleFileChange}
                        className="cursor-pointer"
                      />
                      <p className="text-xs text-gray-500">
                        Upload receipts, invoices, or other supporting documents
                      </p>

                      {/* Display uploaded files */}
                      {receiptFiles.length > 0 && (
                        <div className="space-y-1">
                          {receiptFiles.map((file, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                            >
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-gray-400" />
                                <span className="truncate max-w-xs">
                                  {file.name}
                                </span>
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
                              className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                            >
                              <a
                                href={receipt.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-blue-600 hover:underline"
                              >
                                <Download className="h-4 w-4" />
                                <span>Receipt {index + 1}</span>
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
    </>
  );
}
