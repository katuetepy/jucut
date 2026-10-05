/**
 * coi-serviceworker v0.1.6 - Coil's COOP/COEP Service Worker
 * Enables SharedArrayBuffer on GitHub Pages by injecting the required headers
 * via a service worker.
 * 
 * Source: https://github.com/gzuidhof/coi-serviceworker
 * License: MIT
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
);

function setCOEPHeaders(headers) {
  headers = new Headers(headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return headers;
}

self.addEventListener("fetch", function (event) {
  const r = event.request;

  if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

  event.respondWith(
    fetch(r)
      .then((response) => {
        if (response.status === 0) {
          return response;
        }

        const newHeaders = setCOEPHeaders(response.headers);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      })
      .catch((e) => console.error(e))
  );
});
