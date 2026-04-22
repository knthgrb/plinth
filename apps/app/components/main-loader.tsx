"use client";

import { useLayoutEffect } from "react";
import { useLoaderOverlay } from "@/hooks/loader-overlay-context";

const LOADER_TAIL_MS = 700;

/**
 * When mounted, shows the main Lottie loader overlay.
 * When unmounted, keeps the overlay visible for a short tail so the Lottie animation can finish.
 */
export function MainLoader() {
  const { register, unregisterAfter } = useLoaderOverlay();

  useLayoutEffect(() => {
    register();
    return () => {
      unregisterAfter(LOADER_TAIL_MS);
    };
  }, [register, unregisterAfter]);

  return null;
}
