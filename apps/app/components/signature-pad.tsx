"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface SignaturePadProps {
  value?: string;
  onChange: (value: string) => void;
}

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  event: PointerEvent | React.PointerEvent<HTMLCanvasElement>,
) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

export function SignaturePad({ value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2;
    context.strokeStyle = "#111827";
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = value;
  }, [value]);

  const saveCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const point = getCanvasPoint(canvas, event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    setIsDrawing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const point = getCanvasPoint(canvas, event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    saveCanvas();
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border border-[rgb(230,230,230)] bg-white">
        <canvas
          ref={canvasRef}
          width={700}
          height={180}
          className="h-[180px] w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={handleClear}>
          Clear signature
        </Button>
      </div>
    </div>
  );
}
