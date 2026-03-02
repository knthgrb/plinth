"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/utils/utils";

interface ColorPickerProps {
  color: string;
  onColorChange: (color: string) => void;
  onBack: () => void;
  onSave: () => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  "#9CA3AF", // gray
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#3B82F6", // blue
  "#A855F7", // purple
  "#EC4899", // pink
];

export function ColorPicker({
  color,
  onColorChange,
  onBack,
  onSave,
  onCancel,
}: ColorPickerProps) {
  const [hexValue, setHexValue] = useState(color);

  const handleHexChange = (value: string) => {
    // Remove # if present
    const cleanValue = value.replace("#", "");
    // Only allow valid hex characters
    if (/^[0-9A-Fa-f]{0,6}$/.test(cleanValue)) {
      setHexValue(cleanValue);
      if (cleanValue.length === 6) {
        onColorChange(`#${cleanValue}`);
      }
    }
  };

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        className="flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      <div className="space-y-2">
        <Label>HEX #</Label>
        <div className="flex items-center gap-2">
          <div
            className="h-10 w-10 rounded-md border border-gray-300 shrink-0"
            style={{ backgroundColor: color }}
          />
          <Input
            value={hexValue}
            onChange={(e) => handleHexChange(e.target.value)}
            placeholder="FF5865"
            className="font-mono"
            maxLength={6}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Preset Colors</Label>
        <div className="flex items-center gap-2 flex-wrap">
          {PRESET_COLORS.map((presetColor) => (
            <button
              key={presetColor}
              type="button"
              onClick={() => {
                onColorChange(presetColor);
                setHexValue(presetColor.replace("#", ""));
              }}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition-all",
                color === presetColor
                  ? "border-gray-900 scale-110"
                  : "border-gray-300 hover:border-gray-400"
              )}
              style={{ backgroundColor: presetColor }}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="button" onClick={onSave} className="flex-1">
          Save
        </Button>
      </div>
    </div>
  );
}
