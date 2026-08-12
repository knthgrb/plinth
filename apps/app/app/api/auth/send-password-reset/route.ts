import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { generatePasswordResetEmail } from "@/helpers/email-templates";

const MAX_BODY_BYTES = 16 * 1024;
const resetEmailRequestSchema = z.object({
  user: z.object({ email: z.string().email().max(320) }),
  url: z.string().url().max(2048),
});

function secretsMatch(provided: string | null, expected: string | undefined) {
  if (!provided || !expected) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.AUTH_EMAIL_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (
    !secretsMatch(
      request.headers.get("x-auth-email-secret"),
      expectedSecret,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Invalid request" }, { status: 413 });
    }

    const parsed = resetEmailRequestSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { user, url } = parsed.data;
    const configuredSiteUrl = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
    if (!configuredSiteUrl) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    if (new URL(url).origin !== new URL(configuredSiteUrl).origin) {
      return NextResponse.json(
        { error: "Invalid request" },
        { status: 400 },
      );
    }

    const emailContent = generatePasswordResetEmail(url);

    await sendEmail({
      to: user.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 },
    );
  }
}
