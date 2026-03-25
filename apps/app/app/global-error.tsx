"use client";

import { useEffect } from "react";
import { GlobalErrorFallback } from "@/components/global-error-fallback";

export default function GlobalError({
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
    <html lang="en">
      <body className="antialiased font-sans bg-white">
        <GlobalErrorFallback reset={reset} />
      </body>
    </html>
  );
}
