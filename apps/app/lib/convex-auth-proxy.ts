const getConvexSiteUrl = () => {
  const configuredUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

  if (!configuredUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_SITE_URL is not configured");
  }

  const siteUrl = new URL(configuredUrl);
  if (
    siteUrl.protocol !== "https:" ||
    !siteUrl.hostname.endsWith(".convex.site")
  ) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_SITE_URL must be an HTTPS Convex site URL",
    );
  }

  return siteUrl;
};

export async function forwardAuthRequest(request: Request) {
  const requestUrl = new URL(request.url);
  const siteUrl = getConvexSiteUrl();
  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, siteUrl);
  const headers = new Headers(request.headers);

  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("accept-encoding", "identity");
  headers.set("host", siteUrl.host);
  headers.set("x-forwarded-host", siteUrl.host);
  headers.set("x-forwarded-proto", siteUrl.protocol.slice(0, -1));
  headers.set("x-better-auth-forwarded-host", requestUrl.host);
  headers.set(
    "x-better-auth-forwarded-proto",
    requestUrl.protocol.slice(0, -1),
  );

  const init: RequestInit = {
    headers,
    method: request.method,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) {
      init.body = body;
    }
  }

  return fetch(targetUrl, init);
}

export async function getAuthToken(incomingHeaders: Headers) {
  const publicHost =
    incomingHeaders.get("x-forwarded-host") ?? incomingHeaders.get("host");
  if (!publicHost) {
    throw new Error("Unable to determine the public application host");
  }

  const forwardedProtocol = incomingHeaders.get("x-forwarded-proto");
  const publicProtocol = forwardedProtocol === "http" ? "http" : "https";
  const tokenRequest = new Request(
    `${publicProtocol}://${publicHost}/api/auth/convex/token`,
    { headers: incomingHeaders },
  );
  const response = await forwardAuthRequest(tokenRequest);

  if (!response.ok) {
    return undefined;
  }

  const data: unknown = await response.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("token" in data) ||
    typeof data.token !== "string"
  ) {
    return undefined;
  }

  return data.token;
}
