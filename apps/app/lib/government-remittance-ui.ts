import type { GovernmentRemittanceStatus } from "@/lib/government-remittance";

export type GovernmentRemittanceUiRole = "owner" | "admin" | "accounting";

export type GovernmentRemittanceAction =
  | "view"
  | "attach_evidence"
  | "edit"
  | "submit"
  | "return_to_draft"
  | "approve"
  | "file"
  | "pay"
  | "fail_filing"
  | "fail_payment"
  | "retry"
  | "cancel"
  | "reverse";

export function getGovernmentRemittanceActions(
  status: GovernmentRemittanceStatus,
  role: GovernmentRemittanceUiRole,
): GovernmentRemittanceAction[] {
  const actions: GovernmentRemittanceAction[] = ["view", "attach_evidence"];
  const canApprove = role === "owner" || role === "admin";
  switch (status) {
    case "draft":
      actions.push("edit", "submit", "cancel");
      break;
    case "reviewed":
      actions.push("return_to_draft");
      if (canApprove) actions.push("approve");
      actions.push("cancel");
      break;
    case "approved":
      actions.push("file", "fail_filing");
      if (canApprove) actions.push("cancel");
      break;
    case "filed":
      actions.push("pay", "fail_payment");
      break;
    case "failed":
      actions.push("retry");
      if (canApprove) actions.push("cancel");
      break;
    case "paid":
      if (canApprove) actions.push("reverse");
      break;
    case "cancelled":
    case "reversed":
      break;
  }
  return actions;
}

const INPUT_LABELS = {
  file: "Filing reference number",
  pay: "Payment reference number",
  fail_filing: "Failure reason",
  fail_payment: "Failure reason",
  return_to_draft: "Return reason",
  cancel: "Cancellation reason",
  reverse: "Reversal reason",
} as const;

export function validateGovernmentRemittanceLifecycleInput(
  action: keyof typeof INPUT_LABELS,
  value: string,
): string {
  const normalized = value.trim();
  const label = INPUT_LABELS[action];
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > 1_000) {
    throw new Error(`${label} cannot exceed 1000 characters.`);
  }
  return normalized;
}
