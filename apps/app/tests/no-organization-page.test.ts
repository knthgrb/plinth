import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("no organization page", () => {
  it("provides a logout action", () => {
    const source = readFileSync(
      new URL("../app/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Log out");
    expect(source).toContain("authClient.signOut");
    expect(source).toContain("/api/auth/clear-role-cache");
  });
});
