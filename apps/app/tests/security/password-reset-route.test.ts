import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/lib/email", () => ({ sendEmail }));

import { POST } from "../../app/api/auth/send-password-reset/route";

function makeRequest(body: unknown, secret?: string) {
  return new NextRequest("https://plinth.example/api/auth/send-password-reset", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-auth-email-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("password reset email route", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_EMAIL_WEBHOOK_SECRET", "test-reset-secret");
    vi.stubEnv("SITE_URL", "https://plinth.example");
    sendEmail.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without the internal webhook secret", async () => {
    const response = await POST(
      makeRequest({
        user: { email: "employee@example.com" },
        url: "https://plinth.example/reset-password?token=valid",
      }),
    );

    expect(response.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects reset links for an untrusted origin", async () => {
    const response = await POST(
      makeRequest(
        {
          user: { email: "employee@example.com" },
          url: "https://evil.example/phishing",
        },
        "test-reset-secret",
      ),
    );

    expect(response.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
