import type {
  CommunicationsMigrationIssueCode,
  CommunicationsProjectionPlan,
  MemoReactionParseResult,
} from "./communicationsMigrationTypes";

export const COMMUNICATIONS_MIGRATION_KEY =
  "full-schema-communications-documents";
export const COMMUNICATIONS_MIGRATION_VERSION = 1;

const IGNORED_COMPARISON_FIELDS = new Set([
  "_id",
  "_creationTime",
  "createdAt",
  "updatedAt",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key, child]) =>
            child !== undefined && !IGNORED_COMPARISON_FIELDS.has(key),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function projectionsEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function parseMemoReaction(value: unknown): MemoReactionParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      issue: { code: "INVALID_MEMO_REACTION", field: "reactions" },
    };
  }
  const reaction = value as Record<string, unknown>;
  if (
    typeof reaction.userId !== "string" ||
    reaction.userId.length === 0 ||
    typeof reaction.emoji !== "string" ||
    reaction.emoji.length === 0 ||
    typeof reaction.createdAt !== "number" ||
    !Number.isFinite(reaction.createdAt)
  ) {
    return {
      ok: false,
      issue: { code: "INVALID_MEMO_REACTION", field: "reactions" },
    };
  }
  return {
    ok: true,
    value: {
      userId: reaction.userId,
      emoji: reaction.emoji,
      reactedAt: reaction.createdAt,
    },
  };
}

export function planCommunicationsProjection<T>(args: {
  expected: T;
  destinations: unknown[];
  duplicateCode: CommunicationsMigrationIssueCode;
  mismatchCode: CommunicationsMigrationIssueCode;
  field: string;
}): CommunicationsProjectionPlan<T> {
  if (args.destinations.length > 1) {
    return {
      outcome: "conflict",
      issues: [{ code: args.duplicateCode, field: args.field }],
    };
  }
  const existing = args.destinations[0];
  if (!existing) return { outcome: "create", value: args.expected };
  if (!projectionsEqual(existing, args.expected)) {
    return {
      outcome: "conflict",
      issues: [{ code: args.mismatchCode, field: args.field }],
    };
  }
  return { outcome: "unchanged" };
}
