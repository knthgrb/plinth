import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { generatePasswordResetEmail } from "@/helpers/email-templates";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user, url, token } = body;

    if (!user?.email || !url) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const emailContent = generatePasswordResetEmail(url);

    // Don't await to prevent timing attacks
    void sendEmail({
      to: user.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to send password reset email:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
