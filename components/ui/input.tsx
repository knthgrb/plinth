import * as React from "react";

import { cn } from "@/utils/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-[#DDDDDD] bg-[rgb(250,250,250)] px-3 py-1 text-sm text-[rgb(64,64,64)] placeholder:text-[rgb(133,133,133)] shadow-sm transition-colors hover:border-[rgb(120,120,120)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#695eff] focus-visible:border-[#695eff] disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[rgb(64,64,64)]",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
