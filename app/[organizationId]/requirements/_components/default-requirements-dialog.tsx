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

interface DefaultRequirementsDialogProps {
  defaultReqsList: Array<{ type: string; isRequired?: boolean }>;
  onSave: (
    requirements: Array<{ type: string; isRequired?: boolean }>
  ) => Promise<void>;
  onUpdateList: (
    requirements: Array<{ type: string; isRequired?: boolean }>
  ) => void;
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
    onUpdateList([...defaultReqsList, { type: newDefaultReq.trim() }]);
    setNewDefaultReq("");
  };

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
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 border rounded"
                  >
                    <span className="text-sm">{req.type}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveDefaultRequirement(idx)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
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
