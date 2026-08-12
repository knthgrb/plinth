import { beforeEach, describe, expect, it, vi } from "vitest";

const { createUploadIntent, registerUploadedFile } = vi.hoisted(() => ({
  createUploadIntent: vi.fn(),
  registerUploadedFile: vi.fn(),
}));

vi.mock("@/actions/files", () => ({
  createUploadIntent,
  registerUploadedFile,
}));

import { uploadFileToStorage } from "@/lib/storage-upload";

describe("storage upload orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createUploadIntent.mockResolvedValue({
      intentId: "intent-1",
      uploadUrl: "https://upload.example.test",
    });
    registerUploadedFile.mockResolvedValue("storage-object-1");
  });

  it("registers the returned storage ID against the upload intent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ storageId: "storage-1" }), {
          status: 200,
        }),
      ),
    );
    const file = new File(["private"], "private.txt", {
      type: "text/plain",
    });

    const storageId = await uploadFileToStorage({
      organizationId: "organization-1",
      purpose: "document_attachment",
      file,
    });

    expect(storageId).toBe("storage-1");
    expect(registerUploadedFile).toHaveBeenCalledWith(
      "intent-1",
      "storage-1",
      {
        fileName: "private.txt",
      },
    );
  });

  it("does not register a file when the storage upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("failed", { status: 500 })),
    );

    await expect(
      uploadFileToStorage({
        organizationId: "organization-1",
        purpose: "document_attachment",
        file: new File(["private"], "private.txt"),
      }),
    ).rejects.toThrow("Failed to upload private.txt");
    expect(registerUploadedFile).not.toHaveBeenCalled();
  });
});
