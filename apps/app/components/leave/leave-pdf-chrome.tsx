"use client";

import type { LeavePdfBand, LeavePdfLayout } from "@/lib/leave-pdf-layout";
import { alignToTailwindClass, normalizeLeavePdfLayout } from "@/lib/leave-pdf-layout";

function LeavePdfBandView({
  band,
  className,
}: {
  band: LeavePdfBand;
  className?: string;
}) {
  if (!band.enabled || band.kind === "none") return null;

  const alignClass = alignToTailwindClass(band.align);

  if (band.kind === "text" && band.text?.trim()) {
    return (
      <div
        className={`px-2 py-3 text-sm text-black ${alignClass} ${className ?? ""}`}
      >
        {band.text.split("\n").map((line, i) => (
          <p key={i} className={i > 0 ? "mt-1" : ""}>
            {line}
          </p>
        ))}
      </div>
    );
  }

  if (band.kind === "image" && band.imageDataUrl?.trim()) {
    const flexJustify =
      band.align === "left"
        ? "justify-start"
        : band.align === "right"
          ? "justify-end"
          : "justify-center";
    return (
      <div className={`flex px-2 py-3 ${flexJustify} ${className ?? ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={band.imageDataUrl}
          alt=""
          className="max-h-28 w-auto max-w-full object-contain"
        />
      </div>
    );
  }

  return null;
}

export function LeavePdfChrome({
  layout,
  children,
}: {
  layout: LeavePdfLayout | null | undefined;
  children: React.ReactNode;
}) {
  const normalized = normalizeLeavePdfLayout(layout);
  const showHeader =
    normalized.header.enabled &&
    (normalized.header.kind === "text"
      ? Boolean(normalized.header.text?.trim())
      : normalized.header.kind === "image"
        ? Boolean(normalized.header.imageDataUrl?.trim())
        : false);
  const showFooter =
    normalized.footer.enabled &&
    (normalized.footer.kind === "text"
      ? Boolean(normalized.footer.text?.trim())
      : normalized.footer.kind === "image"
        ? Boolean(normalized.footer.imageDataUrl?.trim())
        : false);

  return (
    <div className="flex min-h-0 flex-col bg-white text-black">
      {showHeader ? (
        <div className="border-b border-[rgb(230,230,230)]">
          <LeavePdfBandView band={normalized.header} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
      {showFooter ? (
        <div className="mt-auto border-t border-[rgb(230,230,230)]">
          <LeavePdfBandView band={normalized.footer} />
        </div>
      ) : null}
    </div>
  );
}
