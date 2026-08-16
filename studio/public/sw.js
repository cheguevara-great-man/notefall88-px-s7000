const CACHE_PREFIX = "notefall-studio-";
const INJECTED_VERSION = "__NOTEFALL_CACHE_VERSION__";
const CACHE_VERSION = INJECTED_VERSION.startsWith("__") ? "dev" : INJECTED_VERSION;
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const CORE_FALLBACK = ["./", "./index.html", "./manifest.webmanifest", "./studio-icon.svg"];
const CORE = self.__NOTEFALL_PRECACHE__ ?? CORE_FALLBACK;
const INTEGRITY = self.__NOTEFALL_INTEGRITY__ ?? {};
const INDEX_URL = new URL("./index.html", self.registration.scope).href;
const PRECACHE_URLS = new Set(CORE.map((path) => new URL(path, self.registration.scope).href));

async function sha256(response) {
  const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cachedResponse(cache, request, url) {
  const cached = await cache.match(url.href);
  if (!cached) return undefined;
  const range = request.headers.get("range");
  if (!range) return cached;

  const bytes = await cached.arrayBuffer();
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
  }
  const suffix = !match[1] ? Number(match[2]) : undefined;
  const start = suffix === undefined ? Number(match[1]) : Math.max(0, bytes.byteLength - suffix);
  const requestedEnd = match[2] && suffix === undefined ? Number(match[2]) : bytes.byteLength - 1;
  const end = Math.min(requestedEnd, bytes.byteLength - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
  }
  const headers = new Headers(cached.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Bypass the HTTP cache, then verify every byte against the build-time
      // manifest. A partially deployed release fails installation atomically.
      await cache.addAll(CORE.map((path) => new Request(path, { cache: "reload" })));
      for (const [path, expected] of Object.entries(INTEGRITY)) {
        const response = await cache.match(path);
        if (!response || await sha256(response) !== expected) {
          throw new Error(`precache integrity mismatch: ${path}`);
        }
      }
      // Do not force activation: the old page and old cache remain a matched
      // pair until all old clients close, then this release activates intact.
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    // Serve HTML and its hashed assets from one atomic release. A newly
    // installed worker takes over on the next navigation without mixing an old
    // index with new chunks (or vice versa).
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(INDEX_URL);
      return cached ?? fetch(event.request);
    }));
    return;
  }

  // Only intercept immutable build-time entries. Dynamic same-origin requests
  // remain network-only and can never be replayed from a stale runtime cache.
  if (!PRECACHE_URLS.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cachedResponse(cache, event.request, url);
    return cached ?? fetch(event.request);
  }));
});
