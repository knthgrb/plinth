import {
  createUploadIntent,
  registerUploadedFile,
} from "@/actions/files";
import type { StoragePurpose } from "@/services/files-service";

function parseStorageId(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { storageId?: string } | string;
    if (typeof parsed === "string") return parsed.trim();
    if (parsed.storageId) return parsed.storageId.trim();
  } catch {
    return responseText.trim().replace(/^["']|["']$/g, "");
  }

  throw new Error("Storage upload did not return a file ID");
}

export async function uploadFileToStorage({
  organizationId,
  purpose,
  file,
}: {
  organizationId: string;
  purpose: StoragePurpose;
  file: File;
}): Promise<string> {
  const { intentId, uploadUrl } = await createUploadIntent(
    organizationId,
    purpose,
  );
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Failed to upload ${file.name}`);
  }

  const storageId = parseStorageId(await response.text());
  await registerUploadedFile(intentId, storageId, {
    fileName: file.name,
  });
  return storageId;
}
