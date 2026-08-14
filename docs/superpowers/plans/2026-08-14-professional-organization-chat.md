# Professional Organization Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing organization chat into a secure, focused communication module with official channels, private conversations, reliable message actions, scoped attachments, and a polished responsive interface.

**Architecture:** Keep Convex as the authorization and realtime source of truth. Normalize message reactions and per-user conversation preferences, preserve message history with tombstones instead of participant-triggered hard deletion, and scope cached data and attachments to the authenticated participant. Split shared chat projection types and UI helpers out of the current oversized components.

**Tech Stack:** Next.js 16, React 19, TypeScript, Convex, Vitest, Tailwind CSS, Radix UI.

## Global Constraints

- Only active organization memberships can use chat; alumni and removed memberships cannot read cached or server chat data.
- Owner, Admin, and HR can create and manage official organization channels.
- Every active organization member can start direct messages and private group conversations.
- No new or touched chat code may use the TypeScript `any` type.
- Shared history is never hard-deleted by an ordinary participant.
- Message bodies remain compatible with the existing encrypted-message format.

---

### Task 1: Authorization and lifecycle contracts

**Files:**
- Create: `apps/app/tests/chat-professional-workflow.test.ts`
- Modify: `apps/app/convex/chat.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`

**Interfaces:**
- Produces: official-channel role enforcement, participant-scoped attachment reads, archival/leave mutations, message tombstones, and normalized reaction/preference tables.

- [ ] Write Convex tests proving ordinary employees cannot create official channels, non-participants cannot read chat attachments, ordinary participants cannot destroy shared history, and alumni cannot use any new endpoint.
- [ ] Run the focused tests and confirm they fail for the missing contracts.
- [ ] Add the minimum schema and Convex authorization changes required by the tests.
- [ ] Re-run the focused tests and schema inventory tests until green.

### Task 2: Message actions and conversation preferences

**Files:**
- Modify: `apps/app/tests/chat-professional-workflow.test.ts`
- Modify: `apps/app/convex/chat.ts`
- Create: `apps/app/lib/chat/types.ts`

**Interfaces:**
- Produces: `toggleMessageReaction`, `editMessage`, `deleteMessage`, `leaveConversation`, `archiveConversation`, `setConversationMuted`, and typed chat projections.

- [ ] Add failing tests for reaction toggling, optimistic-compatible reaction projections, author edit windows, audit-safe deletion, channel moderation, leave behavior, and mute preferences.
- [ ] Run the tests and confirm each failure represents the missing behavior.
- [ ] Implement the smallest typed mutation/query surface that satisfies the contracts.
- [ ] Re-run focused tests and refactor duplicate authorization/projection logic while green.

### Task 3: Cache and attachment isolation

**Files:**
- Create: `apps/app/tests/chat-cache-isolation.test.ts`
- Modify: `apps/app/services/chat-cache-service.ts`
- Modify: `apps/app/app/[organizationId]/chat/_components/chat-file-attachment.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/chat-area.tsx`

**Interfaces:**
- Consumes: participant-scoped `getChatAttachmentUrl` from Task 1.
- Produces: a cache namespace keyed by organization and user, plus cache clearing when authorization disappears.

- [ ] Add failing unit tests proving cache keys include the current user and cached rows from a different user are rejected.
- [ ] Run the cache test and confirm the existing organization-only cache fails it.
- [ ] Type the cache records and implement user-scoped initialization and clearing.
- [ ] Switch attachment preview to the message-scoped endpoint and gate hydration on an authorized conversation projection.
- [ ] Re-run cache, attachment, and lifecycle security tests.

### Task 4: Professional chat interface

**Files:**
- Modify: `apps/app/app/[organizationId]/chat/page.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/conversation-list.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/chat-area.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/create-channel-modal.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/create-group-chat-modal.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/new-chat-modal.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/add-members-modal.tsx`
- Modify: `apps/app/app/[organizationId]/chat/_components/forward-message-modal.tsx`
- Create: `apps/app/app/[organizationId]/chat/_components/browse-channels-modal.tsx`
- Create: `apps/app/app/[organizationId]/chat/_components/message-actions.tsx`

**Interfaces:**
- Consumes: typed projections and mutations from Tasks 1–3.
- Produces: searchable conversation navigation, discoverable official channels, responsive thread UI, optimistic reactions, edit/delete controls, mute/leave/archive controls, and accessible loading/error/empty states.

- [ ] Add source-level UI contract tests for role-aware channel controls, working reaction handlers, conversation search, and removal of destructive participant deletion.
- [ ] Run the UI contract tests and confirm they fail against the current components.
- [ ] Replace `any`-based chat props/query casts with shared projection types and direct generated API references.
- [ ] Rework the sidebar into searchable pinned/unread/conversation sections and add official-channel browsing.
- [ ] Rework the thread header, message grouping, message action menu, composer, and mobile presentation.
- [ ] Implement optimistic reaction updates with automatic Convex rollback on mutation failure.
- [ ] Re-run focused UI and TypeScript/build verification.

### Task 5: Performance and final verification

**Files:**
- Modify: `apps/app/convex/chat.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/components/layout/sidebar.tsx`
- Modify: `apps/app/tests/chat-professional-workflow.test.ts`

**Interfaces:**
- Produces: bounded indexed message pagination and unread aggregation compatible with muted conversations.

- [ ] Add failing tests for bounded pagination and muted unread totals.
- [ ] Add required indexes and replace full-history collection paths with bounded queries.
- [ ] Run focused chat/security/schema tests.
- [ ] Run the full Vitest suite.
- [ ] Run the production build and review the final diff for scope, `any`, and destructive behavior.
