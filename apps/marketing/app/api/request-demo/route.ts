import { NextRequest, NextResponse } from "next/server";

const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, company, message } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!mainAppUrl) {
      console.error("NEXT_PUBLIC_MAIN_APP_URL is not set");
      return NextResponse.json(
        { error: "Service is not configured" },
        { status: 500 }
      );
    }

    const storeRes = await fetch(`${mainAppUrl}/api/demo-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        companyName: company || undefined,
        name: name || undefined,
        message: message || undefined,
      }),
    });

    if (!storeRes.ok) {
      const errText = await storeRes.text();
      console.error("Failed to store demo request:", errText);
      return NextResponse.json(
        { error: "Failed to submit. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error("Request demo error:", err);
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
