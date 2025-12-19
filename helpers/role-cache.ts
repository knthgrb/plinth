import { NextRequest, NextResponse } from "next/server";
import { UserService } from "@/services/user-service";

const ROLE_COOKIE_NAME = "pp.role";
const ROLE_COOKIE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const roleCookieSecret = process.env.ROLE_COOKIE_SECRET || "";

type RoleCachePayload = {
  role: string | null;
  organizationId: string | null;
  exp: number;
};

// Base64url helpers (middleware-safe)
const base64urlEncode = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const base64urlDecodeToBytes = (input: string): Uint8Array => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

async function signPayload(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(roleCookieSecret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return base64urlEncode(signature);
}

async function verifySignature(
  payload: string,
  signatureB64: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const keyData = enc.encode(roleCookieSecret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    const sigBytes = base64urlDecodeToBytes(signatureB64);
    const sigArray = new Uint8Array(sigBytes.length);
    sigArray.set(sigBytes);

    const payloadBytes = enc.encode(payload);
    const payloadArray = new Uint8Array(payloadBytes.length);
    payloadArray.set(payloadBytes);

    return await crypto.subtle.verify("HMAC", key, sigArray, payloadArray);
  } catch {
    return false;
  }
}

async function readRoleCookie(
  request: NextRequest
): Promise<RoleCachePayload | null> {
  if (!roleCookieSecret) return null;
  const cookie = request.cookies.get(ROLE_COOKIE_NAME);
  if (!cookie?.value) return null;

  const parts = cookie.value.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const payloadJsonBytes = base64urlDecodeToBytes(payloadB64);
  let payloadJson = "";
  for (let i = 0; i < payloadJsonBytes.length; i++) {
    payloadJson += String.fromCharCode(payloadJsonBytes[i]);
  }

  const valid = await verifySignature(payloadJson, sigB64);
  if (!valid) return null;

  const data = JSON.parse(payloadJson) as RoleCachePayload;
  if (!data || typeof data.exp !== "number") return null;
  if (Date.now() > data.exp) return null;
  return data;
}

async function writeRoleCookie(
  response: NextResponse,
  role: string | null,
  organizationId: string | null
) {
  if (!roleCookieSecret) return;
  const payload: RoleCachePayload = {
    role,
    organizationId,
    exp: Date.now() + ROLE_COOKIE_TTL_MS,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = base64urlEncode(payloadBytes);
  const signature = await signPayload(payloadJson);
  const value = `${payloadB64}.${signature}`;

  response.cookies.set({
    name: ROLE_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ROLE_COOKIE_TTL_MS / 1000),
  });
}

export async function getRoleWithCache(request: NextRequest): Promise<{
  role: string | null;
  organizationId: string | null;
  fromCache: boolean;
}> {
  // Prefer fresh role from backend; fall back to cookie if fetch fails
  try {
    const result = await UserService.getUserRoleAndOrg();
    return {
      role: result.role,
      organizationId: result.organizationId,
      fromCache: false,
    };
  } catch (error) {
    console.error(
      "Error getting user role; falling back to cookie cache:",
      error
    );
    try {
      const cached = await readRoleCookie(request);
      if (cached) {
        return {
          role: cached.role,
          organizationId: cached.organizationId,
          fromCache: true,
        };
      }
    } catch {
      // ignore
    }
    return { role: null, organizationId: null, fromCache: false };
  }
}

export async function setRoleCookieIfNeeded(
  response: NextResponse,
  role: string | null,
  organizationId: string | null,
  shouldSet: boolean
) {
  if (!shouldSet) return response;
  await writeRoleCookie(response, role, organizationId);
  return response;
}
