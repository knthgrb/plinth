export type CommunicationsMigrationIssueCode =
  | "INVALID_MEMO_REACTION"
  | "DUPLICATE_MEMO_REACTION"
  | "MEMO_REACTION_MISMATCH"
  | "DUPLICATE_MEMO_ACKNOWLEDGEMENT"
  | "MEMO_ACKNOWLEDGEMENT_MISMATCH"
  | "DUPLICATE_MEMO_AUDIENCE_MEMBER"
  | "MEMO_AUDIENCE_MEMBER_MISMATCH"
  | "DUPLICATE_CONVERSATION_MEMBER"
  | "CONVERSATION_MEMBER_MISMATCH"
  | "DUPLICATE_MESSAGE_RECEIPT"
  | "MESSAGE_RECEIPT_MISMATCH"
  | "DUPLICATE_PINNED_CONVERSATION"
  | "PINNED_CONVERSATION_MISMATCH"
  | "DUPLICATE_DOCUMENT_ACCESS_GRANT"
  | "DOCUMENT_ACCESS_GRANT_MISMATCH"
  | "DUPLICATE_STORAGE_LINK"
  | "STORAGE_LINK_MISMATCH"
  | "DUPLICATE_STORAGE_OBJECT"
  | "STORAGE_OBJECT_TENANT_MISMATCH"
  | "STORAGE_OBJECT_OWNER_TENANT_MISMATCH"
  | "STORAGE_OBJECT_PURPOSE_MISMATCH"
  | "STORAGE_OBJECT_STATE_MISMATCH"
  | "ORGANIZATION_NOT_FOUND"
  | "USER_TENANT_MISMATCH"
  | "EMPLOYEE_TENANT_MISMATCH"
  | "CONVERSATION_TENANT_MISMATCH"
  | "MESSAGE_CONVERSATION_MISMATCH"
  | "MEMO_ATTACHMENT_METADATA_MISMATCH"
  | "UNEXPECTED_DESTINATION_ROW";

export type CommunicationsMigrationIssue = {
  code: CommunicationsMigrationIssueCode;
  field: string;
};

export type CommunicationsProjectionPlan<T> =
  | { outcome: "create"; value: T }
  | { outcome: "unchanged" }
  | { outcome: "conflict"; issues: CommunicationsMigrationIssue[] };

export type ParsedMemoReaction = {
  userId: string;
  emoji: string;
  reactedAt: number;
};

export type MemoReactionParseResult =
  | { ok: true; value: ParsedMemoReaction }
  | { ok: false; issue: CommunicationsMigrationIssue };
