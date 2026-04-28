"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export function normalizePayslipIdParam(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const t = String(raw).replace(/\s+/g, "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Reliable ?payslipId= for deep links (e.g. chat "View Payslip"). Next's useSearchParams()
 * can be empty on the first client pass; we always merge with window.location on the client.
 */
export function usePayslipIdFromUrl(): string | null {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const fromHook = useMemo(
    () => normalizePayslipIdParam(searchParams.get("payslipId")),
    [searchParams],
  );
  const [fromWindow, setFromWindow] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setFromWindow(
      normalizePayslipIdParam(
        new URLSearchParams(window.location.search).get("payslipId"),
      ),
    );
  }, [fromHook, pathname, searchParams]);

  return fromHook ?? fromWindow;
}
