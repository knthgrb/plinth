import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatSource = readFileSync(
  new URL("../convex/chat.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../convex/schema.ts", import.meta.url),
  "utf8",
);

describe("chat query performance contracts", () => {
  it("uses an indexed bounded query for older-message pagination", () => {
    expect(schemaSource).toContain(
      '.index("by_conversation_created_at", ["conversationId", "createdAt"])',
    );

    const getMessagesSource = chatSource.slice(
      chatSource.indexOf("export const getMessages"),
      chatSource.indexOf("export const sendMessage"),
    );
    expect(getMessagesSource).toContain('withIndex("by_conversation_created_at"');
    expect(getMessagesSource).not.toContain("messageQuery.collect()");
  });

  it("computes unread counts from the indexed last-read cursor", () => {
    const unreadSource = chatSource.slice(
      chatSource.indexOf("async function loadUnreadCounts"),
      chatSource.indexOf("export const getUnreadCounts"),
    );

    expect(schemaSource).toContain("lastReadAt: v.optional(v.number())");
    expect(unreadSource).toContain('withIndex("by_conversation_created_at"');
    expect(unreadSource).toContain("lastReadAt");
    expect(unreadSource).not.toContain("loadEffectiveMessageReadBy");
  });
});
