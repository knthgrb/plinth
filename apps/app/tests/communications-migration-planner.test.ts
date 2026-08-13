import { describe, expect, it } from "vitest";
import {
  COMMUNICATIONS_MIGRATION_KEY,
  COMMUNICATIONS_MIGRATION_VERSION,
  parseMemoReaction,
  planCommunicationsProjection,
} from "../convex/communicationsMigrationPlanner";

describe("communications migration planner", () => {
  it("uses the registered communications migration identity", () => {
    expect(COMMUNICATIONS_MIGRATION_KEY).toBe(
      "full-schema-communications-documents",
    );
    expect(COMMUNICATIONS_MIGRATION_VERSION).toBe(1);
  });

  it("parses the supported legacy memo reaction shape", () => {
    expect(
      parseMemoReaction({
        userId: "user-1",
        emoji: "👍",
        createdAt: 123,
      }),
    ).toEqual({
      ok: true,
      value: { userId: "user-1", emoji: "👍", reactedAt: 123 },
    });
  });

  it.each([
    undefined,
    null,
    {},
    { userId: "", emoji: "👍", createdAt: 123 },
    { userId: "user-1", emoji: "", createdAt: 123 },
    { userId: "user-1", emoji: "👍", createdAt: Number.NaN },
  ])("rejects an unsupported memo reaction without exposing it: %p", (value) => {
    expect(parseMemoReaction(value)).toEqual({
      ok: false,
      issue: { code: "INVALID_MEMO_REACTION", field: "reactions" },
    });
  });

  it("creates a projection when the natural key is absent", () => {
    expect(
      planCommunicationsProjection({
        expected: { memoId: "memo-1", emoji: "👍" },
        destinations: [],
        duplicateCode: "DUPLICATE_MEMO_REACTION",
        mismatchCode: "MEMO_REACTION_MISMATCH",
        field: "reactions",
      }),
    ).toEqual({
      outcome: "create",
      value: { memoId: "memo-1", emoji: "👍" },
    });
  });

  it("ignores Convex and mutable timestamp metadata when comparing", () => {
    expect(
      planCommunicationsProjection({
        expected: { memoId: "memo-1", emoji: "👍", migrationVersion: 1 },
        destinations: [
          {
            _id: "reaction-1",
            _creationTime: 10,
            memoId: "memo-1",
            emoji: "👍",
            migrationVersion: 1,
            createdAt: 20,
            updatedAt: 30,
          },
        ],
        duplicateCode: "DUPLICATE_MEMO_REACTION",
        mismatchCode: "MEMO_REACTION_MISMATCH",
        field: "reactions",
      }),
    ).toEqual({ outcome: "unchanged" });
  });

  it("reports duplicate and unequal destinations using redacted codes", () => {
    expect(
      planCommunicationsProjection({
        expected: { memoId: "memo-1", emoji: "👍" },
        destinations: [
          { memoId: "memo-1", emoji: "👍" },
          { memoId: "memo-1", emoji: "👍" },
        ],
        duplicateCode: "DUPLICATE_MEMO_REACTION",
        mismatchCode: "MEMO_REACTION_MISMATCH",
        field: "reactions",
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "DUPLICATE_MEMO_REACTION", field: "reactions" }],
    });

    expect(
      planCommunicationsProjection({
        expected: { memoId: "memo-1", emoji: "👍" },
        destinations: [{ memoId: "memo-1", emoji: "👎" }],
        duplicateCode: "DUPLICATE_MEMO_REACTION",
        mismatchCode: "MEMO_REACTION_MISMATCH",
        field: "reactions",
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "MEMO_REACTION_MISMATCH", field: "reactions" }],
    });
  });
});
