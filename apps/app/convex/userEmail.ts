import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type UserLookupContext = Pick<QueryCtx | MutationCtx, "db">;
const LEGACY_EMAIL_LOOKUP_LIMIT = 100;

export function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(
  ctx: UserLookupContext,
  email: string,
): Promise<Doc<"users"> | null> {
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail) return null;

  const [exactMatches, normalizedMatches, legacyUsers] = await Promise.all([
    ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", email.trim()))
      .take(2),
    ctx.db
      .query("users")
      .withIndex("by_normalized_email", (query) =>
        query.eq("normalizedEmail", normalizedEmail),
      )
      .take(2),
    ctx.db
      .query("users")
      .withIndex("by_normalized_email", (query) =>
        query.eq("normalizedEmail", undefined),
      )
      .take(LEGACY_EMAIL_LOOKUP_LIMIT + 1),
  ]);

  const candidates = new Map<string, Doc<"users">>();
  for (const user of [...exactMatches, ...normalizedMatches, ...legacyUsers]) {
    if (normalizeUserEmail(user.email) === normalizedEmail) {
      candidates.set(user._id, user);
    }
  }
  if (candidates.size > 1) {
    throw new Error("Multiple user accounts share this email address");
  }
  if (legacyUsers.length > LEGACY_EMAIL_LOOKUP_LIMIT) {
    throw new Error("User email migration is incomplete");
  }
  return candidates.values().next().value ?? null;
}

export async function assertUserEmailAvailable(
  ctx: UserLookupContext,
  email: string,
  exceptUserId?: Id<"users">,
): Promise<void> {
  const existingUser = await findUserByEmail(ctx, email);
  if (existingUser && existingUser._id !== exceptUserId) {
    throw new Error("A user account already owns this email address");
  }
}
