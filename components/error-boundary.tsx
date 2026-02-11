"use client";

import React, { Component, ErrorInfo, ReactNode, useEffect } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ConvexErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errorMessage = error.message || String(error);

    // Unauthenticated during logout: redirect to login immediately so we never show an error flash
    if (
      (errorMessage.includes("Not authenticated") ||
        errorMessage.includes("Unauthenticated")) &&
      typeof window !== "undefined"
    ) {
      const pathname = window.location.pathname;
      if (pathname !== "/login" && pathname !== "/signup") {
        window.location.href = "/login";
        return;
      }
    }

    console.error("Convex query error:", error, errorInfo);

    // Check for authorization-related errors
    // But don't redirect if we're already on forbidden page (prevents loops)
    if (
      (errorMessage.includes("Not authorized") ||
        errorMessage.includes("User is not a member of this organization") ||
        errorMessage.includes("User record not found")) &&
      typeof window !== "undefined"
    ) {
      const pathname = window.location.pathname;
      // Don't redirect if already on forbidden page
      if (!pathname.includes("/forbidden")) {
        window.location.href = "/forbidden";
      }
    }
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || "";

      // Unauthenticated (e.g. logout): show minimal UI, redirect already triggered in componentDidCatch
      if (
        (errorMessage.includes("Not authenticated") ||
          errorMessage.includes("Unauthenticated")) &&
        typeof window !== "undefined"
      ) {
        return (
          <div className="flex h-screen items-center justify-center bg-white">
            <div className="text-gray-500">Signing out...</div>
          </div>
        );
      }

      // If it's an authorization error, redirect (handled in componentDidCatch)
      if (
        errorMessage.includes("Not authorized") ||
        errorMessage.includes("User is not a member of this organization") ||
        errorMessage.includes("User record not found")
      ) {
        return (
          <div className="flex h-screen items-center justify-center">
            <div className="text-gray-500">Redirecting...</div>
          </div>
        );
      }

      // For other errors, show error message
      return (
        <div className="flex h-screen items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-bold text-red-600 mb-2">
              Something went wrong
            </h2>
            <p className="text-gray-600">{errorMessage}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Global error handler component for async errors
export function GlobalErrorHandler({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Handle unhandled promise rejections (from Convex queries)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      const errorMessage = error?.message || String(error);

      // Unauthenticated during logout: redirect to login, no error flash
      if (
        (errorMessage.includes("Not authenticated") ||
          errorMessage.includes("Unauthenticated")) &&
        typeof window !== "undefined"
      ) {
        const pathname = window.location.pathname;
        if (pathname !== "/login" && pathname !== "/signup") {
          event.preventDefault();
          window.location.href = "/login";
        }
        return;
      }

      if (
        (errorMessage.includes("Not authorized") ||
          errorMessage.includes("User is not a member of this organization") ||
          errorMessage.includes("User record not found")) &&
        typeof window !== "undefined"
      ) {
        const pathname = window.location.pathname;
        // Don't redirect if already on forbidden page
        if (!pathname.includes("/forbidden")) {
          event.preventDefault();
          const orgIdMatch = pathname.match(/^\/([^/]+)/);
          const orgId = orgIdMatch && !["login", "signup", "api", "_next"].includes(orgIdMatch[1]) 
            ? orgIdMatch[1] 
            : null;
          const forbiddenPath = orgId ? `/${orgId}/forbidden` : "/forbidden";
          window.location.href = forbiddenPath;
        }
      }
    };

    // Handle general errors
    const handleError = (event: ErrorEvent) => {
      const errorMessage = event.message || String(event.error);

      // Unauthenticated during logout: redirect to login, no error flash
      if (
        (errorMessage.includes("Not authenticated") ||
          errorMessage.includes("Unauthenticated")) &&
        typeof window !== "undefined"
      ) {
        const pathname = window.location.pathname;
        if (pathname !== "/login" && pathname !== "/signup") {
          event.preventDefault();
          window.location.href = "/login";
        }
        return;
      }

      if (
        (errorMessage.includes("Not authorized") ||
          errorMessage.includes("User is not a member of this organization") ||
          errorMessage.includes("User record not found")) &&
        typeof window !== "undefined"
      ) {
        const pathname = window.location.pathname;
        // Don't redirect if already on forbidden page
        if (!pathname.includes("/forbidden")) {
          event.preventDefault();
          const orgIdMatch = pathname.match(/^\/([^/]+)/);
          const orgId = orgIdMatch && !["login", "signup", "api", "_next"].includes(orgIdMatch[1]) 
            ? orgIdMatch[1] 
            : null;
          const forbiddenPath = orgId ? `/${orgId}/forbidden` : "/forbidden";
          window.location.href = forbiddenPath;
        }
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection
      );
      window.removeEventListener("error", handleError);
    };
  }, []);

  return <>{children}</>;
}
