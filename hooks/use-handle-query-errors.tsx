"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Hook to handle Convex query errors and redirect to forbidden page
 * when authorization errors occur
 */
export function useHandleQueryErrors(
  error: any,
  redirectOnError: boolean = true
) {
  const router = useRouter();

  useEffect(() => {
    if (error && redirectOnError) {
      const errorMessage = error.message || String(error);

      // Check for authorization-related errors
      if (
        errorMessage.includes("Not authorized") ||
        errorMessage.includes("User is not a member of this organization") ||
        errorMessage.includes("User record not found") ||
        errorMessage.includes("Not authenticated")
      ) {
        router.push("/forbidden");
      }
    }
  }, [error, redirectOnError, router]);
}

