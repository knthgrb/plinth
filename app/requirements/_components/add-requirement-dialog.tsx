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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { addRequirement } from "@/app/actions/employees";

interface AddRequirementDialogProps {
  employeeId: string;
  onSuccess: () => void;
}

export function AddRequirementDialog({
  employeeId,
  onSuccess,
}: AddRequirementDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    type: "",
    status: "submitted" as "submitted" | "passed",
    expiryDate: "",
  });
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!formData.type.trim()) {
      toast({
        title: "Error",
        description: "Please enter requirement type",
        variant: "destructive",
      });
      return;
    }

    try {
      await addRequirement({
        employeeId,
        requirement: {
          type: formData.type,
          status: formData.status === "passed" ? "verified" : "pending",
          expiryDate: formData.expiryDate
            ? new Date(formData.expiryDate).getTime()
            : undefined,
        },
      });
      setIsOpen(false);
      setFormData({
        type: "",
        status: "submitted",
        expiryDate: "",
      });
      toast({
        title: "Success",
        description: "Custom requirement added successfully",
      });
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add requirement",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add requirement
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add requirement</DialogTitle>
          <DialogDescription>
            Add a requirement specific to this employee
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="type">Requirement Type *</Label>
            <Input
              id="type"
              value={formData.type}
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value })
              }
              placeholder="e.g., Special Certification, License"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Initial Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value: any) =>
                setFormData({ ...formData, status: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="passed">Passed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="expiryDate">Expiry Date (Optional)</Label>
            <Input
              id="expiryDate"
              type="date"
              value={formData.expiryDate}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  expiryDate: e.target.value,
                })
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Add Requirement</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
