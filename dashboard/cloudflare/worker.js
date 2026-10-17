function failure(status, message) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    // Only public storefront routes can pass this gateway.
    const path = url.pathname.slice(4);
    const readable = /^\/public\/shops\/[A-Za-z0-9_-]+\/(catalog|settings|taxonomy\/(categories|collections))\/?$/.test(path);
    const writable = /^\/public\/shops\/[A-Za-z0-9_-]+\/(quote|checkout|track-order)\/?$/.test(path);
    if (!((readable && ["GET", "HEAD"].includes(request.method)) || (writable && request.method === "POST"))) return failure(404, "Not found.");
    if (!env.API_PROXY_SECRET || env.API_PROXY_SECRET.length < 32) return failure(503, "The API gateway has not been configured.");
    let origin;
    try {
      origin = new URL(env.API_ORIGIN);
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || origin.hostname.endsWith(".invalid")) throw new Error("Invalid origin");
    } catch { return failure(503, "The API origin has not been configured."); }
    // The client cannot choose another target via its path or query string.
    origin.pathname = url.pathname.slice(4) || "/";
    origin.search = url.search;
    const headers = new Headers(request.headers);
    for (const name of ["host", "connection", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-pos-client-ip"]) headers.delete(name);
    headers.delete("Authorization");
    headers.delete("Cookie");
    headers.set("X-Forwarded-Proto", "https");
    headers.set("X-Forwarded-Host", url.host);
    // Always replace a client-supplied gateway header with the Worker secret.
    headers.set("X-POS-Proxy-Token", env.API_PROXY_SECRET);
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return failure(403, "The API gateway could not identify the client.");
    if (writable) {
      // Anonymous customers have no authenticated user ID. A generous per-route
      // IP ceiling limits bursts while allowing shared mobile-network addresses.
      // Cloudflare enforces this approximately per edge location, not globally.
      if (!env.PUBLIC_REQUEST_LIMITER) return failure(503, "The request guard has not been configured.");
      try {
        const { success } = await env.PUBLIC_REQUEST_LIMITER.limit({ key: `${path}:${ip}` });
        if (!success) {
          const response = failure(429, "Too many requests. Please try again shortly.");
          response.headers.set("Retry-After", "60");
          return response;
        }
      } catch { return failure(503, "Please try again shortly."); }
    }
    // Cloudflare supplies this address; intermediary proxy chains cannot replace it.
    headers.set("X-POS-Client-IP", ip);
    headers.set("X-Forwarded-For", ip);
    try {
      const upstreamRequest = new Request(origin, new Request(request, { headers, redirect: "manual" }));
      const upstream = await fetch(upstreamRequest, { redirect: "manual", cf: { cacheEverything: false, cacheTtl: 0 } });
      // Following redirects could disclose credentials to another origin.
      if (upstream.status >= 300 && upstream.status < 400) return failure(502, "The API returned an unexpected redirect.");
      const response = new Response(upstream.body, upstream);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Pragma", "no-cache");
      response.headers.delete("Set-Cookie");
      return response;
    } catch { return failure(502, "The API is temporarily unavailable."); }
  },
};
