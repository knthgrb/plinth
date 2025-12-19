"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";

interface AddNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaryData: any;
  selectedNoteRow: { employeeId: string; date: number } | null;
  noteText: string;
  isSavingNote: boolean;
  onNoteTextChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function AddNoteDialog({
  open,
  onOpenChange,
  summaryData,
  selectedNoteRow,
  noteText,
  isSavingNote,
  onNoteTextChange,
  onCancel,
  onSave,
}: AddNoteDialogProps) {
  const description = selectedNoteRow && summaryData
    ? `Add a note for ${
        summaryData.summary.find(
          (s: any) => s.employee._id === selectedNoteRow.employeeId
        )?.employee.personalInfo.firstName
      } ${
        summaryData.summary.find(
          (s: any) => s.employee._id === selectedNoteRow.employeeId
        )?.employee.personalInfo.lastName
      } on ${format(new Date(selectedNoteRow.date), "MMM dd, yyyy")}`
    : "Add a note for this employee and date";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Note</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Note</Label>
            <Textarea
              value={noteText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                onNoteTextChange(e.target.value)
              }
              placeholder="Enter note..."
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSavingNote}
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSavingNote}>
            {isSavingNote ? "Saving..." : "Save Note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
