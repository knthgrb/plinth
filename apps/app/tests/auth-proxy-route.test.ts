import { afterEach, describe, expect, it, vi } from "vitest";

const CONVEX_SITE_URL = "https://tough-gnat-729.convex.site";
const APP_URL = "https://plinth-mu.vercel.app";

async function loadRoute() {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://tough-gnat-729.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", CONVEX_SITE_URL);
  vi.resetModules();
  return import("../app/api/auth/[...all]/route");
}

function captureOutboundRequest() {
  let outboundRequest: Request | undefined;
  const upstreamResponse = new Response(null, {
    status: 204,
    headers: { "set-cookie": "session=updated; Path=/; HttpOnly" },
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      outboundRequest = new Request(input, init);
      return upstreamResponse;
    }),
  );

  return {
    getOutboundRequest: () => outboundRequest,
    upstreamResponse,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Convex auth proxy", () => {
  it("routes GET requests using the Convex site host", async () => {
    const { GET } = await loadRoute();
    const capture = captureOutboundRequest();
    const request = new Request(`${APP_URL}/api/auth/get-session?refresh=true`, {
      headers: {
        "x-forwarded-host": "plinth-mu.vercel.app",
        "x-forwarded-proto": "https",
      },
    });

    const response = await GET(request);
    const outbound = capture.getOutboundRequest();

    expect(response).toBe(capture.upstreamResponse);
    expect(outbound?.url).toBe(
      `${CONVEX_SITE_URL}/api/auth/get-session?refresh=true`,
    );
    expect(outbound?.method).toBe("GET");
    expect(outbound?.headers.get("host")).toBe("tough-gnat-729.convex.site");
    expect(outbound?.headers.get("x-forwarded-host")).toBe(
      "tough-gnat-729.convex.site",
    );
    expect(outbound?.headers.get("x-better-auth-forwarded-host")).toBe(
      "plinth-mu.vercel.app",
    );
    expect(outbound?.body).toBeNull();
  });

  it("forwards POST bodies without stale transport headers", async () => {
    const { POST } = await loadRoute();
    const capture = captureOutboundRequest();
    const body = JSON.stringify({ email: "person@example.com" });
    const request = new Request(`${APP_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-length": String(Buffer.byteLength(body)),
        "content-type": "application/json",
        "x-forwarded-host": "plinth-mu.vercel.app",
        "x-forwarded-proto": "https",
      },
      body,
    });

    const response = await POST(request);
    const outbound = capture.getOutboundRequest();

    expect(response).toBe(capture.upstreamResponse);
    expect(outbound?.headers.get("content-length")).toBeNull();
    expect(outbound?.headers.get("content-type")).toBe("application/json");
    expect(outbound?.headers.get("x-forwarded-host")).toBe(
      "tough-gnat-729.convex.site",
    );
    expect(outbound?.headers.get("x-better-auth-forwarded-host")).toBe(
      "plinth-mu.vercel.app",
    );
    expect(await outbound?.text()).toBe(body);
  });

  it("gets server-side auth tokens through the corrected Convex host", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://tough-gnat-729.convex.cloud");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", CONVEX_SITE_URL);

    const incomingHeaders = new Headers({
      cookie: "better-auth.session_token=session-token",
      host: "plinth-mu.vercel.app",
      "x-forwarded-host": "plinth-mu.vercel.app",
      "x-forwarded-proto": "https",
    });
    let outboundRequest: Request | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        outboundRequest = new Request(input, init);
        return Response.json({ token: "convex-token" });
      }),
    );
    vi.resetModules();

    const authProxy = await import("../lib/convex-auth-proxy");
    const getAuthToken = Reflect.get(authProxy, "getAuthToken");

    expect(getAuthToken).toBeTypeOf("function");

    const token = await getAuthToken(incomingHeaders);

    expect(token).toBe("convex-token");
    expect(outboundRequest?.url).toBe(
      `${CONVEX_SITE_URL}/api/auth/convex/token`,
    );
    expect(outboundRequest?.headers.get("x-forwarded-host")).toBe(
      "tough-gnat-729.convex.site",
    );
    expect(
      outboundRequest?.headers.get("x-better-auth-forwarded-host"),
    ).toBe("plinth-mu.vercel.app");
  });
});
