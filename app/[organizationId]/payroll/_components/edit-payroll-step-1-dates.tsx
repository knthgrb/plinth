"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EditPayrollStep1DatesProps {
  cutoffStart: string;
  cutoffEnd: string;
  onCutoffStartChange: (value: string) => void;
  onCutoffEndChange: (value: string) => void;
}

export function EditPayrollStep1Dates({
  cutoffStart,
  cutoffEnd,
  onCutoffStartChange,
  onCutoffEndChange,
}: EditPayrollStep1DatesProps) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editCutoffStart">Cutoff Start <span className="text-red-500">*</span></Label>
          <Input
            id="editCutoffStart"
            type="date"
            value={cutoffStart}
            onChange={(e) => onCutoffStartChange(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editCutoffEnd">Cutoff End <span className="text-red-500">*</span></Label>
          <Input
            id="editCutoffEnd"
            type="date"
            value={cutoffEnd}
            onChange={(e) => onCutoffEndChange(e.target.value)}
            required
          />
        </div>
      </div>
    </div>
  );
}
