import { describe, expect, it } from "vitest";
import {
  applyOptimisticReaction,
  buildCommentThreads,
  formatLocalDateTime,
  getReactionBarEmojis,
  getReactionPickerEmojis,
} from "../lib/announcements/client-state";

describe("announcement client state", () => {
  it("replaces only the current user's reaction without mutating query data", () => {
    const announcements = [
      {
        _id: "announcement-1",
        title: "Update",
        reactions: [
          { userId: "viewer", emoji: "👍", createdAt: 10 },
          { userId: "coworker", emoji: "❤️", createdAt: 11 },
        ],
      },
    ];

    const next = applyOptimisticReaction(announcements, {
      announcementId: "announcement-1",
      userId: "viewer",
      emoji: "🎉",
      createdAt: 20,
    });

    expect(next[0]?.reactions).toEqual([
      { userId: "coworker", emoji: "❤️", createdAt: 11 },
      { userId: "viewer", emoji: "🎉", createdAt: 20 },
    ]);
    expect(announcements[0]?.reactions).toEqual([
      { userId: "viewer", emoji: "👍", createdAt: 10 },
      { userId: "coworker", emoji: "❤️", createdAt: 11 },
    ]);
  });

  it("optimistically removes the current user's reaction", () => {
    const next = applyOptimisticReaction(
      [
        {
          _id: "announcement-1",
          reactions: [
            { userId: "viewer", emoji: "👍", createdAt: 10 },
            { userId: "coworker", emoji: "❤️", createdAt: 11 },
          ],
        },
      ],
      {
        announcementId: "announcement-1",
        userId: "viewer",
        emoji: null,
        createdAt: 20,
      },
    );

    expect(next[0]?.reactions).toEqual([
      { userId: "coworker", emoji: "❤️", createdAt: 11 },
    ]);
  });

  it("formats scheduled dates in local time instead of shifting through UTC", () => {
    const timestamp = new Date(2026, 7, 14, 9, 30).getTime();

    expect(formatLocalDateTime(timestamp)).toBe("2026-08-14T09:30");
  });

  it("keeps the primary reactions out of the additional-reaction picker", () => {
    expect(getReactionPickerEmojis()).toEqual(["😊", "👏", "🎉"]);
  });

  it("shows selected additional reactions beside the primary reactions", () => {
    expect(
      getReactionBarEmojis([
        { userId: "viewer", emoji: "🎉", createdAt: 10 },
        { userId: "coworker", emoji: "👏", createdAt: 11 },
      ]),
    ).toEqual(["👍", "❤️", "😮", "👏", "🎉"]);
  });

  it("builds nested comment threads even when replies arrive before parents", () => {
    const comments = [
      {
        _id: "reply-2",
        parentCommentId: "reply-1",
        content: "Nested reply",
      },
      { _id: "parent", content: "Top-level comment" },
      {
        _id: "reply-1",
        parentCommentId: "parent",
        content: "First reply",
      },
    ];

    expect(buildCommentThreads(comments)).toEqual([
      {
        _id: "parent",
        content: "Top-level comment",
        replies: [
          {
            _id: "reply-1",
            parentCommentId: "parent",
            content: "First reply",
            replies: [
              {
                _id: "reply-2",
                parentCommentId: "reply-1",
                content: "Nested reply",
                replies: [],
              },
            ],
          },
        ],
      },
    ]);
  });
});
