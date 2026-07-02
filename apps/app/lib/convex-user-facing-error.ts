import { ConvexError } from "convex/values";

/**
 * ConvexHttpClient throws `Error` or `ConvexError`. Next.js server actions often
 * hide thrown `Error.message` in production; callers should prefer returning
 * `{ ok: false, error: getConvexUserFacingMessage(e) }` from the action instead.
 */
export function getConvexUserFacingMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const d = error.data as unknown;
    if (typeof d === "string" && d.trim()) return d.trim();
    if (
      d &&
      typeof d === "object" &&
      "message" in d &&
      typeof (d as { message: unknown }).message === "string"
    ) {
      const m = (d as { message: string }).message.trim();
      if (m) return m;
    }
    const em = error.message?.trim();
    if (em && !looksLikeGenericTransportError(em)) return em;
    return "Something went wrong. Please try again.";
  }
  if (error instanceof Error) {
    const m = error.message?.trim();
    const convexMessage = getConvexErrorPayloadMessage(m);
    if (convexMessage) return convexMessage;
    if (m && !looksLikeGenericTransportError(m)) return m;
  }
  if (typeof error === "string") {
    const m = error.trim();
    const convexMessage = getConvexErrorPayloadMessage(m);
    if (convexMessage) return convexMessage;
    if (m && !looksLikeGenericTransportError(m)) return m;
  }
  return "Something went wrong. Please try again.";
}

function getConvexErrorPayloadMessage(message: string | undefined): string | null {
  if (!message) return null;
  const uncaughtError = message.match(/Uncaught Error:\s*([^\n]+)/);
  if (uncaughtError?.[1]?.trim()) {
    return uncaughtError[1].trim();
  }
  const jsonMatch = message.match(/ConvexError:\s*(\{[^\n]+\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof (parsed as { message: unknown }).message === "string"
      ) {
        const m = (parsed as { message: string }).message.trim();
        if (m) return m;
      }
    } catch {
      // Fall through to the quoted-message parser below.
    }
  }
  const quotedMessage = message.match(/"message"\s*:\s*"([^"]+)"/);
  return quotedMessage?.[1]?.trim() || null;
}

function looksLikeGenericTransportError(message: string): boolean {
  return (
    /\[Request ID:/i.test(message) ||
    /\bServer Error\b/i.test(message) ||
    /digest/i.test(message) ||
    /omitted in production/i.test(message)
  );
}
