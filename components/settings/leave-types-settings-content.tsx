"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";

// Suggested leave types – click to pre-fill the Add form
const SUGGESTED_LEAVE_TYPES = [
  {
    type: "vacation",
    name: "Vacation Leave",
    defaultCredits: 15,
    isPaid: true,
    requiresApproval: true,
    maxConsecutiveDays: 30,
    carryOver: true,
    maxCarryOver: 5,
    isAnniversary: false,
  },
  {
    type: "sick",
    name: "Sick Leave",
    defaultCredits: 15,
    isPaid: true,
    requiresApproval: true,
    maxConsecutiveDays: 30,
    carryOver: true,
    maxCarryOver: 5,
    isAnniversary: false,
  },
  {
    type: "maternity",
    name: "Maternity Leave",
    defaultCredits: 105,
    isPaid: true,
    requiresApproval: true,
    maxConsecutiveDays: 105,
    carryOver: false,
    isAnniversary: false,
  },
  {
    type: "paternity",
    name: "Paternity Leave",
    defaultCredits: 7,
    isPaid: true,
    requiresApproval: true,
    maxConsecutiveDays: 7,
    carryOver: false,
    isAnniversary: false,
  },
  {
    type: "anniversary",
    name: "Anniversary Leave",
    defaultCredits: 0,
    isPaid: true,
    requiresApproval: true,
    carryOver: false,
    isAnniversary: true,
  },
  {
    type: "emergency",
    name: "Emergency Leave",
    defaultCredits: 5,
    isPaid: true,
    requiresApproval: true,
    maxConsecutiveDays: 7,
    carryOver: false,
    isAnniversary: false,
  },
];

export function LeaveTypesSettingsContent() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const updateLeaveTypes = useMutation((api as any).settings.updateLeaveTypes);

  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    type: "",
    name: "",
    defaultCredits: 0,
    isPaid: true,
    requiresApproval: true,
    maxConsecutiveDays: undefined as number | undefined,
    carryOver: false,
    maxCarryOver: undefined as number | undefined,
  });
  const [proratedLeave, setProratedLeave] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings?.leaveTypes) {
      setLeaveTypes(settings.leaveTypes);
    }
    if (settings?.proratedLeave !== undefined) {
      setProratedLeave(settings.proratedLeave);
    }
  }, [settings]);

  const handleSave = async () => {
    if (!currentOrganizationId) return;
    setIsSaving(true);
    try {
      await updateLeaveTypes({
        organizationId: currentOrganizationId,
        leaveTypes,
        proratedLeave,
      });
      toast({
        title: "Success",
        description: "Leave types updated successfully",
      });
      setIsDialogOpen(false);
      setEditingIndex(null);
      setFormData({
        type: "",
        name: "",
        defaultCredits: 0,
        isPaid: true,
        requiresApproval: true,
        maxConsecutiveDays: undefined,
        carryOver: false,
        maxCarryOver: undefined,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update leave types",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdd = () => {
    setEditingIndex(null);
    setFormData({
      type: "",
      name: "",
      defaultCredits: 0,
      isPaid: true,
      requiresApproval: true,
      maxConsecutiveDays: undefined,
      carryOver: false,
      maxCarryOver: undefined,
    });
    setIsDialogOpen(true);
  };

  const applySuggestion = (suggestion: (typeof SUGGESTED_LEAVE_TYPES)[0]) => {
    setFormData({
      type: suggestion.type,
      name: suggestion.name,
      defaultCredits: suggestion.defaultCredits,
      isPaid: suggestion.isPaid,
      requiresApproval: suggestion.requiresApproval,
      maxConsecutiveDays: suggestion.maxConsecutiveDays,
      carryOver: suggestion.carryOver ?? false,
      maxCarryOver: suggestion.maxCarryOver,
    });
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setFormData(leaveTypes[index]);
    setIsDialogOpen(true);
  };

  const handleDelete = (index: number) => {
    setLeaveTypes(leaveTypes.filter((_, i) => i !== index));
  };

  const handleSaveLeaveType = () => {
    const toSave = {
      ...formData,
      isAnniversary: formData.type === "anniversary",
    };
    if (editingIndex !== null) {
      const updated = [...leaveTypes];
      updated[editingIndex] = toSave;
      setLeaveTypes(updated);
    } else {
      setLeaveTypes([...leaveTypes, toSave]);
    }
    setIsDialogOpen(false);
    setEditingIndex(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Leave Types Configuration</CardTitle>
            <Button onClick={handleAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Leave Type
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-2 rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] p-4">
            <Checkbox
              id="proratedLeave"
              checked={proratedLeave}
              onCheckedChange={(checked) =>
                setProratedLeave(checked as boolean)
              }
            />
            <Label
              htmlFor="proratedLeave"
              className="cursor-pointer text-sm font-medium"
            >
              Prorated leave – allocate annual leave proportionally by months
              worked (e.g. new hires get (annual ÷ 12) × months worked)
            </Label>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Default Credits</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Requires Approval</TableHead>
                <TableHead>Max Consecutive Days</TableHead>
                <TableHead>Carry Over</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaveTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500">
                    No leave types configured
                  </TableCell>
                </TableRow>
              ) : (
                leaveTypes.map((lt, index) => (
                  <TableRow key={index}>
                    <TableCell>{lt.name}</TableCell>
                    <TableCell>{lt.type}</TableCell>
                    <TableCell>{lt.defaultCredits}</TableCell>
                    <TableCell>{lt.isPaid ? "Yes" : "No"}</TableCell>
                    <TableCell>{lt.requiresApproval ? "Yes" : "No"}</TableCell>
                    <TableCell>{lt.maxConsecutiveDays || "-"}</TableCell>
                    <TableCell>
                      {lt.carryOver
                        ? `Yes (max: ${lt.maxCarryOver || "-"})`
                        : "No"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(index)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {leaveTypes.length > 0 && (
            <div className="mt-4">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Leave Types"}
              </Button>
            </div>
          )}

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingIndex !== null ? "Edit" : "Add"} Leave Type
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {editingIndex === null && (
                  <div className="space-y-2">
                    <Label className="text-xs text-[rgb(133,133,133)]">
                      Suggestions – click to pre-fill
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTED_LEAVE_TYPES.map((s) => (
                        <Button
                          key={s.type}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => applySuggestion(s)}
                        >
                          {s.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Type (internal ID)</Label>
                  <Input
                    value={formData.type}
                    onChange={(e) =>
                      setFormData({ ...formData, type: e.target.value })
                    }
                    placeholder="e.g., vacation, sick, maternity"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Name (Display Name)</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., Vacation Leave"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Default Credits (per year)</Label>
                  <Input
                    type="number"
                    value={formData.defaultCredits}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        defaultCredits: parseFloat(e.target.value) || 0,
                      })
                    }
                    disabled={formData.type === "anniversary"}
                    placeholder={
                      formData.type === "anniversary"
                        ? "Auto: +1 per year from hire"
                        : undefined
                    }
                  />
                  {formData.type === "anniversary" && (
                    <p className="text-xs text-[rgb(133,133,133)]">
                      Anniversary leave type: employees get 1 day per year from
                      hire/regularization date added to this leave balance.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isPaid"
                    checked={formData.isPaid}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isPaid: checked as boolean })
                    }
                  />
                  <Label htmlFor="isPaid">Is Paid Leave</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="requiresApproval"
                    checked={formData.requiresApproval}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        requiresApproval: checked as boolean,
                      })
                    }
                  />
                  <Label htmlFor="requiresApproval">Requires Approval</Label>
                </div>
                <div className="space-y-2">
                  <Label>Max Consecutive Days (optional)</Label>
                  <Input
                    type="number"
                    value={formData.maxConsecutiveDays || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        maxConsecutiveDays: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="Leave empty for no limit"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="carryOver"
                    checked={formData.carryOver}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        carryOver: checked as boolean,
                      })
                    }
                  />
                  <Label htmlFor="carryOver">Allow Carry Over</Label>
                </div>
                {formData.carryOver && (
                  <div className="space-y-2">
                    <Label>Max Carry Over Credits (optional)</Label>
                    <Input
                      type="number"
                      value={formData.maxCarryOver || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          maxCarryOver: e.target.value
                            ? parseFloat(e.target.value)
                            : undefined,
                        })
                      }
                      placeholder="Leave empty for no limit"
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveLeaveType}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </>
  );
}
