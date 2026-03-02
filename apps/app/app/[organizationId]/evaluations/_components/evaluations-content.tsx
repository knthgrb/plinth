"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Columns,
  Calendar,
  X,
  MessageSquare,
  Pencil,
  Search,
  Plus,
  ChevronDown,
} from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { createEvaluation, updateEvaluation } from "@/actions/evaluations";
import { updateEvaluationColumns } from "@/actions/settings";
import { cn } from "@/utils/utils";
import { EvaluationColumnManagementModal } from "./evaluation-column-management-modal";
import { MainLoader } from "@/components/main-loader";

type EvaluationColumn = {
  id: string;
  label: string;
  type: "date" | "number" | "text" | "rating";
  hidden?: boolean;
  hasRatingColumn?: boolean;
  hasNotesColumn?: boolean;
};

export function EvaluationsContent() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();

  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const evaluations = useQuery(
    (api as any).evaluations.getEvaluations,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
        }
      : "skip",
  );

  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  // Load columns from settings
  const [evaluationColumns, setEvaluationColumns] = useState<
    EvaluationColumn[]
  >([]);

  useEffect(() => {
    if (settings?.evaluationColumns) {
      // Filter out any rating column entries (those with -rating suffix)
      // Rating columns are now rendered dynamically based on hasRatingColumn flag
      const filteredColumns = settings.evaluationColumns.filter(
        (col: EvaluationColumn) => !col.id.endsWith("-rating"),
      );
      setEvaluationColumns(filteredColumns);
    }
  }, [settings]);

  const [isManageColumnsModalOpen, setIsManageColumnsModalOpen] =
    useState(false);

  const [upcomingBannerDismissed, setUpcomingBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      sessionStorage.getItem("evaluations-upcoming-banner-dismissed") === "1"
    );
  });

  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [departmentPopoverOpen, setDepartmentPopoverOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    employeeId: string;
    columnId: string;
    columnLabel: string;
    columnType: string;
    existingEvaluation?: any;
    isRatingColumn?: boolean; // True if clicking on a rating column
    isNotesColumn?: boolean; // True if clicking on a notes column
  } | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [evaluationDate, setEvaluationDate] = useState<string>("");
  const [label, setLabel] = useState("Initial evaluation");
  const [rating, setRating] = useState<string>("");
  const [textValue, setTextValue] = useState<string>("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [initializedFromUrl, setInitializedFromUrl] = useState(false);

  type UpcomingItem = {
    employeeId: string;
    employeeName: string;
    date: number;
    label: string;
  };
  const upcomingEvaluations = useMemo((): UpcomingItem[] => {
    const now = new Date();
    const monthStart = startOfMonth(now).getTime();
    const monthEnd = endOfMonth(now).getTime();
    const today = now.getTime();
    return (evaluations || [])
      .filter(
        (e: any) =>
          e.evaluationDate > today &&
          e.evaluationDate >= monthStart &&
          e.evaluationDate <= monthEnd,
      )
      .map((e: any) => {
        const emp = employees?.find((em: any) => em._id === e.employeeId);
        return {
          employeeId: e.employeeId,
          employeeName: emp
            ? `${emp.personalInfo.firstName} ${emp.personalInfo.lastName}`
            : "Unknown",
          date: e.evaluationDate,
          label: e.label,
        };
      })
      .sort((a: UpcomingItem, b: UpcomingItem) => a.date - b.date);
  }, [evaluations, employees]);

  const evaluationDepartments = useMemo(() => {
    const depts = settings?.departments || [];
    return depts.length > 0 && typeof depts[0] === "string"
      ? (depts as string[]).map((name) => ({ name, color: "#3B82F6" }))
      : (depts as { name: string; color: string }[]);
  }, [settings]);

  const displayedEmployees = useMemo(() => {
    const list = employees || [];
    const q = employeeSearch.trim().toLowerCase();
    const bySearch = q
      ? list.filter(
          (emp: any) =>
            `${emp.personalInfo?.firstName ?? ""} ${emp.personalInfo?.lastName ?? ""}`
              .toLowerCase()
              .includes(q) ||
            emp.personalInfo?.email?.toLowerCase().includes(q),
        )
      : list;
    if (departmentFilter === "all") return bySearch;
    return bySearch.filter(
      (emp: any) => emp.employment?.department === departmentFilter,
    );
  }, [employees, employeeSearch, departmentFilter]);

  const isOwnerOrAdminOrHr =
    user?.role === "owner" ||
    user?.role === "admin" ||
    user?.role === "hr" ||
    user?.role === "accounting";
  useEffect(() => {
    if (initializedFromUrl) return;
    if (typeof window === "undefined") return;
    if (!employees || !evaluations || evaluationColumns.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const employeeId = params.get("employeeId");
    const labelParam = params.get("label");
    const evalDateParam = params.get("evaluationDate");

    if (!employeeId || !labelParam) return;

    const column = evaluationColumns.find((c) => c.label === labelParam);
    if (!column) return;

    const existing = evaluations.find(
      (e: any) =>
        e.employeeId === employeeId &&
        e.label === labelParam &&
        (!evalDateParam || String(e.evaluationDate) === evalDateParam),
    );

    handleCellClick(employeeId, column, existing);
    setInitializedFromUrl(true);
  }, [employees, evaluations, evaluationColumns, initializedFromUrl]);

  // When a modal that was opened from URL params is closed, clean the URL
  // so that refreshing the page does not auto-open the modal again.
  useEffect(() => {
    if (!initializedFromUrl) return;
    if (isViewModalOpen || isEditDialogOpen) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    params.delete("employeeId");
    params.delete("label");
    params.delete("evaluationDate");

    const basePath = window.location.pathname;
    const newSearch = params.toString();
    const newUrl = newSearch ? `${basePath}?${newSearch}` : basePath;

    window.history.replaceState(null, "", newUrl);
    setInitializedFromUrl(false);
  }, [isViewModalOpen, isEditDialogOpen, initializedFromUrl]);

  if (!currentOrganizationId) {
    return (
      <MainLayout>
        <div className="p-8">No organization selected.</div>
      </MainLayout>
    );
  }

  if (user === undefined || settings === undefined) {
    return <MainLoader />;
  }

  if (!isOwnerOrAdminOrHr) {
    return (
      <MainLayout>
        <div className="p-8">You are not authorized to view this page.</div>
      </MainLayout>
    );
  }

  const handleSaveColumns = async (columns: EvaluationColumn[]) => {
    if (!currentOrganizationId) return;
    try {
      // Filter out any rating column entries before saving
      // Rating columns are rendered dynamically, not stored as separate entries
      const columnsToSave = columns.filter(
        (col) => !col.id.endsWith("-rating"),
      );
      await updateEvaluationColumns({
        organizationId: currentOrganizationId,
        columns: columnsToSave,
      });
      setEvaluationColumns(columnsToSave);
      toast({
        title: "Columns saved",
        description: "Evaluation columns have been updated.",
      });
    } catch (error: any) {
      console.error("Error saving columns", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save columns",
        variant: "destructive",
      });
    }
  };

  const handleCellClick = (
    employeeId: string,
    column: EvaluationColumn,
    existingEvaluation?: any,
  ) => {
    setEditingCell({
      employeeId,
      columnId: column.id,
      columnLabel: column.label,
      columnType: column.type,
      existingEvaluation,
      isRatingColumn: false,
      isNotesColumn: false,
    });
    setSelectedEmployeeId(employeeId);
    if (existingEvaluation) {
      setEvaluationDate(
        format(new Date(existingEvaluation.evaluationDate), "yyyy-MM-dd"),
      );
      setLabel(existingEvaluation.label);
      setRating(
        existingEvaluation.rating != null
          ? String(existingEvaluation.rating)
          : "",
      );
      setTextValue(existingEvaluation.notes || "");
      setAttachmentUrl(existingEvaluation.attachmentUrl || "");
      setNotes(existingEvaluation.notes || "");
    } else {
      setEvaluationDate("");
      setLabel(column.label);
      setRating("");
      setTextValue("");
      setAttachmentUrl("");
      setNotes("");
    }
    setIsViewModalOpen(true);
  };

  const handleOpenEditFromView = () => {
    setIsViewModalOpen(false);
    setIsEditDialogOpen(true);
  };

  const handleSaveEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeId || !editingCell) return;

    // Date is required for date columns, optional for others
    const needsDate = editingCell.columnType === "date";
    if (needsDate && !evaluationDate) return;

    // For rating/number columns, rating is required
    const needsRating =
      editingCell.columnType === "rating" ||
      editingCell.columnType === "number";
    if (needsRating && !rating) return;

    // For text columns, text is required
    const needsText = editingCell.columnType === "text";
    if (needsText && !textValue) return;

    try {
      setIsSaving(true);
      // Determine if we should save rating
      const shouldSaveRating =
        editingCell.columnType === "rating" ||
        editingCell.columnType === "number" ||
        editingCell.isRatingColumn ||
        (editingCell.columnType === "date" &&
          evaluationColumns.find((c) => c.id === editingCell.columnId)
            ?.hasRatingColumn);

      // Determine if we should save notes/attachments
      const shouldSaveNotes =
        editingCell.columnType === "text" ||
        editingCell.isNotesColumn ||
        (editingCell.columnType === "date" &&
          evaluationColumns.find((c) => c.id === editingCell.columnId)
            ?.hasNotesColumn);

      // Use evaluationDate if provided, otherwise use current date or existing date
      const evalDate = evaluationDate
        ? new Date(evaluationDate).getTime()
        : editingCell.existingEvaluation?.evaluationDate || Date.now();

      if (editingCell.existingEvaluation) {
        // Update existing
        await updateEvaluation({
          evaluationId: editingCell.existingEvaluation._id,
          evaluationDate: evalDate,
          label: editingCell.columnLabel,
          rating: shouldSaveRating && rating ? Number(rating) : undefined,
          attachmentUrl:
            shouldSaveNotes && attachmentUrl ? attachmentUrl : undefined,
          notes: shouldSaveNotes && notes ? notes : undefined,
        });
        toast({
          title: "Evaluation updated",
          description: "Employee evaluation has been updated.",
        });
      } else {
        // Create new
        await createEvaluation({
          organizationId: currentOrganizationId,
          employeeId: selectedEmployeeId,
          evaluationDate: evalDate,
          label: editingCell.columnLabel,
          rating: shouldSaveRating && rating ? Number(rating) : undefined,
          attachmentUrl:
            shouldSaveNotes && attachmentUrl ? attachmentUrl : undefined,
          notes: shouldSaveNotes && notes ? notes : undefined,
        });
        toast({
          title: "Evaluation added",
          description: "Employee evaluation has been recorded.",
        });
      }
      setIsEditDialogOpen(false);
      setEditingCell(null);
      setSelectedEmployeeId("");
      setEvaluationDate("");
      setLabel("");
      setRating("");
      setTextValue("");
      setAttachmentUrl("");
      setNotes("");
    } catch (error: any) {
      console.error("Error saving evaluation", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save evaluation",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Filter visible columns
  const visibleColumns = evaluationColumns.filter((col) => !col.hidden);

  // Default columns that are always shown (unless hidden)
  const defaultColumns = [
    { id: "employee", label: "Employee", type: "text" as const },
    { id: "position", label: "Position", type: "text" as const },
    { id: "hiredDate", label: "Hired Date", type: "date" as const },
  ].filter((dc) => {
    const col = evaluationColumns.find((c) => c.id === dc.id);
    return !col?.hidden;
  });

  const getCellValue = (
    employeeId: string,
    column: EvaluationColumn,
    isRatingColumn: boolean = false,
  ) => {
    const ev = evaluations?.find(
      (e: any) => e.employeeId === employeeId && e.label === column.label,
    );
    if (!ev) return null;

    // If this is a rating column, always return the rating value (number)
    if (isRatingColumn) {
      return ev.rating != null ? ev.rating : null;
    }

    // Otherwise, return the appropriate value based on column type
    if (column.type === "date") {
      return ev.evaluationDate
        ? format(new Date(ev.evaluationDate), "MMM dd, yyyy")
        : null;
    }

    if (column.type === "number") {
      return ev.rating != null ? ev.rating : null;
    }

    if (column.type === "text") {
      return ev.notes || null;
    }

    if (column.type === "rating") {
      return ev.rating != null ? ev.rating : null;
    }

    return null;
  };

  /** Combined display for one evaluation type (one cell = date + rating + note indicator) */
  const getCellDisplay = (
    employeeId: string,
    column: EvaluationColumn,
  ): { primary: string; rating?: number | null; hasNotes: boolean } | null => {
    const ev = evaluations?.find(
      (e: any) => e.employeeId === employeeId && e.label === column.label,
    );
    if (!ev) return null;
    const hasNotes = !!(ev.notes?.trim() || ev.attachmentUrl);
    const rating = ev.rating != null ? Number(ev.rating) : null;
    if (column.type === "date") {
      const dateStr = ev.evaluationDate
        ? format(new Date(ev.evaluationDate), "MMM d, yyyy")
        : "";
      return { primary: dateStr, rating, hasNotes };
    }
    if (column.type === "number") {
      return {
        primary: rating != null ? String(rating) : "",
        rating,
        hasNotes,
      };
    }
    if (column.type === "text") {
      return { primary: ev.notes || "", hasNotes };
    }
    return { primary: rating != null ? String(rating) : "", rating, hasNotes };
  };

  const handleDismissUpcomingBanner = () => {
    setUpcomingBannerDismissed(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("evaluations-upcoming-banner-dismissed", "1");
    }
  };

  return (
    <MainLayout>
      <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 sm:space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          Evaluations
        </h1>

        {evaluations === undefined ? (
          <div
            className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-xl border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] px-4 py-3 shadow-sm animate-pulse"
            role="status"
            aria-label="Loading upcoming evaluations"
          >
            <div className="flex items-center gap-2 shrink-0">
              <div className="h-4 w-4 rounded bg-[rgb(220,220,220)] shrink-0" />
              <span className="h-4 w-4 rounded bg-[rgb(220,220,220)] shrink-0 sm:w-32 w-24" />
            </div>
            <div className="h-4 flex-1 min-w-0 max-w-md rounded bg-[rgb(220,220,220)]" />
            <div className="flex items-center gap-2 shrink-0">
              <div className="h-4 w-8 rounded bg-[rgb(220,220,220)]" />
              <div className="h-4 w-px bg-[rgb(220,220,220)]" aria-hidden />
              <div className="h-6 w-6 rounded bg-[rgb(220,220,220)]" />
            </div>
          </div>
        ) : upcomingEvaluations.length > 0 && !upcomingBannerDismissed ? (
          <div
            className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-xl border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] px-4 py-3 shadow-sm"
            role="region"
            aria-label="Upcoming evaluation"
          >
            <div className="flex items-center gap-2 shrink-0">
              <Calendar className="h-4 w-4 text-[rgb(120,120,120)] shrink-0" />
              <span className="font-semibold text-sm text-[rgb(64,64,64)]">
                Upcoming evaluation
              </span>
            </div>
            <p className="text-sm text-[rgb(64,64,64)] min-w-0 flex-1">
              {upcomingEvaluations.length === 1
                ? `${upcomingEvaluations[0].employeeName} – ${format(new Date(upcomingEvaluations[0].date), "MMM d, yyyy")} (${upcomingEvaluations[0].label})`
                : upcomingEvaluations.length <= 3
                  ? upcomingEvaluations
                      .map(
                        (u: UpcomingItem) =>
                          `${u.employeeName} (${format(new Date(u.date), "MMM d")})`,
                      )
                      .join(", ")
                  : `${upcomingEvaluations.length} evaluations due this month: ${upcomingEvaluations
                      .slice(0, 2)
                      .map(
                        (u: UpcomingItem) =>
                          `${u.employeeName} (${format(new Date(u.date), "MMM d")})`,
                      )
                      .join(", ")} and ${upcomingEvaluations.length - 2} more`}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="text-sm font-medium text-[#695eff] hover:text-[#5547e8]"
                onClick={() => {
                  const first = upcomingEvaluations[0];
                  if (!first) return;
                  const column = evaluationColumns.find(
                    (c) => c.label === first.label,
                  );
                  if (!column) return;
                  const existing = (evaluations || []).find(
                    (e: any) =>
                      e.employeeId === first.employeeId &&
                      e.label === first.label &&
                      e.evaluationDate === first.date,
                  );
                  handleCellClick(first.employeeId, column, existing);
                }}
              >
                View
              </button>
              <button
                type="button"
                onClick={handleDismissUpcomingBanner}
                className="p-1 rounded hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] hover:text-[rgb(64,64,64)]"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        <Card className="flex flex-col max-h-[calc(100vh-180px)] sm:max-h-[calc(100vh-200px)]">
          <div className="shrink-0 flex flex-col gap-3 p-4 sm:p-5 md:p-6 pb-1.5 border-b border-[#DDDDDD]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-full max-w-[200px]">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[rgb(133,133,133)] pointer-events-none" />
                <Input
                  placeholder="Search employees..."
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="h-8 pl-7 pr-2 rounded-lg text-[11px] font-semibold text-[rgb(64,64,64)] bg-white border border-solid border-[#DDDDDD] shadow-sm focus-visible:ring-[#695eff] focus-visible:ring-offset-0 placeholder:text-[rgb(133,133,133)]"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsManageColumnsModalOpen(true)}
                className="h-8 text-xs px-3 rounded-lg border-[#DDDDDD] hover:border-[rgb(120,120,120)] bg-white text-[rgb(64,64,64)] font-semibold [&_svg]:text-current shrink-0"
                style={{ color: "rgb(64,64,64)" }}
              >
                <Columns className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Manage Columns
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <Popover
                open={departmentPopoverOpen}
                onOpenChange={setDepartmentPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white transition-colors hover:bg-[rgb(250,250,250)]",
                      departmentFilter !== "all"
                        ? "border border-[#DDDDDD] border-solid"
                        : "border border-dashed border-[#DDDDDD]",
                    )}
                  >
                    {departmentFilter !== "all" ? (
                      <>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDepartmentFilter("all");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setDepartmentFilter("all");
                            }
                          }}
                          className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
                          aria-label="Clear department"
                        >
                          <X className="h-2 w-2" />
                        </span>
                        <span className="text-[rgb(133,133,133)] font-semibold">
                          Department
                        </span>
                        <span className="font-semibold">
                          {evaluationDepartments.find(
                            (d) => d.name === departmentFilter,
                          )?.name ?? "All"}
                        </span>
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              evaluationDepartments.find(
                                (d) => d.name === departmentFilter,
                              )?.color ?? "#9CA3AF",
                          }}
                        />
                        <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
                      </>
                    ) : (
                      <>
                        <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[rgb(180,180,180)] text-[rgb(120,120,120)]">
                          <Plus className="h-2 w-2" />
                        </span>
                        <span className="font-semibold">Department</span>
                        <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)] mb-2">
                    Filter by: Department
                  </h4>
                  <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setDepartmentFilter("all");
                        setDepartmentPopoverOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                        departmentFilter === "all"
                          ? "bg-[rgb(245,245,245)]"
                          : "hover:bg-[rgb(250,250,250)]",
                      )}
                    >
                      <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-[#9CA3AF]" />
                      <span>All</span>
                    </button>
                    {evaluationDepartments.map((dept) => (
                      <button
                        key={dept.name}
                        type="button"
                        onClick={() => {
                          setDepartmentFilter(dept.name);
                          setDepartmentPopoverOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                          departmentFilter === dept.name
                            ? "bg-[rgb(245,245,245)]"
                            : "hover:bg-[rgb(250,250,250)]",
                        )}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: dept.color }}
                        />
                        <span>{dept.name}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {(employeeSearch?.trim() ?? "") !== "" ||
              (departmentFilter !== "all" && departmentFilter !== "") ? (
                <button
                  type="button"
                  onClick={() => {
                    setEmployeeSearch("");
                    setDepartmentFilter("all");
                  }}
                  className="text-[11px] font-semibold text-[#695eff] hover:text-[#5547e8] shrink-0"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>
          <CardContent className="flex-1 overflow-auto p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-[rgb(230,230,230)] h-8">
                    {defaultColumns.map((col) => (
                      <th
                        key={col.id}
                        className="py-1.5 px-3 text-left font-medium text-[11px] text-[rgb(64,64,64)]"
                      >
                        {col.label}
                      </th>
                    ))}
                    {visibleColumns
                      .filter(
                        (col) =>
                          ![
                            "employee",
                            "employeeId",
                            "position",
                            "hiredDate",
                          ].includes(col.id),
                      )
                      .map((col) => (
                        <th
                          key={col.id}
                          className="py-1.5 px-3 text-left font-medium text-[11px] text-[rgb(64,64,64)]"
                        >
                          {col.label}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedEmployees.length > 0 ? (
                    displayedEmployees.map((emp: any) => (
                      <tr
                        key={emp._id}
                        className="border-b border-[rgb(230,230,230)] transition-colors hover:bg-[rgb(250,250,250)] text-sm"
                      >
                        {/* Default columns */}
                        {defaultColumns.map((col) => {
                          if (col.id === "employee") {
                            return (
                              <td key={col.id} className="py-1.5 px-3">
                                {emp.personalInfo.firstName}{" "}
                                {emp.personalInfo.lastName}
                              </td>
                            );
                          }
                          if (col.id === "position") {
                            return (
                              <td key={col.id} className="py-1.5 px-3">
                                {emp.employment.position}
                              </td>
                            );
                          }
                          if (col.id === "hiredDate") {
                            return (
                              <td key={col.id} className="py-1.5 px-3">
                                {emp.employment.hireDate
                                  ? format(
                                      new Date(emp.employment.hireDate),
                                      "MMM dd, yyyy",
                                    )
                                  : "—"}
                              </td>
                            );
                          }
                          return null;
                        })}
                        {/* Custom evaluation columns – one cell per type (date + rating + note indicator) */}
                        {visibleColumns
                          .filter(
                            (col) =>
                              ![
                                "employee",
                                "employeeId",
                                "position",
                                "hiredDate",
                              ].includes(col.id),
                          )
                          .map((col) => {
                            const ev = evaluations?.find(
                              (e: any) =>
                                e.employeeId === emp._id &&
                                e.label === col.label,
                            );
                            const display = getCellDisplay(emp._id, col);
                            const isDueThisMonth = (() => {
                              if (!ev) return false;
                              const now = new Date();
                              const d = new Date(ev.evaluationDate);
                              const sameMonth =
                                d.getFullYear() === now.getFullYear() &&
                                d.getMonth() === now.getMonth();
                              const isPastOrToday =
                                ev.evaluationDate <= now.getTime();
                              const hasRating = ev.rating != null;
                              // Due = in current month, date is today/past, and no rating yet.
                              return sameMonth && isPastOrToday && !hasRating;
                            })();
                            const showRating =
                              col.type === "date" &&
                              col.hasRatingColumn &&
                              display?.rating != null;
                            const showNoteIcon = display?.hasNotes;
                            return (
                              <td
                                key={col.id}
                                onClick={() =>
                                  handleCellClick(emp._id, col, ev || undefined)
                                }
                                className={cn(
                                  "py-1.5 px-3 text-xs cursor-pointer transition-colors align-middle",
                                  isDueThisMonth &&
                                    "border border-rose-200 bg-rose-50/70",
                                )}
                                title="Click to view"
                              >
                                {display ? (
                                  <span className="inline-flex items-center gap-1 flex-wrap">
                                    <span>
                                      {display.primary || "—"}
                                      {showRating && ` • ${display.rating}/5`}
                                    </span>
                                    {showNoteIcon && (
                                      <MessageSquare
                                        className="h-3.5 w-3.5 shrink-0 text-[#695eff]/80"
                                        aria-hidden
                                      />
                                    )}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            );
                          })}
                      </tr>
                    ))
                  ) : (
                    <tr className="border-b border-[rgb(230,230,230)]">
                      <td
                        colSpan={
                          defaultColumns.length +
                          visibleColumns.filter(
                            (col) =>
                              ![
                                "employee",
                                "employeeId",
                                "position",
                                "hiredDate",
                              ].includes(col.id),
                          ).length
                        }
                        className="py-6 text-center text-gray-500 text-sm"
                      >
                        No employees found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* View evaluation details (read-only) – Edit opens the edit dialog */}
        <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pr-10">
              <DialogTitle className="min-w-0">
                {editingCell?.columnLabel ?? "Evaluation"}
              </DialogTitle>
              {editingCell &&
                selectedEmployeeId &&
                editingCell.existingEvaluation && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenEditFromView}
                    className="shrink-0 rounded-lg border-[#DDDDDD] bg-white text-[rgb(64,64,64)] hover:bg-[rgb(250,250,250)] hover:border-[rgb(150,150,150)] [&_svg]:text-current"
                    style={{ color: "rgb(64,64,64)" }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                )}
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {editingCell &&
                selectedEmployeeId &&
                (() => {
                  const emp = employees?.find(
                    (e: any) => e._id === selectedEmployeeId,
                  );
                  const empName = emp
                    ? `${emp.personalInfo.firstName} ${emp.personalInfo.lastName}`
                    : "—";
                  const ev = editingCell.existingEvaluation;
                  const col = evaluationColumns.find(
                    (c) => c.id === editingCell.columnId,
                  );
                  return (
                    <>
                      <div>
                        <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                          Employee
                        </p>
                        <p className="mt-1 text-sm font-medium text-[rgb(64,64,64)]">
                          {empName}
                        </p>
                      </div>
                      {ev ? (
                        <>
                          {editingCell.columnType === "date" &&
                            ev.evaluationDate && (
                              <div>
                                <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                                  Date
                                </p>
                                <p className="mt-1 text-sm text-[rgb(64,64,64)]">
                                  {format(
                                    new Date(ev.evaluationDate),
                                    "MMMM d, yyyy",
                                  )}
                                </p>
                              </div>
                            )}
                          {(editingCell.columnType === "number" ||
                            col?.hasRatingColumn) &&
                            ev.rating != null && (
                              <div>
                                <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                                  {editingCell.columnType === "date"
                                    ? "Rating"
                                    : "Value"}
                                </p>
                                <p className="mt-1 text-sm text-[rgb(64,64,64)]">
                                  {editingCell.columnType === "date"
                                    ? `${ev.rating}/5`
                                    : ev.rating}
                                </p>
                              </div>
                            )}
                          {editingCell.columnType === "text" &&
                            ev.notes?.trim() && (
                              <div>
                                <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                                  Text
                                </p>
                                <p className="mt-1 text-sm text-[rgb(64,64,64)] whitespace-pre-wrap">
                                  {ev.notes}
                                </p>
                              </div>
                            )}
                          {ev.notes?.trim() &&
                            editingCell.columnType !== "text" && (
                              <div>
                                <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                                  Notes
                                </p>
                                <p className="mt-1 text-sm text-[rgb(64,64,64)] whitespace-pre-wrap">
                                  {ev.notes}
                                </p>
                              </div>
                            )}
                          {ev.attachmentUrl && (
                            <div>
                              <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                                Attachment
                              </p>
                              <a
                                href={ev.attachmentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 text-sm text-[#695eff] hover:underline break-all"
                              >
                                {ev.attachmentUrl}
                              </a>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-3 pt-2">
                          <p className="text-sm text-[rgb(133,133,133)]">
                            No evaluation recorded yet.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleOpenEditFromView}
                            className="rounded-lg border-[#DDDDDD] bg-white text-[rgb(64,64,64)] hover:bg-[rgb(250,250,250)] hover:border-[rgb(150,150,150)] [&_svg]:text-current"
                            style={{ color: "rgb(64,64,64)" }}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1.5" />
                            Add evaluation
                          </Button>
                        </div>
                      )}
                    </>
                  );
                })()}
            </div>
          </DialogContent>
        </Dialog>

        {/* Column Management Modal */}
        <EvaluationColumnManagementModal
          isOpen={isManageColumnsModalOpen}
          onOpenChange={setIsManageColumnsModalOpen}
          columns={evaluationColumns}
          onColumnsChange={handleSaveColumns}
        />

        {/* Edit Evaluation Dialog – one form for date, rating, notes */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingCell?.existingEvaluation ? "Edit" : "Add"}{" "}
                {editingCell?.columnLabel ?? "evaluation"}
              </DialogTitle>
              {!editingCell && (
                <DialogDescription>
                  Select employee and enter evaluation details.
                </DialogDescription>
              )}
            </DialogHeader>
            <form onSubmit={handleSaveEvaluation} className="space-y-4">
              {!editingCell && (
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select
                    value={selectedEmployeeId}
                    onValueChange={setSelectedEmployeeId}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees?.map((emp: any) => (
                        <SelectItem key={emp._id} value={emp._id}>
                          {emp.personalInfo.firstName}{" "}
                          {emp.personalInfo.lastName} –{" "}
                          {emp.employment.employeeId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Dynamic fields based on column type */}
              {editingCell?.columnType === "date" && (
                <div className="space-y-2">
                  <Label>Evaluation Date</Label>
                  <Input
                    type="date"
                    value={evaluationDate}
                    onChange={(e) => setEvaluationDate(e.target.value)}
                    required
                  />
                </div>
              )}

              {editingCell?.columnType === "rating" && (
                <div className="space-y-2">
                  <Label>Rating</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    step={0.5}
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                    placeholder="e.g., 4.5"
                    required
                  />
                </div>
              )}

              {editingCell?.columnType === "number" && (
                <div className="space-y-2">
                  <Label>Value</Label>
                  <Input
                    type="number"
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                    placeholder="Enter numeric value"
                    required
                  />
                </div>
              )}

              {editingCell?.columnType === "text" && (
                <div className="space-y-2">
                  <Label>Text</Label>
                  <Textarea
                    value={textValue}
                    onChange={(e) => setTextValue(e.target.value)}
                    placeholder="Enter text notes"
                    rows={4}
                    required
                  />
                </div>
              )}

              {/* Show rating field if column has rating column or if clicking on rating column */}
              {(editingCell?.isRatingColumn ||
                (editingCell?.columnType === "date" &&
                  evaluationColumns.find((c) => c.id === editingCell.columnId)
                    ?.hasRatingColumn)) && (
                <div className="space-y-2">
                  <Label>Rating</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    step={0.5}
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                    placeholder="e.g., 4.5"
                  />
                </div>
              )}

              {/* Show notes field if column has notes column or if clicking on notes column */}
              {(editingCell?.isNotesColumn ||
                (editingCell?.columnType === "date" &&
                  evaluationColumns.find((c) => c.id === editingCell.columnId)
                    ?.hasNotesColumn)) && (
                <>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Enter notes, summary, key points, or next steps"
                      rows={4}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Attachment Link (optional)</Label>
                    <Input
                      value={attachmentUrl}
                      onChange={(e) => setAttachmentUrl(e.target.value)}
                      placeholder="Paste link to evaluation file (Google Drive, etc.)"
                    />
                  </div>
                </>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditDialogOpen(false)}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Evaluation"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
