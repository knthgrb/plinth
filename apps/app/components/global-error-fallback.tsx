"use client";

import { Button } from "@/components/ui/button";

type GlobalErrorFallbackProps = {
  /** Next.js error boundary reset, or Convex boundary retry */
  reset?: () => void;
  title?: string;
  className?: string;
};

/**
 * Branded full-page error state — no raw stack traces or Convex payloads.
 */
export function GlobalErrorFallback({
  reset,
  title = "Something went wrong",
  className = "",
}: GlobalErrorFallbackProps) {
  return (
    <div
      className={`flex min-h-[50vh] w-full flex-col items-center justify-center gap-6 bg-white px-6 py-16 ${className}`}
    >
      <div className="h-1 w-14 rounded-full bg-[#695eff]" aria-hidden />
      <h1 className="text-center text-xl font-semibold tracking-tight text-[#695eff]">
        {title}
      </h1>
      <p className="max-w-md text-center text-sm leading-relaxed text-[rgb(115,115,115)]">
        Please try again. If this keeps happening, contact your administrator.
      </p>
      {reset ? (
        <Button
          type="button"
          onClick={reset}
          className="bg-[#695eff] hover:bg-[#5547e8] text-white"
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}
