export type LeavePdfBandAlign = "left" | "center" | "right" | "justify";

export type LeavePdfBandKind = "none" | "text" | "image";

export type LeavePdfBand = {
  enabled: boolean;
  kind: LeavePdfBandKind;
  text?: string;
  imageDataUrl?: string;
  align: LeavePdfBandAlign;
};

export type LeavePdfLayout = {
  header: LeavePdfBand;
  footer: LeavePdfBand;
};

export const DEFAULT_LEAVE_PDF_BAND: LeavePdfBand = {
  enabled: false,
  kind: "none",
  text: "",
  imageDataUrl: "",
  align: "center",
};

export const DEFAULT_LEAVE_PDF_LAYOUT: LeavePdfLayout = {
  header: { ...DEFAULT_LEAVE_PDF_BAND },
  footer: { ...DEFAULT_LEAVE_PDF_BAND },
};

export function normalizeLeavePdfLayout(
  raw: Partial<LeavePdfLayout> | null | undefined,
): LeavePdfLayout {
  const mergeBand = (partial?: Partial<LeavePdfBand>): LeavePdfBand => ({
    ...DEFAULT_LEAVE_PDF_BAND,
    ...partial,
    kind: partial?.kind ?? DEFAULT_LEAVE_PDF_BAND.kind,
    align: partial?.align ?? DEFAULT_LEAVE_PDF_BAND.align,
  });
  return {
    header: mergeBand(raw?.header),
    footer: mergeBand(raw?.footer),
  };
}

export function alignToTailwindClass(align: LeavePdfBandAlign): string {
  switch (align) {
    case "left":
      return "text-left";
    case "right":
      return "text-right";
    case "justify":
      return "text-justify";
    default:
      return "text-center";
  }
}

/** Max serialized image length to stay under Convex doc limits (~512KB field budget). */
export const LEAVE_PDF_IMAGE_DATA_URL_MAX_CHARS = 400_000;
