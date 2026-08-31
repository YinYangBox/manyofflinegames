const SW_VERSION = "many-offline-games-sw-v6";

const APP_SHELL_CACHE = "many-offline-games-v6";
const GAME_CACHE = "many-offline-games-content-v6";

const APP_SHELL = [
    "./",
    "./index.html",
    "./script.js",
    "./style.css",
    "./games.json"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter(
                            (key) =>
                                key.startsWith("many-offline-games-") &&
                                key !== APP_SHELL_CACHE &&
                                key !== GAME_CACHE &&
                                key !== "many-offline-games-v5"
                        )
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

function isGamesApiRequest(url) {
    return url.pathname.endsWith("/games.json");
}

function isGameProxyRequest(url) {
    return url.pathname.includes("/.netlify/functions/proxy");
}

async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request, {
            cache: "no-store"
        });

        if (response && response.ok) {
            const cache = await caches.open(cacheName);
            await cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        const cached = await caches.match(request);

        if (cached) {
            return cached;
        }

        throw error;
    }
}

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // ==========================================
    // JUEGOS
    // ==========================================
    //
    // ONLINE:
    //   Netlify Function -> versión más reciente
    //   -> se guarda en GAME_CACHE
    //
    // OFFLINE:
    //   usa la última versión guardada
    //
    if (isGameProxyRequest(url)) {
        event.respondWith(
            networkFirst(request, GAME_CACHE)
        );
        return;
    }

    // ==========================================
    // NAVEGACIÓN / HUB
    // ==========================================

    if (request.mode === "navigate") {
        event.respondWith(
            networkFirst(request, APP_SHELL_CACHE)
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    // ==========================================
    // GAMES.JSON
    // ==========================================

    if (isGamesApiRequest(url)) {
        event.respondWith(
            networkFirst(request, APP_SHELL_CACHE)
                .catch(() => caches.match("./games.json"))
        );
        return;
    }

    // ==========================================
    // ARCHIVOS DEL HUB
    // ==========================================

    if (
        url.origin === self.location.origin &&
        (
            url.pathname.endsWith("/index.html") ||
            url.pathname.endsWith("/script.js") ||
            url.pathname.endsWith("/style.css")
        )
    ) {
        event.respondWith(
            networkFirst(request, APP_SHELL_CACHE)
                .catch(() => caches.match(request))
        );
    }
});