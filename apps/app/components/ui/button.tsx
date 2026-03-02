import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[#695eff] text-white shadow-sm hover:bg-[#5547e8] hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#695eff] focus-visible:ring-offset-2",
        destructive: "bg-red-500 text-white shadow-sm hover:bg-red-600",
        outline:
          "bg-white border border-[#DDDDDD] text-[#4A4A4A] shadow-sm hover:bg-gray-50 hover:border-gray-300 focus-visible:ring-gray-300",
        secondary:
          "bg-white border border-[#DDDDDD] text-[#4A4A4A] shadow-sm hover:bg-gray-50 hover:border-gray-300 focus-visible:ring-gray-300",
        ghost: "hover:bg-[rgb(245,245,245)] text-[rgb(64,64,64)]",
        link: "text-brand-purple underline-offset-4 hover:text-brand-purple-hover hover:underline",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-lg px-2.5 text-xs",
        lg: "h-9 rounded-lg px-6",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
