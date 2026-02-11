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
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { GripVertical, X, Plus, Eye, EyeOff } from "lucide-react";

interface Column {
  id: string;
  label: string;
  field: string;
  type: "text" | "number" | "date" | "badge" | "link";
  sortable?: boolean;
  width?: string;
  customField?: boolean;
  isDefault?: boolean;
  hidden?: boolean;
}

interface LeaveColumnManagementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  onColumnsChange: (columns: Column[]) => void;
  tableType: "requests" | "history";
}

const DEFAULT_COLUMNS_REQUESTS: Column[] = [
  {
    id: "employee",
    label: "Employee",
    field: "employee",
    type: "text",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "leaveType",
    label: "Leave Type",
    field: "leaveType",
    type: "text",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "startDate",
    label: "Start Date",
    field: "startDate",
    type: "date",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "endDate",
    label: "End Date",
    field: "endDate",
    type: "date",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "days",
    label: "Days",
    field: "numberOfDays",
    type: "number",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "status",
    label: "Status",
    field: "status",
    type: "badge",
    sortable: true,
    width: "120px",
    isDefault: true,
    hidden: false,
  },
];

const DEFAULT_COLUMNS_HISTORY: Column[] = [
  {
    id: "employee",
    label: "Employee",
    field: "employee",
    type: "text",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "leaveType",
    label: "Leave Type",
    field: "leaveType",
    type: "text",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "startDate",
    label: "Start Date",
    field: "startDate",
    type: "date",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "endDate",
    label: "End Date",
    field: "endDate",
    type: "date",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "days",
    label: "Days",
    field: "numberOfDays",
    type: "number",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
  {
    id: "reason",
    label: "Reason",
    field: "reason",
    type: "text",
    sortable: false,
    isDefault: true,
    hidden: false,
  },
  {
    id: "filedDate",
    label: "Filed Date",
    field: "filedDate",
    type: "date",
    sortable: true,
    isDefault: true,
    hidden: false,
  },
];

const AVAILABLE_FIELDS = [
  { value: "employee", label: "Employee", type: "text" },
  { value: "leaveType", label: "Leave Type", type: "text" },
  { value: "startDate", label: "Start Date", type: "date" },
  { value: "endDate", label: "End Date", type: "date" },
  { value: "numberOfDays", label: "Days", type: "number" },
  { value: "status", label: "Status", type: "badge" },
  { value: "reason", label: "Reason", type: "text" },
  { value: "filedDate", label: "Filed Date", type: "date" },
];

export function LeaveColumnManagementModal({
  isOpen,
  onOpenChange,
  columns,
  onColumnsChange,
  tableType,
}: LeaveColumnManagementModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [localColumns, setLocalColumns] = useState<Column[]>(columns);
  const [newColumn, setNewColumn] = useState<Partial<Column>>({
    label: "",
    field: "",
    type: "text",
    sortable: true,
    customField: false,
  });

  const updateColumnsMutation = useMutation(
    (api as any).settings.updateLeaveTableColumns
  );

  useEffect(() => {
    if (isOpen) {
      const defaults =
        tableType === "requests"
          ? DEFAULT_COLUMNS_REQUESTS
          : DEFAULT_COLUMNS_HISTORY;

      if (columns.length === 0) {
        setLocalColumns(defaults);
      } else {
        // Merge saved columns with defaults - ensure all defaults are present
        const defaultIds = new Set(defaults.map((d) => d.id));
        const savedColumns = columns.filter((c) => !c.isDefault);
        const savedDefaultColumns = columns.filter((c) => c.isDefault);

        // Merge defaults with saved defaults (preserve hidden state)
        const mergedDefaults = defaults.map((def) => {
          const saved = savedDefaultColumns.find((c) => c.id === def.id);
          return saved
            ? { ...def, ...saved } // Preserve saved state (hidden, label changes, etc.)
            : def;
        });

        setLocalColumns([...mergedDefaults, ...savedColumns]);
      }
    }
  }, [isOpen, columns, tableType]);

  const handleSave = async () => {
    if (!currentOrganizationId) return;

    try {
      await updateColumnsMutation({
        organizationId: currentOrganizationId,
        columns: localColumns.map((col) => ({
          id: col.id,
          label: col.label,
          field: col.field,
          type: col.type,
          sortable: col.sortable !== false,
          width: col.width,
          customField: col.customField || false,
          isDefault: col.isDefault || false,
          hidden: col.hidden || false,
        })),
      });

      onColumnsChange(localColumns);
      toast({
        title: "Success",
        description: "Table columns updated successfully",
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update columns",
        variant: "destructive",
      });
    }
  };

  const handleAddColumn = () => {
    if (!newColumn.label || !newColumn.field) {
      toast({
        title: "Validation Error",
        description: "Please provide both label and field",
        variant: "destructive",
      });
      return;
    }

    const columnId = newColumn.field.replace(/\./g, "_");
    const existingField = AVAILABLE_FIELDS.find(
      (f) => f.value === newColumn.field
    );

    const column: Column = {
      id: columnId,
      label: newColumn.label,
      field: newColumn.field,
      type: (newColumn.type || existingField?.type || "text") as Column["type"],
      sortable: newColumn.sortable !== false,
      width: newColumn.width,
      customField: newColumn.customField || false,
      isDefault: false,
      hidden: false,
    };

    setLocalColumns([...localColumns, column]);
    setNewColumn({
      label: "",
      field: "",
      type: "text",
      sortable: true,
      customField: false,
    });
  };

  const handleRemoveColumn = (id: string) => {
    const column = localColumns.find((c) => c.id === id);
    if (column?.isDefault) {
      toast({
        title: "Error",
        description:
          "Default columns cannot be removed. You can hide them instead.",
        variant: "destructive",
      });
      return;
    }
    setLocalColumns(localColumns.filter((col) => col.id !== id));
  };

  const handleToggleHidden = (id: string) => {
    setLocalColumns(
      localColumns.map((col) =>
        col.id === id ? { ...col, hidden: !col.hidden } : col
      )
    );
  };

  const handleMoveColumn = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= localColumns.length) return;

    const newColumns = [...localColumns];
    [newColumns[index], newColumns[newIndex]] = [
      newColumns[newIndex],
      newColumns[index],
    ];
    setLocalColumns(newColumns);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Table Columns</DialogTitle>
          <DialogDescription>
            Configure which columns to display in the {tableType} table. Drag to
            reorder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Current Columns</Label>
            <div className="space-y-2 border rounded-md p-2">
              {localColumns.map((column, index) => {
                const isDefault = column.isDefault || false;
                const isHidden = column.hidden || false;
                return (
                  <div
                    key={column.id}
                    className={`flex items-center gap-2 p-2 rounded ${
                      isHidden ? "bg-gray-100 opacity-60" : "bg-gray-50"
                    }`}
                  >
                    <GripVertical className="h-4 w-4 text-gray-400" />
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <div>
                        <div className="flex items-center gap-1">
                          <Label className="text-xs">Label</Label>
                          {isDefault && (
                            <span className="text-xs text-blue-600 font-medium">
                              (Default)
                            </span>
                          )}
                        </div>
                        <Input
                          value={column.label}
                          onChange={(e) => {
                            const updated = [...localColumns];
                            updated[index].label = e.target.value;
                            setLocalColumns(updated);
                          }}
                          className="h-8"
                          disabled={isDefault}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Field</Label>
                        <Input
                          value={column.field}
                          onChange={(e) => {
                            const updated = [...localColumns];
                            updated[index].field = e.target.value;
                            setLocalColumns(updated);
                          }}
                          className="h-8"
                          disabled={isDefault}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={column.type}
                          onValueChange={(value: Column["type"]) => {
                            const updated = [...localColumns];
                            updated[index].type = value;
                            setLocalColumns(updated);
                          }}
                          disabled={isDefault}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="badge">Badge</SelectItem>
                            <SelectItem value="link">Link</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMoveColumn(index, "up")}
                        disabled={index === 0}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMoveColumn(index, "down")}
                        disabled={index === localColumns.length - 1}
                      >
                        ↓
                      </Button>
                      {isDefault ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleHidden(column.id)}
                          title={isHidden ? "Show column" : "Hide column"}
                        >
                          {isHidden ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveColumn(column.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label>Add New Column</Label>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Label</Label>
                <Input
                  value={newColumn.label || ""}
                  onChange={(e) =>
                    setNewColumn({ ...newColumn, label: e.target.value })
                  }
                  placeholder="e.g., Department"
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Field</Label>
                <Select
                  value={newColumn.field || ""}
                  onValueChange={(value) => {
                    const field = AVAILABLE_FIELDS.find(
                      (f) => f.value === value
                    );
                    setNewColumn({
                      ...newColumn,
                      field: value,
                      type: (field?.type || "text") as Column["type"],
                    });
                  }}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_FIELDS.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom.other">Custom: Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select
                  value={newColumn.type || "text"}
                  onValueChange={(value: Column["type"]) =>
                    setNewColumn({ ...newColumn, type: value })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="badge">Badge</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleAddColumn}
                  size="sm"
                  className="h-8 w-full"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>
            {newColumn.field === "custom.other" && (
              <div className="mt-2">
                <Label className="text-xs">Custom Field Path</Label>
                <Input
                  value={newColumn.field}
                  onChange={(e) => {
                    const fieldValue = e.target.value;
                    if (fieldValue.startsWith("custom.")) {
                      setNewColumn({
                        ...newColumn,
                        field: fieldValue,
                        customField: true,
                      });
                    }
                  }}
                  placeholder="e.g., custom.department"
                  className="h-8"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Columns</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
