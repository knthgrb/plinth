import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const componentRoot = "../app/[organizationId]/chat/_components";

describe("professional chat interface contracts", () => {
  it("uses participant-scoped attachment URLs", () => {
    const source = read(`${componentRoot}/chat-file-attachment.tsx`);

    expect(source).toContain("api.chat.getChatAttachmentUrl");
    expect(source).toContain("conversationId");
    expect(source).toContain("messageId");
    expect(source).not.toContain("files.getFileUrlAndType");
  });

  it("wires real message and conversation actions without destructive shared deletion", () => {
    const source = read(`${componentRoot}/chat-area.tsx`);

    expect(source).toContain("api.chat.toggleMessageReaction");
    expect(source).toContain("api.chat.editMessage");
    expect(source).toContain("api.chat.deleteMessage");
    expect(source).toContain("api.chat.leaveConversation");
    expect(source).toContain("api.chat.archiveConversation");
    expect(source).toContain("api.chat.setConversationMuted");
    expect(source).not.toContain("api.chat.deleteConversation");
  });

  it("provides search and official-channel discovery", () => {
    const listSource = read(`${componentRoot}/conversation-list.tsx`);
    const pageSource = read("../app/[organizationId]/chat/page.tsx");
    const browseSource = read(`${componentRoot}/browse-channels-modal.tsx`);

    expect(listSource).toContain('placeholder="Search conversations"');
    expect(pageSource).toContain("BrowseChannelsModal");
    expect(browseSource).toContain("api.chat.listChannels");
    expect(browseSource).toContain("api.chat.joinChannel");
  });

  it("removes personal-channel creation in favor of private group chats", () => {
    const source = read(`${componentRoot}/create-channel-modal.tsx`);

    expect(source).not.toContain('"personal"');
    expect(source).toContain("Official channels are visible to active organization members");
  });

  it("does not use the TypeScript any type in the chat module", () => {
    const sources = [
      read("../app/[organizationId]/chat/page.tsx"),
      read(`${componentRoot}/chat-area.tsx`),
      read(`${componentRoot}/conversation-list.tsx`),
      read(`${componentRoot}/new-chat-modal.tsx`),
      read(`${componentRoot}/create-group-chat-modal.tsx`),
      read(`${componentRoot}/create-channel-modal.tsx`),
      read(`${componentRoot}/add-members-modal.tsx`),
      read(`${componentRoot}/forward-message-modal.tsx`),
      read("../services/chat-service.ts"),
    ].join("\n");

    expect(sources).not.toMatch(/(?:\bas\s+|:\s*|<|\[)any\b|\bany\[\]/);
  });
});
