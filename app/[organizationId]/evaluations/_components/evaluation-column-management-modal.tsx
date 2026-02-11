"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { cn } from "@/utils/utils";

type EvaluationColumn = {
  id: string;
  label: string;
  type: "date" | "number" | "text" | "rating";
  hidden?: boolean;
  hasRatingColumn?: boolean;
  hasNotesColumn?: boolean;
};

interface EvaluationColumnManagementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  columns: EvaluationColumn[];
  onColumnsChange: (columns: EvaluationColumn[]) => void;
}

// Employee ID column excluded from manage columns (internal only)
const DEFAULT_COLUMNS: EvaluationColumn[] = [
  {
    id: "employee",
    label: "Employee",
    type: "text",
    hidden: false,
  },
  {
    id: "position",
    label: "Position",
    type: "text",
    hidden: false,
  },
  {
    id: "hiredDate",
    label: "Hired Date",
    type: "date",
    hidden: false,
  },
];

export function EvaluationColumnManagementModal({
  isOpen,
  onOpenChange,
  columns,
  onColumnsChange,
}: EvaluationColumnManagementModalProps) {
  const [localColumns, setLocalColumns] = useState<EvaluationColumn[]>([]);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState("");
  const [newColumnType, setNewColumnType] = useState<
    "date" | "number" | "text"
  >("date");
  const [addRatingColumn, setAddRatingColumn] = useState(false);
  const [addNotesColumn, setAddNotesColumn] = useState(false);

  useEffect(() => {
    // Merge default columns with custom columns; exclude employeeId (internal only)
    const defaultCols = DEFAULT_COLUMNS.map((col) => ({
      ...col,
      hidden: columns.find((c) => c.id === col.id)?.hidden ?? col.hidden,
    }));

    const customCols = columns.filter(
      (col) =>
        col.id !== "employeeId" &&
        !DEFAULT_COLUMNS.some((dc) => dc.id === col.id)
    );

    setLocalColumns([...defaultCols, ...customCols]);
  }, [columns, isOpen]);

  const handleToggleVisibility = (columnId: string) => {
    setLocalColumns((cols) =>
      cols.map((col) =>
        col.id === columnId ? { ...col, hidden: !col.hidden } : col
      )
    );
  };

  const handleAddColumn = () => {
    if (!newColumnLabel.trim()) return;

    const newColumn: EvaluationColumn = {
      id: `col-${Date.now()}`,
      label: newColumnLabel.trim(),
      type: newColumnType,
      hidden: false,
      hasRatingColumn: addRatingColumn && newColumnType === "date",
      hasNotesColumn: addNotesColumn && newColumnType === "date",
    };

    const updatedColumns = [...localColumns, newColumn];
    // Don't create a separate rating column entry - rating columns are rendered dynamically
    // based on hasRatingColumn flag on parent columns

    setLocalColumns(updatedColumns);
    setNewColumnLabel("");
    setNewColumnType("date");
    setAddRatingColumn(false);
    setAddNotesColumn(false);
    setIsAddingColumn(false);
  };

  const handleDeleteColumn = (columnId: string) => {
    // Don't allow deleting default columns
    if (DEFAULT_COLUMNS.some((dc) => dc.id === columnId)) return;

    // Just delete the column - rating columns are rendered dynamically, not stored separately
    setLocalColumns((cols) => cols.filter((c) => c.id !== columnId));
  };

  const handleSave = () => {
    // Only save custom columns (not defaults); never save employeeId
    const customColumns = localColumns.filter(
      (col) =>
        col.id !== "employeeId" &&
        !DEFAULT_COLUMNS.some((dc) => dc.id === col.id)
    );

    // Include default columns with their hidden state (no employeeId)
    const allColumns = [
      ...DEFAULT_COLUMNS.map((dc) => {
        const localCol = localColumns.find((lc) => lc.id === dc.id);
        return { ...dc, hidden: localCol?.hidden ?? false };
      }),
      ...customColumns,
    ];

    onColumnsChange(allColumns);
    onOpenChange(false);
  };

  const handleCancel = () => {
    // Reset to original columns (exclude employeeId)
    const defaultCols = DEFAULT_COLUMNS.map((col) => ({
      ...col,
      hidden: columns.find((c) => c.id === col.id)?.hidden ?? col.hidden,
    }));
    const customCols = columns.filter(
      (col) =>
        col.id !== "employeeId" &&
        !DEFAULT_COLUMNS.some((dc) => dc.id === col.id)
    );
    setLocalColumns([...defaultCols, ...customCols]);
    setIsAddingColumn(false);
    setNewColumnLabel("");
    setNewColumnType("date");
    setAddRatingColumn(false);
    setAddNotesColumn(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Columns</DialogTitle>
          <DialogDescription>
            Show or hide columns, and add custom evaluation columns.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing Columns */}
          <div className="space-y-2">
            <Label>Columns</Label>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {localColumns.map((column) => {
                const isDefault = DEFAULT_COLUMNS.some(
                  (dc) => dc.id === column.id
                );
                return (
                  <div
                    key={column.id}
                    className="flex items-center gap-3 p-2 border rounded-lg"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleVisibility(column.id)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      {column.hidden ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                    <div className="flex-1">
                      <div className="font-medium">{column.label}</div>
                      <div className="text-xs text-gray-500">
                        {column.type}
                        {(column.hasRatingColumn || column.hasNotesColumn) &&
                          ` • ${[
                            column.hasRatingColumn && "rating",
                            column.hasNotesColumn && "notes",
                          ]
                            .filter(Boolean)
                            .join(", ")}`}
                      </div>
                    </div>
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => handleDeleteColumn(column.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add New Column */}
          {!isAddingColumn ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddingColumn(true)}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Column
            </Button>
          ) : (
            <div className="space-y-3 p-4 border rounded-lg">
              <div className="space-y-2">
                <Label>Column Label</Label>
                <Input
                  value={newColumnLabel}
                  onChange={(e) => setNewColumnLabel(e.target.value)}
                  placeholder="e.g., 3rd month evaluation"
                />
              </div>

              <div className="space-y-2">
                <Label>Column Type</Label>
                <Select
                  value={newColumnType}
                  onValueChange={(value: any) => setNewColumnType(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {newColumnType === "date" && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-600">
                    Optional fields for this evaluation
                  </p>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="add-rating"
                      checked={addRatingColumn}
                      onCheckedChange={(checked) =>
                        setAddRatingColumn(checked === true)
                      }
                    />
                    <Label
                      htmlFor="add-rating"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Include rating (1–5)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="add-notes"
                      checked={addNotesColumn}
                      onCheckedChange={(checked) =>
                        setAddNotesColumn(checked === true)
                      }
                    />
                    <Label
                      htmlFor="add-notes"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Include notes & attachment
                    </Label>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleAddColumn}
                  disabled={!newColumnLabel.trim()}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddingColumn(false);
                    setNewColumnLabel("");
                    setNewColumnType("date");
                    setAddRatingColumn(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
