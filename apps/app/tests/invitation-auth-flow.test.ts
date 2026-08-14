import { describe, expect, it } from "vitest";
import {
  buildInvitationAuthPath,
  getInvitationAuthContext,
  getSafeInternalRedirect,
  isInvitationAuthFlow,
} from "../lib/invitation-auth";

describe("invitation authentication flow", () => {
  it("builds a sign-in link that returns to the same invitation", () => {
    expect(
      buildInvitationAuthPath("login", {
        email: "invitee+payroll@example.com",
        token: "token with symbols/&",
      }),
    ).toBe(
      "/login?email=invitee%2Bpayroll%40example.com&redirect=%2Finvite%2Faccept%3Ftoken%3Dtoken%2Bwith%2Bsymbols%252F%2526&invite=1",
    );
  });

  it("builds a sign-up link that returns to the same invitation", () => {
    expect(
      buildInvitationAuthPath("signup", {
        email: "new.user@example.com",
        token: "invitation-token",
      }),
    ).toBe(
      "/signup?email=new.user%40example.com&redirect=%2Finvite%2Faccept%3Ftoken%3Dinvitation-token&invite=1",
    );
  });

  it("recognizes invitation authentication only with an internal invitation redirect", () => {
    expect(
      isInvitationAuthFlow(
        new URLSearchParams({
          invite: "1",
          redirect: "/invite/accept?token=invitation-token",
        }),
      ),
    ).toBe(true);
    expect(
      isInvitationAuthFlow(
        new URLSearchParams({ invite: "1", redirect: "/dashboard" }),
      ),
    ).toBe(false);
    expect(
      isInvitationAuthFlow(
        new URLSearchParams({ invite: "1", redirect: "/invite/accept" }),
      ),
    ).toBe(false);
  });

  it("returns the locked invited email and return path for auth pages", () => {
    const searchParams = new URLSearchParams({
      email: " Invited.User@Example.com ",
      invite: "1",
      redirect: "/invite/accept?token=invitation-token",
    });

    expect(getInvitationAuthContext(searchParams)).toEqual({
      email: "invited.user@example.com",
      redirect: "/invite/accept?token=invitation-token",
    });
    expect(
      getInvitationAuthContext(
        new URLSearchParams({
          invite: "1",
          redirect: "/invite/accept?token=invitation-token",
        }),
      ),
    ).toBeNull();
  });

  it("rejects external and protocol-relative authentication redirects", () => {
    expect(
      getSafeInternalRedirect(
        new URLSearchParams({ redirect: "https://malicious.example" }),
      ),
    ).toBe("/");
    expect(
      getSafeInternalRedirect(
        new URLSearchParams({ redirect: "//malicious.example" }),
      ),
    ).toBe("/");
    expect(
      getSafeInternalRedirect(
        new URLSearchParams({ redirect: "/\\malicious.example" }),
      ),
    ).toBe("/");
    expect(
      getSafeInternalRedirect(
        new URLSearchParams({
          redirect: "/invite/accept?token=invitation-token",
        }),
      ),
    ).toBe("/invite/accept?token=invitation-token");
  });
});
