"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

const DEFAULT_TAIL_MS = 700;

type LoaderOverlayContextType = {
  register: () => void;
  /** Call when loader would unmount; keeps overlay visible for tailMs so Lottie can finish */
  unregisterAfter: (tailMs?: number) => void;
};

const LoaderOverlayContext = createContext<
  LoaderOverlayContextType | undefined
>(undefined);

function LoaderOverlayUI() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/90 backdrop-blur-sm">
      <div className="h-[120px] w-[120px] sm:h-[160px] sm:w-[160px]">
        <DotLottieReact
          src="/loader.lottie"
          loop
          autoplay
          className="h-full w-full"
        />
      </div>
    </div>
  );
}

export function LoaderOverlayProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const countRef = useRef(0);
  const tailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback(() => {
    countRef.current += 1;
    if (tailTimeoutRef.current) {
      clearTimeout(tailTimeoutRef.current);
      tailTimeoutRef.current = null;
    }
    setVisible(true);
  }, []);

  const unregisterAfter = useCallback((tailMs = DEFAULT_TAIL_MS) => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current > 0) return;
    if (tailTimeoutRef.current) clearTimeout(tailTimeoutRef.current);
    tailTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      tailTimeoutRef.current = null;
    }, tailMs);
  }, []);

  return (
    <LoaderOverlayContext.Provider value={{ register, unregisterAfter }}>
      {children}
      {visible && <LoaderOverlayUI />}
    </LoaderOverlayContext.Provider>
  );
}

export function useLoaderOverlay() {
  const context = useContext(LoaderOverlayContext);
  if (context === undefined) {
    throw new Error(
      "useLoaderOverlay must be used within a LoaderOverlayProvider"
    );
  }
  return context;
}
