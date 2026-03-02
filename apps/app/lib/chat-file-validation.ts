/**
 * Chat file validation: magic-byte checks so .jpg etc. are actually the claimed type,
 * plus file size limit.
 */

export const CHAT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

const SIGNATURES: { type: string; mimes: string[]; check: (buf: ArrayBuffer) => boolean }[] = [
  {
    type: "image",
    mimes: ["image/jpeg", "image/jpg"],
    check: (buf) => {
      const a = new Uint8Array(buf);
      return a.length >= 3 && a[0] === 0xff && a[1] === 0xd8 && a[2] === 0xff;
    },
  },
  {
    type: "image",
    mimes: ["image/png"],
    check: (buf) => {
      const a = new Uint8Array(buf);
      const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return png.every((b, i) => a[i] === b);
    },
  },
  {
    type: "image",
    mimes: ["image/gif"],
    check: (buf) => {
      const a = new Uint8Array(buf);
      return (a[0] === 0x47 && a[1] === 0x49 && a[2] === 0x46 && a[3] === 0x38);
    },
  },
  {
    type: "image",
    mimes: ["image/webp"],
    check: (buf) => {
      const a = new Uint8Array(buf);
      if (a.length < 12) return false;
      const riff = a[0] === 0x52 && a[1] === 0x49 && a[2] === 0x46 && a[3] === 0x46;
      const webp = a[8] === 0x57 && a[9] === 0x45 && a[10] === 0x42 && a[11] === 0x50;
      return riff && webp;
    },
  },
  {
    type: "application",
    mimes: ["application/pdf"],
    check: (buf) => {
      const a = new Uint8Array(buf);
      return a.length >= 4 && a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46;
    },
  },
];

function getMimeCategory(mime: string): "image" | "application" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "application";
  return "other";
}

export async function validateChatFile(file: File): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (file.size > CHAT_MAX_FILE_BYTES) {
    return { ok: false, reason: `File is too large. Maximum size is ${CHAT_MAX_FILE_BYTES / 1024 / 1024}MB.` };
  }

  const mime = (file.type || "").toLowerCase();
  const header = file.slice(0, 12);
  const buf = await header.arrayBuffer();

  for (const sig of SIGNATURES) {
    if (!sig.mimes.some((m) => mime === m)) continue;
    if (!sig.check(buf)) {
      return {
        ok: false,
        reason: `File content does not match its type (${file.name}). It may be renamed or corrupted.`,
      };
    }
    return { ok: true };
  }

  // If claimed type is image but we don't have a signature for it, still allow if size is ok
  if (getMimeCategory(mime) === "image") {
    // Optional: allow only known image types
    const known = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (!known.includes(mime)) {
      return { ok: false, reason: "Unsupported image type. Use JPG, PNG, GIF, or WebP." };
    }
  }

  return { ok: true };
}
