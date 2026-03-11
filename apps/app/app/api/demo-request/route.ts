import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, companyName, name, message } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!convexUrl) {
      console.error("NEXT_PUBLIC_CONVEX_URL is not set");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const client = new ConvexHttpClient(convexUrl);
    await client.mutation(api.demoRequests.create, {
      email,
      companyName: companyName || undefined,
      name: name || undefined,
      message: message || undefined,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Demo request API error:", err);
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
