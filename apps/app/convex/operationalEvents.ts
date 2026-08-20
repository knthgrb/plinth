import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { v } from "convex/values";

import { requireActiveMembership } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type MutationCtx } from "./_generated/server";
import {
  decodeOperationalEventPayload,
  encodeOperationalEventPayload,
} from "./operationalEventCrypto";

const OPERATIONAL_EVENT_HASH_DOMAIN = "plinth-operational-event-v1:";
const MAX_OPERATIONAL_EVENT_PAYLOAD_BYTES = 64 * 1024;
const MAX_OPERATIONAL_EVENT_CHANGED_FIELDS = 100;

type OperationalEventActor = {
  type: "user" | "system";
  userId?: Id<"users">;
  membershipId?: Id<"userOrganizations">;
  role?: string;
  displayName?: string;
};

export type AppendOperationalEventInput = {
  organizationId: Id<"organizations">;
  eventType: string;
  eventVersion?: number;
  aggregateType: string;
  aggregateId: string;
  actor: OperationalEventActor;
  occurredAt?: number;
  summary?: string;
  changedFields?: readonly string[];
  payload?: unknown;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
};

type HashableOperationalEvent = Pick<
  Doc<"operationalEvents">,
  | "organizationId"
  | "sequence"
  | "eventType"
  | "eventVersion"
  | "aggregateType"
  | "aggregateId"
  | "actorType"
  | "actorUserId"
  | "actorMembershipId"
  | "actorRole"
  | "actorDisplayName"
  | "occurredAt"
  | "recordedAt"
  | "summary"
  | "changedFields"
  | "payload"
  | "correlationId"
  | "causationId"
  | "idempotencyKey"
  | "previousHash"
>;

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
  return `{${entries.join(",")}}`;
}

function hashOperationalEvent(event: HashableOperationalEvent): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(`${OPERATIONAL_EVENT_HASH_DOMAIN}${stableSerialize(event)}`),
    ),
  );
}

function toHashableOperationalEvent(
  event: Doc<"operationalEvents">,
): HashableOperationalEvent {
  return {
    organizationId: event.organizationId,
    sequence: event.sequence,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    actorType: event.actorType,
    actorUserId: event.actorUserId,
    actorMembershipId: event.actorMembershipId,
    actorRole: event.actorRole,
    actorDisplayName: event.actorDisplayName,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    summary: event.summary,
    changedFields: event.changedFields,
    payload: event.payload,
    correlationId: event.correlationId,
    causationId: event.causationId,
    idempotencyKey: event.idempotencyKey,
    previousHash: event.previousHash,
  };
}

export function verifyOperationalEventHash(
  event: Doc<"operationalEvents">,
): boolean {
  return hashOperationalEvent(toHashableOperationalEvent(event)) === event.hash;
}

function normalizeEventString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > 200) {
    throw new Error(`${label} cannot exceed 200 characters.`);
  }
  return normalized;
}

export async function appendOperationalEvent(
  ctx: MutationCtx,
  input: AppendOperationalEventInput,
): Promise<Id<"operationalEvents">> {
  const eventType = normalizeEventString(input.eventType, "Event type");
  const aggregateType = normalizeEventString(
    input.aggregateType,
    "Aggregate type",
  );
  const aggregateId = normalizeEventString(input.aggregateId, "Aggregate id");
  const eventVersion = input.eventVersion ?? 1;
  if (!Number.isInteger(eventVersion) || eventVersion < 1) {
    throw new Error("Event version must be a positive integer.");
  }
  const occurredAt = input.occurredAt ?? Date.now();
  if (!Number.isFinite(occurredAt) || occurredAt < 0) {
    throw new Error("Event occurrence time must be a valid timestamp.");
  }
  const payloadJson =
    input.payload === undefined ? undefined : JSON.stringify(input.payload);
  if (
    payloadJson !== undefined &&
    utf8ToBytes(payloadJson).length > MAX_OPERATIONAL_EVENT_PAYLOAD_BYTES
  ) {
    throw new Error("Operational event payload is too large.");
  }
  const changedFields = input.changedFields
    ? Array.from(
        new Set(input.changedFields.map((field) => field.trim())),
      ).filter(Boolean)
    : undefined;
  if ((changedFields?.length ?? 0) > MAX_OPERATIONAL_EVENT_CHANGED_FIELDS) {
    throw new Error("Operational event has too many changed fields.");
  }
  for (const field of changedFields ?? []) {
    normalizeEventString(field, "Changed field");
  }
  const idempotencyKey = input.idempotencyKey?.trim() || undefined;
  if (idempotencyKey) {
    const duplicate = await ctx.db
      .query("operationalEvents")
      .withIndex("by_organization_idempotency", (queryBuilder) =>
        queryBuilder
          .eq("organizationId", input.organizationId)
          .eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (duplicate) throw new Error("Duplicate operational event.");
  }

  const latest = await ctx.db
    .query("operationalEvents")
    .withIndex("by_organization_sequence", (queryBuilder) =>
      queryBuilder.eq("organizationId", input.organizationId),
    )
    .order("desc")
    .first();
  const recordedAt = Date.now();
  const eventWithoutHash: HashableOperationalEvent = {
    organizationId: input.organizationId,
    sequence: (latest?.sequence ?? 0) + 1,
    eventType,
    eventVersion,
    aggregateType,
    aggregateId,
    actorType: input.actor.type,
    actorUserId: input.actor.userId,
    actorMembershipId: input.actor.membershipId,
    actorRole: input.actor.role,
    actorDisplayName: input.actor.displayName?.trim() || undefined,
    occurredAt,
    recordedAt,
    summary: input.summary?.trim() || undefined,
    changedFields,
    payload:
      input.payload === undefined
        ? undefined
        : encodeOperationalEventPayload(input.payload),
    correlationId: input.correlationId?.trim() || undefined,
    causationId: input.causationId?.trim() || undefined,
    idempotencyKey,
    previousHash: latest?.hash,
  };
  return ctx.db.insert("operationalEvents", {
    ...eventWithoutHash,
    hash: hashOperationalEvent(eventWithoutHash),
  });
}

export const listOperationalEvents = query({
  args: {
    organizationId: v.id("organizations"),
    aggregateType: v.optional(v.string()),
    aggregateId: v.optional(v.string()),
    eventType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    if (!["owner", "admin", "hr", "accounting"].includes(membership.role)) {
      throw new Error("Not authorized to view operational events.");
    }
    const limit = Math.min(200, Math.max(1, Math.floor(args.limit ?? 50)));
    const candidateLimit = Math.min(1_000, limit * 10);
    const candidates =
      args.aggregateType && args.aggregateId
        ? await ctx.db
            .query("operationalEvents")
            .withIndex("by_aggregate_sequence", (queryBuilder) =>
              queryBuilder
                .eq("organizationId", args.organizationId)
                .eq("aggregateType", args.aggregateType!)
                .eq("aggregateId", args.aggregateId!),
            )
            .order("desc")
            .take(candidateLimit)
        : args.eventType
          ? await ctx.db
              .query("operationalEvents")
              .withIndex("by_organization_event_type", (queryBuilder) =>
                queryBuilder
                  .eq("organizationId", args.organizationId)
                  .eq("eventType", args.eventType!),
              )
              .order("desc")
              .take(candidateLimit)
          : await ctx.db
              .query("operationalEvents")
              .withIndex("by_organization_sequence", (queryBuilder) =>
                queryBuilder.eq("organizationId", args.organizationId),
              )
              .order("desc")
              .take(candidateLimit);
    const events = candidates
      .filter(
        (event) =>
          (!args.aggregateType || event.aggregateType === args.aggregateType) &&
          (!args.aggregateId || event.aggregateId === args.aggregateId) &&
          (!args.eventType || event.eventType === args.eventType),
      )
      .slice(0, limit)
      .map((event) => ({
        ...event,
        payload:
          event.payload && ["owner", "admin"].includes(membership.role)
            ? decodeOperationalEventPayload(event.payload)
            : undefined,
        hashValid: verifyOperationalEventHash(event),
      }));
    return { events };
  },
});
