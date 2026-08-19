export type ChatReadStateMessage<MessageId extends string = string> = {
  _id: MessageId;
  senderId: string;
  readBy: readonly string[];
};

export function getIncomingMessageIdsToAcknowledge<MessageId extends string>(
  messages: readonly ChatReadStateMessage<MessageId>[],
  currentUserId: string,
): MessageId[] {
  return messages
    .filter((message) => message.senderId !== currentUserId)
    .map((message) => message._id);
}
