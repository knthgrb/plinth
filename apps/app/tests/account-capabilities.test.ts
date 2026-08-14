import { describe, expect, it } from "vitest";
import { getAccountCapabilities } from "@/utils/account-capabilities";

describe("account capabilities", () => {
  it("allows every authenticated account to create an organization", () => {
    expect(getAccountCapabilities({ isAuthenticated: true })).toEqual({
      canCreateOrganization: true,
    });
    expect(getAccountCapabilities({ isAuthenticated: false })).toEqual({
      canCreateOrganization: false,
    });
  });
});
