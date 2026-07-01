export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangePasswordValidationResult =
  | {
      ok: true;
      value: {
        currentPassword: string;
        newPassword: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

const MIN_PASSWORD_LENGTH = 8;

export function validateChangePasswordInput(
  input: ChangePasswordInput,
): ChangePasswordValidationResult {
  if (input.currentPassword.length === 0) {
    return {
      ok: false,
      error: "Enter your current password.",
    };
  }

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: "New password must be at least 8 characters.",
    };
  }

  if (input.newPassword !== input.confirmPassword) {
    return {
      ok: false,
      error: "New passwords do not match.",
    };
  }

  return {
    ok: true,
    value: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    },
  };
}
