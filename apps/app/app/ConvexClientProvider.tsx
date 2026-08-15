"use client";

import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ReactNode, useEffect, useRef } from "react";
import {
  authClient,
  resolveAuthGateState,
  resolveAuthGateView,
} from "@/lib/auth-client";
import {
  type AuthClient,
  ConvexBetterAuthProvider,
} from "@convex-dev/better-auth/react";
import {
  ConvexErrorBoundary,
  GlobalErrorHandler,
} from "@/components/error-boundary";
import { LoaderOverlayProvider } from "@/hooks/loader-overlay-context";
import { MainLoader } from "@/components/main-loader";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
  // expectAuth: false allows invite/accept and login/signup to run queries when unauthenticated
  expectAuth: false,
});

// @convex-dev/better-auth 0.12.5 infers `useSession().data` as `never`
// against Better Auth 1.6, although this client uses its required Convex plugin.
const convexAuthClient = authClient as unknown as AuthClient;

/**
 * After refresh, Better Auth can report a session before Convex has attached the JWT.
 * Org-scoped queries then fail with "Not authenticated", error boundaries treated it as logout,
 * and users were sent to login or saw "Something went wrong". Wait for Convex auth first
 * when the browser has a session; unauthenticated routes mount immediately.
 */
function ConvexSessionReadyGate({ children }: { children: ReactNode }) {
  const { isLoading: convexAuthLoading, isAuthenticated } = useConvexAuth();
  const { data: browserSession, isPending: isSessionPending } =
    authClient.useSession();
  const sessionInvalidRedirectStarted = useRef(false);
  const gateState = resolveAuthGateState({
    isSessionPending,
    hasSession: Boolean(browserSession?.session),
    isConvexAuthLoading: convexAuthLoading,
    isConvexAuthenticated: isAuthenticated,
  });
  const gateView = resolveAuthGateView(gateState);

  useEffect(() => {
    if (gateState !== "invalid") {
      sessionInvalidRedirectStarted.current = false;
      return;
    }
    if (sessionInvalidRedirectStarted.current) return;
    sessionInvalidRedirectStarted.current = true;
    void authClient.signOut({ fetchOptions: { throw: false } }).finally(() => {
      window.location.replace("/login");
    });
  }, [gateState]);

  if (gateView === "loader") {
    return <MainLoader />;
  }

  return <>{children}</>;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <GlobalErrorHandler>
      <ConvexErrorBoundary>
        <ConvexBetterAuthProvider client={convex} authClient={convexAuthClient}>
          <LoaderOverlayProvider>
            <ConvexSessionReadyGate>{children}</ConvexSessionReadyGate>
          </LoaderOverlayProvider>
        </ConvexBetterAuthProvider>
      </ConvexErrorBoundary>
    </GlobalErrorHandler>
  );
}
