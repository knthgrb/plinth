export function canUseFilledLeaveForm(
  status: string,
  filledFormContent?: string | null,
): boolean {
  return status === "approved" && Boolean(filledFormContent?.trim());
}
