"use client";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, icon, variant, ...props }) {
        // Default to error icon for destructive variant, or use provided icon
        const displayIcon = icon !== undefined 
          ? icon 
          : variant === "destructive" 
            ? <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-white shrink-0">
                <span className="text-xs font-bold">!</span>
              </div>
            : null;

        return (
          <Toast key={id} variant={variant} {...props}>
            {displayIcon && (
              <div className="shrink-0">
                {displayIcon}
              </div>
            )}
            <div className="grid gap-1 flex-1 min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
