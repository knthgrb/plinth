import { describe, expect, it } from "vitest";

import { getIncomingMessageIdsToAcknowledge } from "../lib/chat-read-state";

describe("chat read acknowledgements", () => {
  it("acknowledges incoming messages even when their receipts already say read", () => {
    const messageIds = getIncomingMessageIdsToAcknowledge(
      [
        {
          _id: "incoming-read",
          senderId: "sender",
          readBy: ["viewer"],
        },
        {
          _id: "incoming-unread",
          senderId: "sender",
          readBy: [],
        },
        {
          _id: "own-message",
          senderId: "viewer",
          readBy: ["viewer"],
        },
      ],
      "viewer",
    );

    expect(messageIds).toEqual(["incoming-read", "incoming-unread"]);
  });
});
