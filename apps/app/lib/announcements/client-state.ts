export type AnnouncementReaction = {
  userId: string;
  emoji: string;
  createdAt: number;
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
