# Convex Auth Proxy Forwarded Host Design

## Problem

The production Convex auth HTTP action returns `200` when called directly, while the same path returns `404` through the Vercel Next.js route. The `404` is emitted by the Convex edge before the HTTP action runs because the forwarded request carries `x-forwarded-host: plinth-mu.vercel.app` instead of the Convex HTTP Actions host.

## Design

Keep the existing Better Auth configuration. Replace the catch-all route's library-provided proxy with a local forwarding function that targets `NEXT_PUBLIC_CONVEX_SITE_URL`, and route the existing exported `getToken()` helper through the same sanitized forwarding boundary.

The forwarder will copy request headers and body, remove hop-by-hop and stale length headers, set `host` and `x-forwarded-host` to the Convex HTTP Actions host, and preserve the public application origin in the `x-better-auth-forwarded-host` and `x-better-auth-forwarded-proto` headers. It will return the Convex response unchanged so cookies, redirects, status codes, and response bodies continue to flow through Vercel.

## Error Handling

The module will validate that the configured target is an absolute HTTPS `.convex.site` URL. Invalid or missing configuration will fail clearly during route initialization instead of silently forwarding to an unintended host.

## Testing

A focused unit test will execute the real route and server-token forwarder with a controlled fetch implementation and assert the observable outbound request: target URL, corrected forwarded host, preserved public host metadata, request method, and body. A GET case will verify query strings and the absence of a request body.

## Success Criteria

- Direct requests through `/api/auth/*` are forwarded to the configured Convex HTTP Actions URL.
- Convex routing headers identify the `.convex.site` host.
- Better Auth still receives the original public application host through its dedicated headers.
- GET and POST requests preserve their query strings, headers, and bodies.
- Server-side `getToken()` calls use the same corrected Convex routing host.
