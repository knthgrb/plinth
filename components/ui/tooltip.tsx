"use client";

import * as React from "react";
import { cn } from "@/utils/utils";

export type TooltipPosition = "top" | "bottom" | "left" | "right";

type TooltipContextType = {
  delayDuration?: number;
};

const TooltipContext = React.createContext<TooltipContextType>({
  delayDuration: 200,
});

export const TooltipProvider = ({
  children,
  delayDuration = 200,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}) => {
  return (
    <TooltipContext.Provider value={{ delayDuration }}>
      {children}
    </TooltipContext.Provider>
  );
};

type TooltipProps = {
  children: React.ReactNode;
};

export const Tooltip = ({ children }: TooltipProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const { delayDuration } = React.useContext(TooltipContext);

  const childrenArray = React.Children.toArray(children);
  const trigger = childrenArray.find(
    (child) => React.isValidElement(child) && child.type === TooltipTrigger
  );
  const content = childrenArray.find(
    (child) => React.isValidElement(child) && child.type === TooltipContent
  );
  const position: TooltipPosition =
    React.isValidElement(content) && content.props
      ? ((content.props as { position?: TooltipPosition }).position ??
        (content.props as { side?: TooltipPosition }).side ??
        "right")
      : "right";

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setIsOpen(true), delayDuration);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsOpen(false);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const gap = 8;
  const contentStyle: React.CSSProperties =
    position === "bottom"
      ? {
          position: "absolute",
          top: `calc(100% + ${gap}px)`,
          left: "50%",
          transform: "translateX(-50%)",
        }
      : position === "top"
        ? {
            position: "absolute",
            bottom: `calc(100% + ${gap}px)`,
            left: "50%",
            transform: "translateX(-50%)",
          }
        : position === "left"
          ? {
              position: "absolute",
              right: `calc(100% + ${gap}px)`,
              top: "50%",
              transform: "translateY(-50%)",
            }
          : {
              position: "absolute",
              left: `calc(100% + ${gap}px)`,
              top: "50%",
              transform: "translateY(-50%)",
            };

  return (
    <div
      className="relative inline-flex flex-shrink-0"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {trigger}
      {isOpen && content && (
        <div className="z-50 pointer-events-none" style={contentStyle}>
          {content}
        </div>
      )}
    </div>
  );
};

type TooltipTriggerProps = {
  children: React.ReactNode;
  asChild?: boolean;
};

export const TooltipTrigger = ({ children, asChild }: TooltipTriggerProps) => {
  if (asChild && React.isValidElement(children)) {
    return children;
  }
  return <>{children}</>;
};

type TooltipContentProps = {
  children: React.ReactNode;
  /** Position of the tooltip relative to the trigger: "top" | "bottom" | "left" | "right" */
  position?: TooltipPosition;
  /** @deprecated Use `position` instead */
  side?: TooltipPosition;
  className?: string;
};

export const TooltipContent = ({
  children,
  position: positionProp = "right",
  side,
  className,
}: TooltipContentProps) => {
  return (
    <div
      className={cn(
        "rounded-md bg-[rgb(64,64,64)] px-3 py-1.5 text-xs text-white shadow-md whitespace-nowrap",
        className
      )}
    >
      {children}
    </div>
  );
};
