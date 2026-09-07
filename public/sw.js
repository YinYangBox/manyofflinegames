/* Many Offline Games
 * Online: network only.
 * Offline: saved files.
 * Existing game and progress caches are preserved.
 */

const SHELL_CACHE = "many-offline-games-shell-v7";

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);

        await Promise.allSettled(
            ["./", "./games.json"].map(async path => {
                const url = new URL(
                    path,
                    self.registration.scope
                ).href;

                const response = await fetch(url, {
                    cache: "no-store"
                });

                if (response.ok) {
                    await cache.put(url, response);
                }
            })
        );

        await self.skipWaiting();
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);

    if (
        request.method !== "GET" ||
        url.origin !== self.location.origin
    ) {
        return;
    }

    // Fresh game requests never fall back to an old copy.
    // The store saves successful responses separately.
    if (url.searchParams.has("_arcadeFresh")) {
        event.respondWith(
            fetch(new Request(request, {
                cache: "no-store"
            }))
        );
        return;
    }

    const isProxy = url.pathname.endsWith(
        "/api/proxy"
    );

    // Do not cache payments or other server functions.
    if (
        url.pathname.includes("/api/") &&
        !isProxy
    ) {
        return;
    }

    const isAsset =
        /\.(?:html?|js|css|json|png|jpe?g|svg|webp|ico|woff2?)$/i
            .test(url.pathname);

    if (
        request.mode !== "navigate" &&
        !isAsset &&
        !isProxy
    ) {
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(SHELL_CACHE);

        if (!self.navigator.onLine) {
            const cached =
                await cache.match(request) ||
                await caches.match(request);

            if (cached) {
                return cached;
            }

            if (request.mode === "navigate") {
                const homeUrl = new URL(
                    "./",
                    self.registration.scope
                ).href;

                const home = await cache.match(homeUrl);

                if (home) {
                    return home;
                }
            }

            return new Response(
                "This file is not available offline yet.",
                {
                    status: 503,
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8"
                    }
                }
            );
        }

        // An online error stays an error.
        // It must not silently return an outdated script.
        const response = await fetch(
            new Request(request, {
                cache: "no-store"
            })
        );

        if (response.ok) {
            try {
                await cache.put(request, response.clone());
            } catch (error) {
                console.warn(
                    "Offline copy could not be updated:",
                    error
                );
            }
        }

        return response;
    })());
});