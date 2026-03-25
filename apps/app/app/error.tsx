"use client";

import { useEffect } from "react";
import { GlobalErrorFallback } from "@/components/global-error-fallback";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-white">
      <GlobalErrorFallback reset={reset} />
    </div>
  );
}
