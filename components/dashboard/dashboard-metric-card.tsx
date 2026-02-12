"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { cn } from "@/utils/utils";

type DashboardMetricCardProps = {
  title: string;
  value: React.ReactNode;
  /** Secondary line e.g. "₱0.00 previous period" or "Updated 25 seconds ago" */
  secondary?: React.ReactNode;
  /** Optional small chart placeholder or extra content below value */
  chartOrExtra?: React.ReactNode;
  exploreHref?: string;
  exploreLabel?: string;
  moreDetailsHref?: string;
  moreDetailsLabel?: string;
  className?: string;
  asLink?: string;
};

export function DashboardMetricCard({
  title,
  value,
  secondary,
  chartOrExtra,
  exploreHref,
  exploreLabel = "Explore",
  moreDetailsHref,
  moreDetailsLabel = "More details",
  className,
  asLink,
}: DashboardMetricCardProps) {
  const content = (
    <>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <span className="text-sm font-medium text-[rgb(133,133,133)]">
          {title}
        </span>
        {exploreHref && !asLink && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs font-medium text-brand-purple hover:bg-purple-50 hover:text-brand-purple"
            asChild
          >
            <Link href={exploreHref}>{exploreLabel}</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-semibold tracking-tight text-[rgb(64,64,64)]">
          {value}
        </div>
        {secondary && (
          <p className="mt-1 text-xs text-[rgb(133,133,133)]">{secondary}</p>
        )}
        {chartOrExtra && (
          <div className="mt-3 min-h-[48px] rounded border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] p-2">
            {chartOrExtra}
          </div>
        )}
        {moreDetailsHref && !asLink && (
          <Link
            href={moreDetailsHref}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-purple hover:text-brand-purple-hover"
          >
            {moreDetailsLabel}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </>
  );

  if (asLink) {
    return (
      <Link href={asLink} className="block">
        <Card
          className={cn(
            "h-full transition-shadow hover:shadow-md border-[rgb(230,230,230)] bg-white",
            className
          )}
        >
          {content}
        </Card>
      </Link>
    );
  }

  return (
    <Card
      className={cn(
        "h-full border-[rgb(230,230,230)] bg-white",
        className
      )}
    >
      {content}
    </Card>
  );
}
