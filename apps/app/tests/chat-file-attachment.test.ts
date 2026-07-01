import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAttachmentPreviewMode } from "@/app/[organizationId]/chat/_components/chat-file-attachment";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("chat file attachments", () => {
  it("classifies browser-previewable files for the in-app preview dialog", () => {
    expect(getAttachmentPreviewMode("image/png")).toBe("image");
    expect(getAttachmentPreviewMode("video/mp4")).toBe("video");
    expect(getAttachmentPreviewMode("application/pdf")).toBe("pdf");
  });

  it("falls back to a generic file preview for unsupported or missing content types", () => {
    expect(getAttachmentPreviewMode("application/zip")).toBe("file");
    expect(getAttachmentPreviewMode(null)).toBe("file");
  });

  it("keeps preview as the primary action and leaves new-tab opening secondary", () => {
    const source = readSource(
      "../app/[organizationId]/chat/_components/chat-file-attachment.tsx",
    );

    expect(source).toContain("AttachmentPreviewDialog");
    expect(source).toContain("onClick={() => setPreviewOpen(true)}");
    expect(source).toContain("Open in New Tab");
    expect(source).toContain('target="_blank"');
  });
});
