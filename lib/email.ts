/**
 * Email utility for sending transactional emails via SendGrid
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const provider = process.env.TRANSACTIONAL_EMAIL_PROVIDER;
  const from = process.env.TRANSACTIONAL_EMAIL_FROM;
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
        from: { email: from },
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
