/** Shared labels for direct messages with optional staff "Admin" persona thread. */

function otherDirectParticipant(
  conv: {
    participants?: Array<{ _id?: string; name?: string; email?: string }>;
  },
  currentUserId?: string,
) {
  const list = conv.participants ?? [];
  if (!currentUserId) return list[0];
  const other = list.find((p) => p._id !== currentUserId);
  return other ?? list[0];
}

export function directConversationTitle(
  conv: {
    type: string;
    name?: string;
    participants?: Array<{ _id?: string; name?: string; email?: string }>;
    directThreadKind?: string;
    adminPersonaUserId?: string;
  },
  currentUserId?: string,
): string {
  if (conv.type === "channel") return conv.name || "Channel";
  if (conv.type === "group") return conv.name || "Group Chat";
  const otherParticipant = otherDirectParticipant(conv, currentUserId);
  const base =
    otherParticipant?.name || otherParticipant?.email || "Unknown User";
  if (
    conv.directThreadKind === "staff_as_admin" &&
    conv.adminPersonaUserId
  ) {
    if (currentUserId && conv.adminPersonaUserId === currentUserId) {
      return `${base} · Admin`;
    }
    return "Admin";
  }
  return base;
}

export function directConversationSubtitle(
  conv: {
    type: string;
    participants?: Array<{ _id?: string; email?: string }>;
    directThreadKind?: string;
    adminPersonaUserId?: string;
  },
  currentUserId?: string,
): string {
  if (conv.type !== "direct") return "";
  if (
    conv.directThreadKind === "staff_as_admin" &&
    conv.adminPersonaUserId === currentUserId
  ) {
    return "They see you as Admin";
  }
  return otherDirectParticipant(conv, currentUserId)?.email || "Direct message";
}

export function messageSenderLabelInDirect(
  messageSenderId: string,
  sender: { name?: string; email?: string } | null | undefined,
  conversation:
    | {
        type?: string;
        directThreadKind?: string;
        adminPersonaUserId?: string;
      }
    | null
    | undefined,
  currentUserId?: string,
): string {
  if (conversation?.type !== "direct") {
    return sender?.name || sender?.email || "Unknown";
  }
  if (
    conversation.directThreadKind === "staff_as_admin" &&
    conversation.adminPersonaUserId &&
    messageSenderId === conversation.adminPersonaUserId
  ) {
    if (messageSenderId === currentUserId) return "You · Admin";
    return "Admin";
  }
  return sender?.name || sender?.email || "Unknown";
}

export function directConversationAvatarInitials(
  conv: {
    type: string;
    name?: string;
    participants?: Array<{ name?: string; email?: string }>;
    directThreadKind?: string;
    adminPersonaUserId?: string;
  },
  currentUserId?: string,
): string {
  if (conv.type === "channel") return conv.name ? conv.name[0].toUpperCase() : "#";
  if (conv.type === "group") {
    return (
      conv.name
        ?.split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) || "GC"
    );
  }
  if (
    conv.directThreadKind === "staff_as_admin" &&
    conv.adminPersonaUserId &&
    currentUserId &&
    conv.adminPersonaUserId !== currentUserId
  ) {
    return "A";
  }
  const otherParticipant = otherDirectParticipant(conv, currentUserId);
  const displayName =
    otherParticipant?.name || otherParticipant?.email || "Unknown";
  return displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
