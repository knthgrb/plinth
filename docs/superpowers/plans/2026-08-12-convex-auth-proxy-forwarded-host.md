# Convex Auth Proxy Forwarded Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward Vercel auth requests to Convex without allowing the public Vercel hostname to select the Convex edge route.

**Architecture:** Add a focused forwarding utility in `lib` and reuse it from the catch-all auth route and the existing server-side token helper. The route exports the utility for GET and POST while `auth-server.ts` keeps its existing public API.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Convex HTTP Actions, Better Auth

## Global Constraints

- Do not change authentication behavior outside the `/api/auth/*` proxy.
- Preserve response status, headers, cookies, redirects, and body.
- Do not patch `node_modules` or fork `@convex-dev/better-auth`.
- Set routing headers to the Convex `.site` host and Better Auth metadata headers to the public app host.

---

### Task 1: Auth request forwarder

**Files:**
- Create: `apps/app/lib/convex-auth-proxy.ts`
- Modify: `apps/app/app/api/auth/[...all]/route.ts`
- Modify: `apps/app/lib/auth-server.ts`
- Test: `apps/app/tests/auth-proxy-route.test.ts`

**Interfaces:**
- Consumes: `Request`, `NEXT_PUBLIC_CONVEX_SITE_URL`, and `fetch`.
- Produces: `forwardAuthRequest(request: Request): Promise<Response>` and `getAuthToken(incomingHeaders: Headers): Promise<string | undefined>`.

- [ ] **Step 1: Write the failing tests**

Create tests that pass POST and GET requests through `forwardAuthRequest`, plus server headers through `getAuthToken`. Assert literal target URLs, target `host` and `x-forwarded-host`, original `x-better-auth-forwarded-host`, method, body, query string, and returned token.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter app test -- tests/auth-proxy-route.test.ts`

Expected: FAIL because `forward-auth-request.ts` does not exist.

- [ ] **Step 3: Implement the minimal forwarder**

Implement configuration validation, header normalization, GET/HEAD body omission, POST body forwarding, and a direct `fetch` return. Export the same function as `GET` and `POST` from `route.ts`, and make `auth-server.ts` obtain tokens through the shared sanitized proxy.

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
pnpm --filter app test -- tests/auth-proxy-route.test.ts
pnpm --filter app test
pnpm --filter app build
```

Expected: all commands exit successfully with no test failures or build errors.

- [ ] **Step 5: Review the diff**

Run: `git diff --check` and inspect only the files listed above plus these design and plan documents.
