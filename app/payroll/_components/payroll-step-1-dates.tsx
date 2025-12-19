"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PayrollStep1DatesProps {
  cutoffStart: string;
  cutoffEnd: string;
  onCutoffStartChange: (value: string) => void;
  onCutoffEndChange: (value: string) => void;
}

export function PayrollStep1Dates({
  cutoffStart,
  cutoffEnd,
  onCutoffStartChange,
  onCutoffEndChange,
}: PayrollStep1DatesProps) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cutoffStart">Cutoff Start *</Label>
          <Input
            id="cutoffStart"
            type="date"
            value={cutoffStart}
            onChange={(e) => onCutoffStartChange(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cutoffEnd">Cutoff End *</Label>
          <Input
            id="cutoffEnd"
            type="date"
            value={cutoffEnd}
            onChange={(e) => onCutoffEndChange(e.target.value)}
            required
          />
        </div>
      </div>
      <p className="text-sm text-gray-500">
        Note: Night differential percentage can be customized per employee in
        the summary view after creating the payroll run.
      </p>
    </div>
  );
}
