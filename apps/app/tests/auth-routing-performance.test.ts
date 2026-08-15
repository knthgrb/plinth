import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRoleWithCache = vi.fn();
const setRoleCookieIfNeeded = vi.fn(async (response: Response) => response);

vi.mock("@/helpers/role-cache", () => ({
  getRoleWithCache,
  setRoleCookieIfNeeded,
}));

const APP_URL = "https://plinth.example";
const ORGANIZATION_ID = "jh76w5v42x9jz33v8k2m9d4p";

function authenticatedRequest(pathname: string): NextRequest {
  return new NextRequest(`${APP_URL}${pathname}`, {
    headers: {
      cookie: "better-auth.session_token=session-token",
    },
  });
}

describe("auth routing performance", () => {
  beforeEach(() => {
    getRoleWithCache.mockReset();
    setRoleCookieIfNeeded.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects root directly to the preferred organization dashboard", async () => {
    getRoleWithCache.mockResolvedValue({
      role: "owner",
      organizationId: ORGANIZATION_ID,
      accessStatus: "active",
      fromCache: false,
    });
    const { proxy } = await import("../proxy");

    const response = await proxy(authenticatedRequest("/"));

    expect(response.headers.get("location")).toBe(
      `${APP_URL}/${ORGANIZATION_ID}/dashboard`,
    );
    expect(getRoleWithCache).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes an organization index without rendering it first", async () => {
    getRoleWithCache.mockResolvedValue({
      role: "employee",
      organizationId: ORGANIZATION_ID,
      accessStatus: "active",
      fromCache: true,
    });
    const { proxy } = await import("../proxy");

    const response = await proxy(
      authenticatedRequest(`/${ORGANIZATION_ID}`),
    );

    expect(response.headers.get("location")).toBe(
      `${APP_URL}/${ORGANIZATION_ID}/announcements`,
    );
    expect(getRoleWithCache).toHaveBeenCalledTimes(1);
  });

  it("routes alumni directly to payslips", async () => {
    getRoleWithCache.mockResolvedValue({
      role: "employee",
      organizationId: ORGANIZATION_ID,
      accessStatus: "alumni",
      fromCache: false,
    });
    const { proxy } = await import("../proxy");

    const response = await proxy(authenticatedRequest("/"));

    expect(response.headers.get("location")).toBe(
      `${APP_URL}/${ORGANIZATION_ID}/payslips`,
    );
  });
});

describe("shared auth routing state", () => {
  it("keeps organization switch and logout transitions mutually exclusive", async () => {
    const organizationRouting = await import("../utils/organization-routing");
    const resolveOrganizationTransition = Reflect.get(
      organizationRouting,
      "resolveOrganizationTransition",
    );

    expect(resolveOrganizationTransition).toBeTypeOf("function");
    if (typeof resolveOrganizationTransition !== "function") return;

    expect(
      resolveOrganizationTransition({
        type: "switch",
        organizationId: ORGANIZATION_ID,
      }),
    ).toEqual({
      currentOrganizationId: ORGANIZATION_ID,
      switchingToOrganizationId: ORGANIZATION_ID,
      isLoggingOut: false,
      isInitialized: true,
    });
    expect(resolveOrganizationTransition({ type: "logout" })).toEqual({
      currentOrganizationId: null,
      switchingToOrganizationId: null,
      isLoggingOut: true,
      isInitialized: false,
    });
  });

  it("does not enter invalid-session redirect state after sign-out", async () => {
    const authClientModule = await import("../lib/auth-client");
    const resolveAuthGateState = Reflect.get(
      authClientModule,
      "resolveAuthGateState",
    );

    expect(resolveAuthGateState).toBeTypeOf("function");
    if (typeof resolveAuthGateState !== "function") return;

    expect(
      resolveAuthGateState({
        isSessionPending: false,
        hasSession: false,
        isConvexAuthLoading: false,
        isConvexAuthenticated: false,
      }),
    ).toBe("public");
  });

  it("uses a neutral loader while an invalid session is being cleared", async () => {
    const authClientModule = await import("../lib/auth-client");
    const resolveAuthGateView = Reflect.get(
      authClientModule,
      "resolveAuthGateView",
    );

    expect(resolveAuthGateView).toBeTypeOf("function");
    if (typeof resolveAuthGateView !== "function") return;

    expect(resolveAuthGateView("invalid")).toBe("loader");
    expect(resolveAuthGateView("loading")).toBe("loader");
    expect(resolveAuthGateView("public")).toBe("children");
    expect(resolveAuthGateView("ready")).toBe("children");
  });

  it("finishes session and cache cleanup before navigating to sign in", async () => {
    const authClientModule = await import("../lib/auth-client");
    const completeSignOutForNavigation = Reflect.get(
      authClientModule,
      "completeSignOutForNavigation",
    );

    expect(completeSignOutForNavigation).toBeTypeOf("function");
    if (typeof completeSignOutForNavigation !== "function") return;

    const events: string[] = [];
    let finishSignOut: (() => void) | undefined;
    let finishCacheClear: (() => void) | undefined;
    const signOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSignOut = () => {
            events.push("session-cleared");
            resolve();
          };
        }),
    );
    const clearRoleCache = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCacheClear = () => {
            events.push("role-cache-cleared");
            resolve();
          };
        }),
    );
    const navigateToLogin = vi.fn(() => events.push("navigated"));

    const completion = completeSignOutForNavigation({
      prepare: () => events.push("prepared"),
      signOut,
      clearRoleCache,
      navigateToLogin,
    });

    expect(events).toEqual(["prepared"]);
    finishSignOut?.();
    await Promise.resolve();
    expect(navigateToLogin).not.toHaveBeenCalled();
    finishCacheClear?.();
    await completion;

    expect(events).toEqual([
      "prepared",
      "session-cleared",
      "role-cache-cleared",
      "navigated",
    ]);
  });
});
