"use client";

import { usePathname, useSearchParams } from "next/navigation";
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
  const pathname = usePathname();
  return useMemo(() => {
    const fromParams = normalizePayslipIdParam(
      searchParams.get("payslipId"),
    );
    if (fromParams) return fromParams;
    if (typeof window === "undefined") return null;
    // Avoid stale `?payslipId=` from window during / after client navigation: only
    // trust the query string when it belongs to the current location pathname.
    const w = new URL(window.location.href);
    if (w.pathname !== pathname) return null;
    return normalizePayslipIdParam(w.searchParams.get("payslipId"));
  }, [searchParams, pathname]);
}
