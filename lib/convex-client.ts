import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

// Returns a Convex client authenticated with the current Better Auth session.
export async function getAuthedConvexClient() {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  return client;
}

