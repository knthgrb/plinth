"use server";

import { getAuthedConvexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { sendEmail } from "@/lib/email";
import { generatePayslipPinResetEmail } from "@/helpers/email-templates";

function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "http://localhost:3000"
  );
}

export async function sendPayslipPinResetEmail(args: {
  employeeId: string;
}): Promise<{ success: true }> {
  const convex = await getAuthedConvexClient();

  const result = await (convex.action as any)(
    (api as any).payslipPinReset.createPayslipPinResetToken,
    { employeeId: args.employeeId as Id<"employees"> },
  );

  const baseUrl = getBaseUrl();
  const link = `${baseUrl}/${result.organizationId}/payslips/reset-pin?token=${encodeURIComponent(
    result.token,
  )}`;

  const emailContent = generatePayslipPinResetEmail(link);

  // Don't await to avoid timing attacks / UX delays.
  void sendEmail({
    to: result.employeeEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  return { success: true };
}

export async function resetPayslipPinFromToken(args: {
  token: string;
  newPin: string;
}): Promise<{ success: true }> {
  const convex = await getAuthedConvexClient();
  await (convex.action as any)(
    (api as any).payslipPinReset.resetPayslipPinWithToken,
    { token: args.token, newPin: args.newPin },
  );
  return { success: true };
}

