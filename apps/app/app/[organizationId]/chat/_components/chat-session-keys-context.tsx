"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const ChatSessionKeysContext = createContext<Record<string, string>>({});

export function ChatSessionKeysProvider({
  organizationId,
  children,
}: {
  organizationId: Id<"organizations"> | null | undefined;
  children: ReactNode;
}) {
  const data = useQuery(
    (api as any).chat.listChatSessionKeysForOrganization,
    organizationId ? { organizationId } : "skip",
  );
  const keys = data ?? {};
  return (
    <ChatSessionKeysContext.Provider value={keys}>
      {children}
    </ChatSessionKeysContext.Provider>
  );
}

export function useChatSessionKeys(): Record<string, string> {
  return useContext(ChatSessionKeysContext);
}
