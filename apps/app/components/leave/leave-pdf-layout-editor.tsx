"use client";

import { useCallback, useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LEAVE_PDF_IMAGE_DATA_URL_MAX_CHARS,
  type LeavePdfBand,
  type LeavePdfBandAlign,
  type LeavePdfBandKind,
  type LeavePdfLayout,
} from "@/lib/leave-pdf-layout";
import { useToast } from "@/components/ui/use-toast";

const ALIGN_OPTIONS: { value: LeavePdfBandAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justified" },
];

const KIND_OPTIONS: { value: LeavePdfBandKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
];

function BandEditor({
  title,
  band,
  onChange,
}: {
  title: string;
  band: LeavePdfBand;
  onChange: (next: LeavePdfBand) => void;
}) {
  const { toast } = useToast();
  const bandRef = useRef(band);
  useEffect(() => {
    bandRef.current = band;
  }, [band]);

  const readImageFile = useCallback(
    (file: File | null) => {
      if (!file || !file.type.startsWith("image/")) {
        onChange({ ...bandRef.current, imageDataUrl: "" });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        if (dataUrl.length > LEAVE_PDF_IMAGE_DATA_URL_MAX_CHARS) {
          toast({
            title: "Image too large",
            description: "Use a smaller image (e.g. under ~300KB) for the PDF header or footer.",
            variant: "destructive",
          });
          return;
        }
        const b = bandRef.current;
        onChange({
          ...b,
          kind: "image",
          imageDataUrl: dataUrl,
          enabled: true,
        });
      };
      reader.readAsDataURL(file);
    },
    [onChange, toast],
  );

  return (
    <div className="space-y-4 rounded-lg border border-[rgb(230,230,230)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[rgb(64,64,64)]">{title}</p>
        <label className="flex items-center gap-2 text-sm text-[rgb(64,64,64)]">
          <input
            type="checkbox"
            checked={band.enabled}
            onChange={(e) => onChange({ ...band, enabled: e.target.checked })}
          />
          Include on PDF
        </label>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Content type</Label>
        <Select
          value={band.kind}
          disabled={!band.enabled}
          onValueChange={(v) =>
            onChange({
              ...band,
              kind: v as LeavePdfBandKind,
            })
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Content type" />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Alignment</Label>
        <Select
          value={band.align}
          disabled={!band.enabled || band.kind === "none"}
          onValueChange={(v) =>
            onChange({
              ...band,
              align: v as LeavePdfBandAlign,
            })
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Alignment" />
          </SelectTrigger>
          <SelectContent>
            {ALIGN_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {band.enabled && band.kind === "text" ? (
        <div className="space-y-2">
          <Label className="text-xs">Text</Label>
          <Textarea
            rows={4}
            value={band.text ?? ""}
            onChange={(e) => onChange({ ...band, text: e.target.value })}
            placeholder="Company name, address, or other header/footer text"
          />
        </div>
      ) : null}

      {band.enabled && band.kind === "image" ? (
        <div className="space-y-2">
          <Label className="text-xs">Image</Label>
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => readImageFile(e.target.files?.[0] ?? null)}
          />
          {band.imageDataUrl ? (
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={band.imageDataUrl}
                alt="Preview"
                className="max-h-24 w-auto max-w-full rounded border object-contain"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange({ ...band, imageDataUrl: "" })}
              >
                Remove image
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Logo or banner; keep file small for reliable saving.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function LeavePdfLayoutEditor({
  value,
  onChange,
}: {
  value: LeavePdfLayout;
  onChange: (next: LeavePdfLayout) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[rgb(64,64,64)]">
          PDF header &amp; footer
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Shown in the live preview and on exported leave request PDFs (download
          and save to documents) after a request is no longer pending.
        </p>
      </div>
      <BandEditor
        title="Header"
        band={value.header}
        onChange={(header) => onChange({ ...value, header })}
      />
      <BandEditor
        title="Footer"
        band={value.footer}
        onChange={(footer) => onChange({ ...value, footer })}
      />
    </div>
  );
}
