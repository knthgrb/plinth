"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

export function normalizePayslipIdParam(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const t = String(raw).replace(/\s+/g, "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Reliable ?payslipId= for deep links (e.g. chat "View Payslip"). Next's useSearchParams()
 * can be empty on the first client pass; on the client we fall back to window.location.
 */
export function usePayslipIdFromUrl(): string | null {
  const searchParams = useSearchParams();
  return useMemo(() => {
    const fromParams = normalizePayslipIdParam(
      searchParams.get("payslipId"),
    );
    if (fromParams) return fromParams;
    if (typeof window === "undefined") return null;
    return normalizePayslipIdParam(
      new URLSearchParams(window.location.search).get("payslipId"),
    );
  }, [searchParams]);
}
