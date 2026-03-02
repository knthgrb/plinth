"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";

interface AdvancedColorPickerProps {
  color: string;
  onColorChange: (color: string) => void;
  presetColors: string[];
  onBack?: () => void;
}

// Convert hex to HSV
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

// Convert HSV to hex
function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x;
  }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function AdvancedColorPicker({
  color,
  onColorChange,
  presetColors,
  onBack,
}: AdvancedColorPickerProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexValue, setHexValue] = useState(color.replace("#", ""));
  const spectrumRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDraggingSpectrum, setIsDraggingSpectrum] = useState(false);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  // Update HSV when color prop changes
  useEffect(() => {
    const newHsv = hexToHsv(color);
    setHsv(newHsv);
    setHexValue(color.replace("#", ""));
  }, [color]);

  const updateColor = useCallback((newHsv: { h: number; s: number; v: number }) => {
    setHsv(newHsv);
    const newHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    onColorChange(newHex);
    setHexValue(newHex.replace("#", ""));
  }, [onColorChange]);

  const handleSpectrumClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!spectrumRef.current) return;
    const rect = spectrumRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    
    updateColor({
      h: hsv.h,
      s: x,
      v: 1 - y,
    });
  }, [hsv.h, updateColor]);

  const handleSpectrumMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingSpectrum(true);
    handleSpectrumClick(e);
  }, [handleSpectrumClick]);

  useEffect(() => {
    if (!isDraggingSpectrum) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!spectrumRef.current) return;
      const rect = spectrumRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      
      updateColor({
        h: hsv.h,
        s: x,
        v: 1 - y,
      });
    };

    const handleMouseUp = () => {
      setIsDraggingSpectrum(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingSpectrum, hsv.h, updateColor]);

  const handleSliderClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newH = Math.round(x * 360);
    
    updateColor({
      h: newH,
      s: hsv.s,
      v: hsv.v,
    });
  }, [hsv.s, hsv.v, updateColor]);

  const handleSliderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingSlider(true);
    handleSliderClick(e);
  }, [handleSliderClick]);

  useEffect(() => {
    if (!isDraggingSlider) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newH = Math.round(x * 360);
      
      updateColor({
        h: newH,
        s: hsv.s,
        v: hsv.v,
      });
    };

    const handleMouseUp = () => {
      setIsDraggingSlider(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingSlider, hsv.s, hsv.v, updateColor]);

  const handleHexChange = (value: string) => {
    const cleanValue = value.replace("#", "").toUpperCase();
    if (/^[0-9A-F]{0,6}$/.test(cleanValue)) {
      setHexValue(cleanValue);
      if (cleanValue.length === 6) {
        const newColor = `#${cleanValue}`;
        onColorChange(newColor);
        setHsv(hexToHsv(newColor));
      }
    }
  };

  // Generate spectrum gradient
  const spectrumStyle = {
    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
  };

  // Generate hue slider gradient (horizontal)
  const sliderGradient = `linear-gradient(to right, 
    #ff0000 0%,
    #ffff00 16.66%,
    #00ff00 33.33%,
    #00ffff 50%,
    #0000ff 66.66%,
    #ff00ff 83.33%,
    #ff0000 100%
  )`;

  return (
    <div className="space-y-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          <span>←</span> Back
        </button>
      )}
      
      {/* Color Spectrum */}
      <div
        ref={spectrumRef}
        className="relative w-full h-[150px] rounded border border-gray-300 cursor-crosshair"
        style={spectrumStyle}
        onMouseDown={handleSpectrumMouseDown}
      >
        {/* Selection indicator */}
        <div
          className="absolute w-3 h-3 border-2 border-white rounded-full shadow-lg pointer-events-none"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>

      {/* Horizontal Hue Slider */}
      <div
        ref={sliderRef}
        className="relative w-full h-6 rounded border border-gray-300 cursor-pointer"
        style={{ background: sliderGradient }}
        onMouseDown={handleSliderMouseDown}
      >
        {/* Slider indicator */}
        <div
          className="absolute top-0 bottom-0 w-2 h-full bg-white border border-gray-400 rounded pointer-events-none"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            transform: "translateX(-50%)",
          }}
        />
      </div>

      {/* Selected Color Preview and Hex Input */}
      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 rounded border border-gray-300 shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1">
          <Input
            value={hexValue}
            onChange={(e) => handleHexChange(e.target.value)}
            placeholder="FF5865"
            className="font-mono text-sm h-8"
            maxLength={6}
          />
        </div>
      </div>

      {/* Preset Colors */}
      <div className="flex items-center gap-1 flex-wrap">
        {presetColors.map((presetColor) => (
          <button
            key={presetColor}
            type="button"
            onClick={() => {
              onColorChange(presetColor);
              setHsv(hexToHsv(presetColor));
              setHexValue(presetColor.replace("#", ""));
            }}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-all",
              color === presetColor
                ? "border-gray-800 scale-110"
                : "border-gray-300 hover:border-gray-400"
            )}
            style={{ backgroundColor: presetColor }}
          />
        ))}
      </div>
    </div>
  );
}
