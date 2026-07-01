import { describe, expect, it } from "vitest";
import { validateChangePasswordInput } from "@/utils/account-settings";

describe("account settings password validation", () => {
  it("requires the current password", () => {
    expect(
      validateChangePasswordInput({
        currentPassword: "",
        newPassword: "new-password",
        confirmPassword: "new-password",
      }),
    ).toEqual({
      ok: false,
      error: "Enter your current password.",
    });
  });

  it("requires an 8 character new password", () => {
    expect(
      validateChangePasswordInput({
        currentPassword: "current-password",
        newPassword: "short",
        confirmPassword: "short",
      }),
    ).toEqual({
      ok: false,
      error: "New password must be at least 8 characters.",
    });
  });

  it("requires matching confirmation", () => {
    expect(
      validateChangePasswordInput({
        currentPassword: "current-password",
        newPassword: "new-password",
        confirmPassword: "different-password",
      }),
    ).toEqual({
      ok: false,
      error: "New passwords do not match.",
    });
  });

  it("returns password values for valid input", () => {
    expect(
      validateChangePasswordInput({
        currentPassword: "current-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      }),
    ).toEqual({
      ok: true,
      value: {
        currentPassword: "current-password",
        newPassword: "new-password",
      },
    });
  });
});
