import { NextResponse } from "next/server";
import { withRoleCookieCleared } from "@/helpers/role-cache";

/**
 * Clears the signed role cache cookie (pp.role). Call after sign-out or before
 * hard-navigating post-login so middleware uses the new account's role.
 */
export async function POST() {
  return withRoleCookieCleared(NextResponse.json({ ok: true }));
}
