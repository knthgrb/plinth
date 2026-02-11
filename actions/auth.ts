"use server";

import { sendEmail } from "@/lib/email";
import { generatePasswordResetEmail } from "@/helpers/email-templates";

export async function sendPasswordResetEmail(data: {
  user: { email: string; name?: string | null };
  url: string;
  token: string;
}) {
  try {
    const emailContent = generatePasswordResetEmail(data.url);
    
    // Don't await to prevent timing attacks
    void sendEmail({
      to: data.user.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
  } catch (error) {
    console.error("Failed to send password reset email:", error);
    // Don't throw - Better Auth will handle the error
  }
}
