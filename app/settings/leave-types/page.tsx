"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";

export default function LeaveTypesSettingsPage() {
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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings?.leaveTypes) {
      setLeaveTypes(settings.leaveTypes);
    }
  }, [settings]);

  const handleSave = async () => {
    if (!currentOrganizationId) return;
    setIsSaving(true);
    try {
      await updateLeaveTypes({
        organizationId: currentOrganizationId,
        leaveTypes,
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

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setFormData(leaveTypes[index]);
    setIsDialogOpen(true);
  };

  const handleDelete = (index: number) => {
    setLeaveTypes(leaveTypes.filter((_, i) => i !== index));
  };

  const handleSaveLeaveType = () => {
    if (editingIndex !== null) {
      const updated = [...leaveTypes];
      updated[editingIndex] = formData;
      setLeaveTypes(updated);
    } else {
      setLeaveTypes([...leaveTypes, formData]);
    }
    setIsDialogOpen(false);
    setEditingIndex(null);
  };

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Leave Types Settings
          </h1>
          <p className="text-gray-600 mt-2">
            Configure leave types and their settings
          </p>
        </div>

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
          <CardContent>
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
                    <TableCell
                      colSpan={8}
                      className="text-center text-gray-500"
                    >
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
                      <TableCell>
                        {lt.requiresApproval ? "Yes" : "No"}
                      </TableCell>
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
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingIndex !== null ? "Edit" : "Add"} Leave Type
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
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
                    />
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
      </div>
    </MainLayout>
  );
}
