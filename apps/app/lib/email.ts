/**
 * Transactional email via SendGrid (`TRANSACTIONAL_EMAIL_*`).
 * From line: display name defaults to "Plinth"; set TRANSACTIONAL_EMAIL_FROM_NAME to override.
 */

export interface EmailAttachment {
  filename: string;
  /** Raw bytes (PDF, etc.) */
  content: Buffer | Uint8Array;
  type?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const provider = process.env.TRANSACTIONAL_EMAIL_PROVIDER;
  const from = process.env.TRANSACTIONAL_EMAIL_FROM;
  // Display name in the inbox; sending address remains TRANSACTIONAL_EMAIL_FROM.
  const fromName =
    process.env.TRANSACTIONAL_EMAIL_FROM_NAME?.trim() || "Plinth";
  const url = process.env.TRANSACTIONAL_EMAIL_URL;
  const token = process.env.TRANSACTIONAL_EMAIL_TOKEN;

  if (!provider || !from || !url || !token) {
    throw new Error("Email configuration is missing");
  }

  if (provider === "sendgrid") {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: options.to }],
            subject: options.subject,
          },
        ],
        from: { email: from, name: fromName },
        ...(options.attachments?.length
          ? {
              attachments: options.attachments.map((a) => ({
                content: Buffer.from(a.content).toString("base64"),
                filename: a.filename,
                type: a.type ?? "application/octet-stream",
                disposition: "attachment",
              })),
            }
          : {}),
        content: [
          ...(options.text
            ? [
                {
                  type: "text/plain",
                  value: options.text,
                },
              ]
            : []),
          {
            type: "text/html",
            value: options.html,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send email: ${error}`);
    }
  } else {
    throw new Error(`Unsupported email provider: ${provider}`);
  }
}
