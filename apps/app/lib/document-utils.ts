/**
 * Uploaded file rows use empty TipTap JSON plus one or more storage attachments.
 * Only non–file-only rows should open in the rich-text editor.
 */
export function isFileOnlyDocument(doc: {
  content?: string;
  attachments?: string[] | null;
} | null): boolean {
  if (!doc) return false;
  if (!doc.content) {
    return Boolean(doc.attachments && doc.attachments.length > 0);
  }
  try {
    const content =
      typeof doc.content === "string" ? JSON.parse(doc.content) : doc.content;
    const isEmpty = !content?.content || content.content.length === 0;
    return isEmpty && Boolean(doc.attachments && doc.attachments.length > 0);
  } catch {
    return (
      Boolean(doc.attachments && doc.attachments.length > 0) &&
      String(doc.content).trim() === ""
    );
  }
}

/** Opens a storage or HTTP URL in a new tab; avoids some popup/blank-window issues with window.open alone. */
export function openInNewTab(url: string) {
  if (typeof document === "undefined" || !url) return;
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
