"use client";

import { useState, useEffect } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { format } from "date-fns";
import { createEvaluation, updateEvaluation } from "@/app/actions/evaluations";
import { updateEvaluationColumns } from "@/app/actions/settings";
import { EvaluationColumnManagementModal } from "./evaluation-column-management-modal";

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
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const evaluations = useQuery(
    (api as any).evaluations.getEvaluations,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
        }
      : "skip"
  );

  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
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
        (col: EvaluationColumn) => !col.id.endsWith("-rating")
      );
      setEvaluationColumns(filteredColumns);
    }
  }, [settings]);

  const [isManageColumnsModalOpen, setIsManageColumnsModalOpen] =
    useState(false);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
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

  const isAdminOrHr =
    user?.role === "admin" ||
    user?.role === "hr" ||
    user?.role === "accounting";

  if (!currentOrganizationId) {
    return (
      <MainLayout>
        <div className="p-8">No organization selected.</div>
      </MainLayout>
    );
  }

  if (user === undefined || settings === undefined) {
    return (
      <MainLayout>
        <div className="p-8">Loading...</div>
      </MainLayout>
    );
  }

  if (!isAdminOrHr) {
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
        (col) => !col.id.endsWith("-rating")
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
    isRatingColumn: boolean = false,
    isNotesColumn: boolean = false
  ) => {
    setEditingCell({
      employeeId,
      columnId: column.id,
      columnLabel: column.label,
      columnType: column.type,
      existingEvaluation,
      isRatingColumn,
      isNotesColumn,
    });
    setSelectedEmployeeId(employeeId);
    if (existingEvaluation) {
      setEvaluationDate(
        format(new Date(existingEvaluation.evaluationDate), "yyyy-MM-dd")
      );
      setLabel(existingEvaluation.label);
      setRating(
        existingEvaluation.rating != null
          ? String(existingEvaluation.rating)
          : ""
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

  const displayedEmployees = employees || [];

  // Filter visible columns
  const visibleColumns = evaluationColumns.filter((col) => !col.hidden);

  // Default columns that are always shown (unless hidden)
  const defaultColumns = [
    { id: "employee", label: "Employee", type: "text" as const },
    { id: "employeeId", label: "Employee ID", type: "text" as const },
    { id: "position", label: "Position", type: "text" as const },
    { id: "hiredDate", label: "Hired Date", type: "date" as const },
  ].filter((dc) => {
    const col = evaluationColumns.find((c) => c.id === dc.id);
    return !col?.hidden;
  });

  const getCellValue = (
    employeeId: string,
    column: EvaluationColumn,
    isRatingColumn: boolean = false
  ) => {
    const ev = evaluations?.find(
      (e: any) => e.employeeId === employeeId && e.label === column.label
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

  return (
    <MainLayout>
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Evaluations</h1>
          <p className="text-gray-600 mt-2">
            Track employee performance evaluations per employee (probationary,
            promotion, annual, or any custom schedule your company uses).
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <CardTitle>Evaluation Matrix</CardTitle>
              <p className="text-xs text-gray-500">
                Click on any cell to add or edit evaluation data.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setIsManageColumnsModalOpen(true)}
            >
              Manage Columns
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  {defaultColumns.map((col) => (
                    <th key={col.id} className="py-2 pr-4">
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
                        ].includes(col.id)
                    )
                    .map((col) => (
                      <th key={col.id} className="py-2 pr-4">
                        {col.label}
                      </th>
                    ))}
                  {/* Rating column headers - only for parent columns with hasRatingColumn */}
                  {visibleColumns
                    .filter(
                      (col) =>
                        col.hasRatingColumn &&
                        !col.id.endsWith("-rating") && // Exclude rating columns themselves
                        ![
                          "employee",
                          "employeeId",
                          "position",
                          "hiredDate",
                        ].includes(col.id)
                    )
                    .map((col) => (
                      <th key={`${col.id}-rating`} className="py-2 pr-4">
                        {col.label} Rating
                      </th>
                    ))}
                  {/* Notes column headers - only for parent columns with hasNotesColumn */}
                  {visibleColumns
                    .filter(
                      (col) =>
                        col.hasNotesColumn &&
                        ![
                          "employee",
                          "employeeId",
                          "position",
                          "hiredDate",
                        ].includes(col.id)
                    )
                    .map((col) => (
                      <th key={`${col.id}-notes`} className="py-2 pr-4">
                        {col.label} Notes
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {displayedEmployees.length > 0 ? (
                  displayedEmployees.map((emp: any) => (
                    <tr key={emp._id} className="border-b last:border-0">
                      {/* Default columns */}
                      {defaultColumns.map((col) => {
                        if (col.id === "employee") {
                          return (
                            <td key={col.id} className="py-2 pr-4">
                              {emp.personalInfo.firstName}{" "}
                              {emp.personalInfo.lastName}
                            </td>
                          );
                        }
                        if (col.id === "employeeId") {
                          return (
                            <td key={col.id} className="py-2 pr-4">
                              {emp.employment.employeeId}
                            </td>
                          );
                        }
                        if (col.id === "position") {
                          return (
                            <td key={col.id} className="py-2 pr-4">
                              {emp.employment.position}
                            </td>
                          );
                        }
                        if (col.id === "hiredDate") {
                          return (
                            <td key={col.id} className="py-2 pr-4">
                              {emp.employment.hireDate
                                ? format(
                                    new Date(emp.employment.hireDate),
                                    "MMM dd, yyyy"
                                  )
                                : "—"}
                            </td>
                          );
                        }
                        return null;
                      })}
                      {/* Custom evaluation columns */}
                      {visibleColumns
                        .filter(
                          (col) =>
                            ![
                              "employee",
                              "employeeId",
                              "position",
                              "hiredDate",
                            ].includes(col.id)
                        )
                        .map((col) => {
                          const ev = evaluations?.find(
                            (e: any) =>
                              e.employeeId === emp._id && e.label === col.label
                          );
                          const value = getCellValue(emp._id, col);
                          return (
                            <td
                              key={col.id}
                              onClick={() =>
                                handleCellClick(
                                  emp._id,
                                  col,
                                  ev || undefined,
                                  false,
                                  false
                                )
                              }
                              className="py-2 pr-4 text-xs cursor-pointer hover:bg-gray-50 transition-colors"
                              title="Click to edit"
                            >
                              {value || "—"}
                            </td>
                          );
                        })}
                      {/* Rating columns - only show for columns that have hasRatingColumn=true */}
                      {visibleColumns
                        .filter(
                          (col) =>
                            col.hasRatingColumn &&
                            ![
                              "employee",
                              "employeeId",
                              "position",
                              "hiredDate",
                            ].includes(col.id) &&
                            !col.id.endsWith("-rating") // Don't show rating columns that are separate entries
                        )
                        .map((col) => {
                          // Find the parent evaluation using the parent column's label
                          // Rating columns should reference the parent column's label, not their own
                          const ev = evaluations?.find(
                            (e: any) =>
                              e.employeeId === emp._id && e.label === col.label
                          );
                          // Get rating value from the parent evaluation (number only)
                          const ratingValue =
                            ev?.rating != null ? Number(ev.rating) : null;
                          return (
                            <td
                              key={`${col.id}-rating`}
                              onClick={() => {
                                // When clicking rating column, edit the parent evaluation's rating
                                // Pass isRatingColumn=true to indicate this is a rating column click
                                handleCellClick(
                                  emp._id,
                                  col,
                                  ev || undefined,
                                  true,
                                  false
                                );
                              }}
                              className="py-2 pr-4 text-xs cursor-pointer hover:bg-gray-50 transition-colors"
                              title="Click to edit rating"
                            >
                              {ratingValue != null ? ratingValue : "—"}
                            </td>
                          );
                        })}
                      {/* Notes columns - only show for columns that have hasNotesColumn=true */}
                      {visibleColumns
                        .filter(
                          (col) =>
                            col.hasNotesColumn &&
                            ![
                              "employee",
                              "employeeId",
                              "position",
                              "hiredDate",
                            ].includes(col.id)
                        )
                        .map((col) => {
                          // Find the parent evaluation using the parent column's label
                          const ev = evaluations?.find(
                            (e: any) =>
                              e.employeeId === emp._id && e.label === col.label
                          );
                          // Get notes value from the parent evaluation
                          const notesValue =
                            ev?.notes || ev?.attachmentUrl
                              ? `${ev.notes || ""}${ev.notes && ev.attachmentUrl ? " | " : ""}${ev.attachmentUrl ? `[Link]` : ""}`
                              : null;
                          return (
                            <td
                              key={`${col.id}-notes`}
                              onClick={() => {
                                // When clicking notes column, edit the parent evaluation's notes
                                // Pass isNotesColumn=true to indicate this is a notes column click
                                handleCellClick(
                                  emp._id,
                                  col,
                                  ev || undefined,
                                  false,
                                  true
                                );
                              }}
                              className="py-2 pr-4 text-xs cursor-pointer hover:bg-gray-50 transition-colors max-w-xs truncate"
                              title={notesValue || "Click to add notes"}
                            >
                              {notesValue ? (
                                <span
                                  className="truncate block"
                                  title={notesValue}
                                >
                                  {notesValue}
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
                  <tr>
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
                            ].includes(col.id)
                        ).length +
                        visibleColumns.filter(
                          (col) =>
                            col.hasRatingColumn &&
                            !col.id.endsWith("-rating") &&
                            ![
                              "employee",
                              "employeeId",
                              "position",
                              "hiredDate",
                            ].includes(col.id)
                        ).length +
                        visibleColumns.filter(
                          (col) =>
                            col.hasNotesColumn &&
                            ![
                              "employee",
                              "employeeId",
                              "position",
                              "hiredDate",
                            ].includes(col.id)
                        ).length
                      }
                      className="py-4 text-center text-gray-500"
                    >
                      No employees found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Column Management Modal */}
        <EvaluationColumnManagementModal
          isOpen={isManageColumnsModalOpen}
          onOpenChange={setIsManageColumnsModalOpen}
          columns={evaluationColumns}
          onColumnsChange={handleSaveColumns}
        />

        {/* Edit Evaluation Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingCell?.existingEvaluation
                  ? "Edit Evaluation"
                  : "Add Evaluation"}
              </DialogTitle>
              <DialogDescription>
                {editingCell &&
                  `Record evaluation for ${editingCell.columnLabel}`}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveEvaluation} className="space-y-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select
                  value={selectedEmployeeId}
                  onValueChange={setSelectedEmployeeId}
                  required
                  disabled={!!editingCell}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees?.map((emp: any) => (
                      <SelectItem key={emp._id} value={emp._id}>
                        {emp.personalInfo.firstName} {emp.personalInfo.lastName}{" "}
                        - {emp.employment.employeeId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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
