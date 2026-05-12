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
    if (m && !looksLikeGenericTransportError(m)) return m;
  }
  return "Something went wrong. Please try again.";
}

function looksLikeGenericTransportError(message: string): boolean {
  return (
    /\[Request ID:/i.test(message) ||
    /\bServer Error\b/i.test(message) ||
    /digest/i.test(message) ||
    /omitted in production/i.test(message)
  );
}
