"use client";

type PageSkeletonProps = {
  title: string;
  showAction?: boolean;
  rows?: number;
};

export function PageSkeleton({
  title,
  showAction = true,
  rows = 5,
}: PageSkeletonProps) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-md bg-[rgb(240,240,240)]" />
          <div className="h-4 w-64 rounded-md bg-[rgb(244,244,244)]" />
        </div>
        {showAction && <div className="h-9 w-32 rounded-md bg-[rgb(240,240,240)]" />}
      </div>

      <div className="mb-4 h-10 w-full max-w-xs rounded-md bg-[rgb(245,245,245)]" />

      <div className="overflow-hidden rounded-xl border border-[rgb(230,230,230)] bg-white">
        <div className="border-b border-[rgb(230,230,230)] px-4 py-3">
          <div className="h-4 w-48 rounded-md bg-[rgb(242,242,242)]" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={`${title}-skeleton-row-${index}`}
              className="h-10 w-full rounded-md bg-[rgb(247,247,247)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
