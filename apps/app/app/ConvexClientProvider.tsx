"use client";

import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import {
  ConvexErrorBoundary,
  GlobalErrorHandler,
} from "@/components/error-boundary";
import { MainLoader } from "@/components/main-loader";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
  // expectAuth: false allows invite/accept and login/signup to run queries when unauthenticated
  expectAuth: false,
});

/**
 * After refresh, Better Auth can report a session before Convex has attached the JWT.
 * Org-scoped queries then fail with "Not authenticated", error boundaries treated it as logout,
 * and users were sent to login or saw "Something went wrong". Wait for Convex auth first
 * when the browser has a session; unauthenticated routes mount immediately.
 */
function ConvexSessionReadyGate({ children }: { children: ReactNode }) {
  const { isLoading: convexAuthLoading, isAuthenticated } = useConvexAuth();
  const [sessionResolved, setSessionResolved] = useState(false);
  const [hasBrowserSession, setHasBrowserSession] = useState(false);
  const sessionInvalidRedirectStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void authClient.getSession().then((res) => {
      if (cancelled) return;
      setHasBrowserSession(!!res?.data?.session);
      setSessionResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionResolved || !hasBrowserSession || convexAuthLoading) return;
    if (isAuthenticated) {
      sessionInvalidRedirectStarted.current = false;
      return;
    }
    if (sessionInvalidRedirectStarted.current) return;
    sessionInvalidRedirectStarted.current = true;
    void authClient.signOut({ fetchOptions: { throw: false } }).finally(() => {
      window.location.replace("/login");
    });
  }, [
    sessionResolved,
    hasBrowserSession,
    convexAuthLoading,
    isAuthenticated,
  ]);

  if (!sessionResolved) {
    return <MainLoader />;
  }

  if (!hasBrowserSession) {
    return <>{children}</>;
  }

  if (convexAuthLoading) {
    return <MainLoader />;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <p className="text-center text-sm text-gray-500">
          Redirecting to sign in…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <GlobalErrorHandler>
      <ConvexErrorBoundary>
        <ConvexBetterAuthProvider client={convex} authClient={authClient}>
          <ConvexSessionReadyGate>{children}</ConvexSessionReadyGate>
        </ConvexBetterAuthProvider>
      </ConvexErrorBoundary>
    </GlobalErrorHandler>
  );
}
