"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Settings } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

type DefaultRequirementPolicy = {
  type: string;
  isRequired?: boolean;
  appliesToDepartments?: string[];
  appliesToEmploymentTypes?: string[];
  reminderDaysBeforeDue?: number;
  requiresVerification?: boolean;
  expiryDaysAfterSubmission?: number;
};

interface DefaultRequirementsDialogProps {
  defaultReqsList: DefaultRequirementPolicy[];
  onSave: (requirements: DefaultRequirementPolicy[]) => Promise<void>;
  onUpdateList: (requirements: DefaultRequirementPolicy[]) => void;
}

export function DefaultRequirementsDialog({
  defaultReqsList,
  onSave,
  onUpdateList,
}: DefaultRequirementsDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newDefaultReq, setNewDefaultReq] = useState("");
  const { toast } = useToast();

  const handleAddDefaultRequirement = () => {
    if (!newDefaultReq.trim()) return;
    if (defaultReqsList.some((r) => r.type === newDefaultReq.trim())) {
      toast({
        title: "Error",
        description: "This requirement type already exists",
        variant: "destructive",
      });
      return;
    }
    onUpdateList([
      ...defaultReqsList,
      {
        type: newDefaultReq.trim(),
        isRequired: true,
        requiresVerification: true,
      },
    ]);
    setNewDefaultReq("");
  };

  const handleUpdateRequirement = (
    index: number,
    updates: Partial<DefaultRequirementPolicy>,
  ) => {
    onUpdateList(
      defaultReqsList.map((req, idx) =>
        idx === index ? { ...req, ...updates } : req,
      ),
    );
  };

  const parseCsv = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const handleRemoveDefaultRequirement = (index: number) => {
    onUpdateList(defaultReqsList.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      await onSave(defaultReqsList);
      setIsOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update default requirements",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings className="mr-2 h-4 w-4" />
          Manage Defaults
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Default Requirements</DialogTitle>
          <DialogDescription>
            Set common requirements that apply to all employees. These will be
            automatically added to new employees.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Add New Default Requirement</Label>
            <div className="flex gap-2">
              <Input
                value={newDefaultReq}
                onChange={(e) => setNewDefaultReq(e.target.value)}
                placeholder="e.g., NBI Clearance, TOR, Diploma"
                autoFocus={false}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddDefaultRequirement();
                  }
                }}
              />
              <Button onClick={handleAddDefaultRequirement}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Default Requirements List</Label>
            <div className="border rounded-lg p-4 space-y-2 max-h-60 overflow-y-auto">
              {defaultReqsList.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">
                  No default requirements set
                </p>
              ) : (
                defaultReqsList.map((req, idx) => (
                  <div key={idx} className="space-y-3 p-3 border rounded">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{req.type}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveDefaultRequirement(idx)}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={req.isRequired ?? true}
                          onChange={(event) =>
                            handleUpdateRequirement(idx, {
                              isRequired: event.target.checked,
                            })
                          }
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={req.requiresVerification ?? true}
                          onChange={(event) =>
                            handleUpdateRequirement(idx, {
                              requiresVerification: event.target.checked,
                            })
                          }
                        />
                        Verification required
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Reminder days before due</Label>
                        <Input
                          type="number"
                          min="0"
                          value={req.reminderDaysBeforeDue ?? ""}
                          onChange={(event) =>
                            handleUpdateRequirement(idx, {
                              reminderDaysBeforeDue: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            })
                          }
                          placeholder="e.g., 7"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Expiry days after submission</Label>
                        <Input
                          type="number"
                          min="0"
                          value={req.expiryDaysAfterSubmission ?? ""}
                          onChange={(event) =>
                            handleUpdateRequirement(idx, {
                              expiryDaysAfterSubmission: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            })
                          }
                          placeholder="e.g., 365"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Applies to departments</Label>
                        <Input
                          value={req.appliesToDepartments?.join(", ") ?? ""}
                          onChange={(event) =>
                            handleUpdateRequirement(idx, {
                              appliesToDepartments: parseCsv(
                                event.target.value,
                              ),
                            })
                          }
                          placeholder="Blank means all"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Applies to employment types</Label>
                        <Input
                          value={req.appliesToEmploymentTypes?.join(", ") ?? ""}
                          onChange={(event) =>
                            handleUpdateRequirement(idx, {
                              appliesToEmploymentTypes: parseCsv(
                                event.target.value,
                              ),
                            })
                          }
                          placeholder="regular, probationary"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Defaults</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
