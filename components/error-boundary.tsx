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

    // Ignore unauthenticated errors during logout (user is on login page or being redirected)
    if (
      (errorMessage.includes("Not authenticated") ||
        errorMessage.includes("Unauthenticated")) &&
      typeof window !== "undefined"
    ) {
      const pathname = window.location.pathname;
      // If we're on login page or being redirected to login, ignore the error
      if (pathname === "/login" || pathname === "/signup") {
        console.log(
          "Ignoring unauthenticated error during logout:",
          errorMessage
        );
        return;
      }
    }

    console.error("Convex query error:", error, errorInfo);

    // Check for authorization-related errors
    if (
      errorMessage.includes("Not authorized") ||
      errorMessage.includes("User is not a member of this organization") ||
      errorMessage.includes("User record not found")
    ) {
      // Redirect to forbidden page
      if (typeof window !== "undefined") {
        window.location.href = "/forbidden";
      }
    }
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || "";

      // Ignore unauthenticated errors during logout
      if (
        (errorMessage.includes("Not authenticated") ||
          errorMessage.includes("Unauthenticated")) &&
        typeof window !== "undefined"
      ) {
        const pathname = window.location.pathname;
        if (pathname === "/login" || pathname === "/signup") {
          // Reset error state and continue rendering (user is logging out)
          this.setState({ hasError: false, error: null });
          return this.props.children;
        }
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

      // Ignore unauthenticated errors during logout
      if (
        (errorMessage.includes("Not authenticated") ||
          errorMessage.includes("Unauthenticated")) &&
        typeof window !== "undefined"
      ) {
        const pathname = window.location.pathname;
        if (pathname === "/login" || pathname === "/signup") {
          event.preventDefault();
          console.log(
            "Ignoring unauthenticated error during logout:",
            errorMessage
          );
          return;
        }
      }

      if (
        errorMessage.includes("Not authorized") ||
        errorMessage.includes("User is not a member of this organization") ||
        errorMessage.includes("User record not found")
      ) {
        event.preventDefault();
        window.location.href = "/forbidden";
      }
    };

    // Handle general errors
    const handleError = (event: ErrorEvent) => {
      const errorMessage = event.message || String(event.error);

      // Ignore unauthenticated errors during logout
      if (
        (errorMessage.includes("Not authenticated") ||
          errorMessage.includes("Unauthenticated")) &&
        typeof window !== "undefined"
      ) {
        const pathname = window.location.pathname;
        if (pathname === "/login" || pathname === "/signup") {
          event.preventDefault();
          console.log(
            "Ignoring unauthenticated error during logout:",
            errorMessage
          );
          return;
        }
      }

      if (
        errorMessage.includes("Not authorized") ||
        errorMessage.includes("User is not a member of this organization") ||
        errorMessage.includes("User record not found")
      ) {
        event.preventDefault();
        window.location.href = "/forbidden";
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
