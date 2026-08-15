import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("no organization page", () => {
  it("shows archived organizations without treating them as active", () => {
    const source = readFileSync(
      new URL("../app/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("getArchivedUserOrganizations");
    expect(source).toContain("Archived organizations");
    expect(source).toContain("No active organizations");
  });

  it("uses the shared direct logout flow", () => {
    const source = readFileSync(
      new URL("../app/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Log out");
    expect(source).toContain("signOutAndRedirectToLogin");
    expect(source).not.toContain("await authClient.signOut()");
  });
});
