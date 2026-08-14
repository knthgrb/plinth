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
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { addRequirement } from "@/actions/employees";
import { errorMessage } from "@/lib/requirements/ui-types";

interface AddRequirementDialogProps {
  employeeId: string;
  onSuccess: () => void;
}

export function AddRequirementDialog({
  employeeId,
  onSuccess,
}: AddRequirementDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState("");
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!type.trim()) {
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
          type,
          status: "pending",
        },
      });
      setIsOpen(false);
      setType("");
      toast({
        title: "Success",
        description: "Custom requirement added successfully",
      });
      onSuccess();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to add requirement"),
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
            <Label htmlFor="type">
              Requirement Type <span className="text-red-500">*</span>
            </Label>
            <Input
              id="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="e.g., Special Certification, License"
              required
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
