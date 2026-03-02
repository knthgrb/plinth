import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-purple focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-brand-purple text-white shadow hover:bg-brand-purple-hover",
        secondary:
          "border-transparent bg-[rgb(245,245,245)] text-[rgb(64,64,64)] hover:bg-[rgb(235,235,235)]",
        destructive:
          "border-transparent bg-red-500 text-white shadow hover:bg-red-600",
        outline: "text-[rgb(64,64,64)] border-[rgb(107,107,107)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
