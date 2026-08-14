export type AnnouncementReaction = {
  userId: string;
  emoji: string;
  createdAt: number;
};

export const PRIMARY_REACTION_EMOJIS = ["👍", "❤️", "😮"] as const;
export const ADDITIONAL_REACTION_EMOJIS = ["😊", "👏", "🎉"] as const;

type ThreadableComment = {
  _id: string;
  parentCommentId?: string;
};

export type CommentThread<TComment extends ThreadableComment> = TComment & {
  replies: CommentThread<TComment>[];
};

export type OptimisticReactionInput = {
  announcementId: string;
  userId: string;
  emoji: string | null;
  createdAt: number;
};

export function applyOptimisticReaction<
  TAnnouncement extends {
    _id: string;
    reactions?: readonly AnnouncementReaction[];
  },
>(
  announcements: readonly TAnnouncement[],
  input: OptimisticReactionInput,
): TAnnouncement[] {
  return announcements.map((announcement) => {
    if (announcement._id !== input.announcementId) return announcement;
    const reactions = (announcement.reactions ?? []).filter(
      (reaction) => reaction.userId !== input.userId,
    );
    if (input.emoji !== null) {
      reactions.push({
        userId: input.userId,
        emoji: input.emoji,
        createdAt: input.createdAt,
      });
    }
    return { ...announcement, reactions };
  });
}

export function formatLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getReactionPickerEmojis(): readonly string[] {
  return ADDITIONAL_REACTION_EMOJIS;
}

export function getReactionBarEmojis(
  reactions: readonly AnnouncementReaction[],
): string[] {
  const selectedEmojis = new Set(reactions.map((reaction) => reaction.emoji));
  return [
    ...PRIMARY_REACTION_EMOJIS,
    ...ADDITIONAL_REACTION_EMOJIS.filter((emoji) =>
      selectedEmojis.has(emoji),
    ),
  ];
}

export function buildCommentThreads<TComment extends ThreadableComment>(
  comments: readonly TComment[],
): CommentThread<TComment>[] {
  const commentsById = new Map<string, CommentThread<TComment>>();
  for (const comment of comments) {
    commentsById.set(comment._id, { ...comment, replies: [] });
  }

  const roots: CommentThread<TComment>[] = [];
  for (const comment of comments) {
    const threadedComment = commentsById.get(comment._id);
    if (!threadedComment) continue;
    const parent = comment.parentCommentId
      ? commentsById.get(comment.parentCommentId)
      : undefined;
    if (parent) {
      parent.replies.push(threadedComment);
    } else {
      roots.push(threadedComment);
    }
  }
  return roots;
}
