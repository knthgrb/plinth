import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const getAuthedConvexClient = vi.fn(async () => ({ query }));

vi.mock("@/lib/convex-client", () => ({ getAuthedConvexClient }));

describe("UserService auth routing", () => {
  beforeEach(() => {
    query.mockReset();
    getAuthedConvexClient.mockClear();
  });

  it("resolves the preferred organization and role with one request-scoped query", async () => {
    query.mockResolvedValue([
      {
        _id: "jh76w5v42x9jz33v8k2m9d4p",
        role: "owner",
        accessStatus: "active",
      },
    ]);
    const requestHeaders = new Headers({
      cookie: "better-auth.session_token=session-token",
      host: "plinth.example",
    });
    const { UserService } = await import("../services/user-service");

    const result = await UserService.getUserRoleAndOrg(
      undefined,
      requestHeaders,
    );

    expect(result).toEqual({
      role: "owner",
      organizationId: "jh76w5v42x9jz33v8k2m9d4p",
      accessStatus: "active",
    });
    expect(getAuthedConvexClient).toHaveBeenCalledWith(requestHeaders);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns no membership without launching fallback queries", async () => {
    query.mockResolvedValue(null);
    const requestHeaders = new Headers({
      cookie: "better-auth.session_token=session-token",
    });
    const { UserService } = await import("../services/user-service");

    const result = await UserService.getUserRoleAndOrg(
      "jh76w5v42x9jz33v8k2m9d4p",
      requestHeaders,
    );

    expect(result).toEqual({
      role: null,
      organizationId: "jh76w5v42x9jz33v8k2m9d4p",
      accessStatus: null,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("prefers active membership over a last-active alumni membership at root", async () => {
    query.mockResolvedValue([
      {
        _id: "alumni0000000000000000001",
        role: "employee",
        accessStatus: "alumni",
      },
      {
        _id: "active0000000000000000001",
        role: "owner",
        accessStatus: "active",
      },
    ]);
    const requestHeaders = new Headers({
      cookie: "better-auth.session_token=session-token",
    });
    const { UserService } = await import("../services/user-service");

    await expect(
      UserService.getUserRoleAndOrg(undefined, requestHeaders),
    ).resolves.toEqual({
      role: "owner",
      organizationId: "active0000000000000000001",
      accessStatus: "active",
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
