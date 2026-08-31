const APP_CACHE = "many-offline-games-v6";
const LEGACY_APP_CACHES = ["many-offline-games-v5"];
const STATE_KEY = "./__state__/hub-state-v2.json";
const LEGACY_STATE_KEYS = ["hub-state-v1"];
const GAME_CACHE_PREFIX = "./__games__/";
const LEGACY_GAME_KEYS = (gameId) => [`game:${String(gameId || "")}`];
const LOCAL_STATE_KEY = "many-offline-games-state-v2";
const DAILY_REWARDS = [100, 125, 150, 175, 200, 250, 500];

const DEFAULT_STATE = {
    coins: 0,
    lastDailyClaim: "",
    dailyStreak: 0,
    unlocked: []
};

let defaultGames = [];
let appState = { ...DEFAULT_STATE };
let purchaseTarget = null;
let purchaseBusy = false;
let currentFrameGameId = "";
let gameBlobUrl = "";

document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
});

document.addEventListener("keydown", (event) => {
    const blocked =
        event.key === "F12" ||
        (event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(event.key.toUpperCase())) ||
        (event.ctrlKey && event.key.toUpperCase() === "U");

    if (blocked) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (event.key === "Escape") {
        closePurchaseModal();
        closeRewardModal();
        closeGameModal();
    }
});

function cloneDefaultState() {
    return {
        ...DEFAULT_STATE,
        unlocked: []
    };
}

function getTodayKey() {
    const now = new Date();
    return formatDateKey(now);
}

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
        return null;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    date.setHours(12, 0, 0, 0);
    return date;
}

function daysBetween(dateA, dateB) {
    const a = parseDateKey(dateA);
    const b = parseDateKey(dateB);
    if (!a || !b) return null;
    return Math.round(Math.abs(b.getTime() - a.getTime()) / 86400000);
}

function normalizeState(data) {
    const coins = Number.isFinite(Number(data?.coins)) ? Math.max(0, Math.floor(Number(data.coins))) : 0;
    const lastDailyClaim = String(data?.lastDailyClaim || "");
    const dailyStreak = Math.max(0, Math.floor(Number(data?.dailyStreak) || 0));
    const unlocked = Array.isArray(data?.unlocked)
        ? [...new Set(data.unlocked.map(String).map((id) => id.trim()).filter(Boolean))]
        : [];

    return {
        coins,
        lastDailyClaim,
        dailyStreak,
        unlocked
    };
}

function getStateSnapshot() {
    return JSON.stringify(normalizeState(appState));
}

function persistStateLocally() {
    try {
        localStorage.setItem(LOCAL_STATE_KEY, getStateSnapshot());
    } catch (error) {
        console.warn("Local state backup is unavailable:", error);
    }
}

async function openAppCache() {
    if (!("caches" in window)) {
        return null;
    }
    return caches.open(APP_CACHE);
}

async function readState() {
    const localBackup = (() => {
        try {
            return JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || "null");
        } catch {
            return null;
        }
    })();

    try {
        const cache = await openAppCache();

        if (cache) {
            const response = await cache.match(STATE_KEY);
            if (response) {
                return normalizeState(await response.json());
            }
        }

        // Migrate the old v5 state so existing purchases survive the upgrade.
        for (const legacyCacheName of LEGACY_APP_CACHES) {
            const legacyCache = await caches.open(legacyCacheName);
            for (const legacyKey of LEGACY_STATE_KEYS) {
                const response = await legacyCache.match(legacyKey);
                if (response) {
                    const migratedState = normalizeState(await response.json());
                    appState = migratedState;
                    await saveState();
                    return migratedState;
                }
            }
        }
    } catch (error) {
        console.warn("Could not read state from Cache Storage:", error);
    }

    return normalizeState(localBackup || cloneDefaultState());
}

async function saveState() {
    const serialized = getStateSnapshot();
    persistStateLocally();

    try {
        const cache = await openAppCache();
        if (!cache) return true;

        await cache.put(
            STATE_KEY,
            new Response(serialized, {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store"
                }
            })
        );
        return true;
    } catch (error) {
        console.warn("Could not save state to Cache Storage:", error);
        return false;
    }
}

function getGameCacheKey(gameId) {
    const safeId = encodeURIComponent(String(gameId || "").trim());
    return `${GAME_CACHE_PREFIX}${safeId}.html`;
}

async function getCachedGameHtml(gameId) {
    try {
        const cache = await openAppCache();

        if (cache) {
            const response = await cache.match(getGameCacheKey(gameId));
            if (response) {
                return await response.text();
            }
        }

        // Migrate an existing v5 game HTML cache entry when possible.
        for (const legacyCacheName of LEGACY_APP_CACHES) {
            const legacyCache = await caches.open(legacyCacheName);
            for (const legacyKey of LEGACY_GAME_KEYS(gameId)) {
                const response = await legacyCache.match(legacyKey);
                if (response) {
                    const html = await response.text();
                    await setCachedGameHtml(gameId, html, "legacy-v5-cache");
                    return html;
                }
            }
        }
    } catch (error) {
        console.warn("Could not read cached game HTML:", error);
    }

    return "";
}

async function setCachedGameHtml(gameId, html, sourceUrl = "") {
    const cleanHtml = String(html || "");
    if (!cleanHtml.trim()) return false;

    try {
        const cache = await openAppCache();
        if (!cache) return false;

        await cache.put(
            getGameCacheKey(gameId),
            new Response(cleanHtml, {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "X-Game-Source": sourceUrl
                }
            })
        );
        return true;
    } catch (error) {
        console.warn("Could not cache game HTML:", error);
        return false;
    }
}

function renderCoins() {
    const coinNodes = document.querySelectorAll("[data-coin-value]");
    coinNodes.forEach((node) => {
        node.textContent = appState.coins.toLocaleString("en-US");
    });
}

function showToast(message, type = "info") {
    const toast = document.getElementById("status-toast");
    if (!toast) return;

    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("show");

    clearTimeout(showToast.timeoutId);
    showToast.timeoutId = setTimeout(() => {
        toast.classList.remove("show");
    }, 2400);
}

function isOnline() {
    return navigator.onLine;
}

function updateConnectionStatus() {
    const status = document.getElementById("connection-status");
    const dot = document.getElementById("connection-dot");
    if (!status || !dot) return;

    const online = isOnline();
    status.textContent = online ? "Online • latest code" : "Offline • cached code";
    dot.classList.toggle("connection-dot--online", online);
    dot.classList.toggle("connection-dot--offline", !online);

    updateRewardButton();
}

function getDailyStatus() {
    const today = getTodayKey();
    const last = appState.lastDailyClaim;
    const gap = last ? daysBetween(last, today) : null;
    const claimedToday = last === today;
    const streak = claimedToday
        ? Math.max(1, appState.dailyStreak || 1)
        : gap === 1
            ? Math.max(1, appState.dailyStreak || 0) + 1
            : 1;
    const cycleDay = ((streak - 1) % DAILY_REWARDS.length) + 1;

    return {
        today,
        last,
        gap,
        claimedToday,
        streak,
        cycleDay
    };
}

function getNextRewardForToday() {
    const status = getDailyStatus();
    return DAILY_REWARDS[status.cycleDay - 1];
}

function renderRewardList() {
    const rewardList = document.getElementById("reward-list");
    const claimButton = document.getElementById("claim-daily");
    const streakNode = document.getElementById("reward-streak");
    const nextText = document.getElementById("reward-next-text");
    const topText = document.getElementById("reward-button-text");

    const status = getDailyStatus();
    const cycleDay = status.cycleDay;

    if (streakNode) {
        streakNode.textContent = `${status.streak}-day streak`;
    }

    if (nextText) {
        nextText.textContent = status.claimedToday
            ? "Come back tomorrow to keep your streak."
            : `Today is Day ${cycleDay}: claim ${getNextRewardForToday()} coins.`;
    }

    if (topText) {
        topText.textContent = status.claimedToday
            ? "Claimed today"
            : `Claim +${getNextRewardForToday()}`;
    }

    if (rewardList) {
        rewardList.innerHTML = DAILY_REWARDS.map((amount, index) => {
            const day = index + 1;
            const isToday = day === cycleDay;
            const isClaimed = status.claimedToday && isToday;
            const repeatDay = day === DAILY_REWARDS.length ? " • then repeats" : "";

            return `
                <div class="reward-item ${isToday ? "reward-item--today" : ""} ${isClaimed ? "reward-item--claimed" : ""}">
                    <div>
                        <span class="reward-item__day">DAY ${day}</span>
                        <strong>${day === 7 ? "Big reward" : `Daily reward`}${repeatDay}</strong>
                    </div>
                    <span class="reward-item__value">${isClaimed ? "✓ Claimed" : `+${amount} 🪙`}</span>
                </div>
            `;
        }).join("");
    }

    if (claimButton) {
        claimButton.disabled = status.claimedToday;
        claimButton.textContent = status.claimedToday
            ? "Come back tomorrow"
            : `Claim +${getNextRewardForToday()} coins`;
    }
}

function updateRewardButton() {
    const topText = document.getElementById("reward-button-text");
    if (!topText) return;

    const status = getDailyStatus();
    topText.textContent = status.claimedToday
        ? "Claimed today"
        : `Claim +${getNextRewardForToday()}`;
}

function openModal(modal) {
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
}

function openRewardModal() {
    renderRewardList();
    openModal(document.getElementById("reward-modal"));
}

function closeRewardModal() {
    closeModal(document.getElementById("reward-modal"));
}

async function claimDailyReward() {
    const status = getDailyStatus();

    if (status.claimedToday) {
        showToast("You already claimed today's reward.", "info");
        return;
    }

    const reward = getNextRewardForToday();
    appState.coins += reward;
    appState.lastDailyClaim = status.today;
    appState.dailyStreak = status.streak;

    renderCoins();
    renderRewardList();
    await saveState();

    showToast(`Daily reward claimed: +${reward} coins!`, "success");
}

function getGameIdentifier(game) {
    if (typeof game?.id === "string" && game.id.trim()) {
        return game.id.trim();
    }

    if (typeof game?.name === "string" && game.name.trim()) {
        return game.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    if (typeof game?.path === "string" && game.path.trim()) {
        return game.path.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    return "game";
}

function getGameById(gameId) {
    return defaultGames.find((game) => getGameIdentifier(game) === String(gameId)) || null;
}

function isGameUnlocked(gameId) {
    return appState.unlocked.includes(String(gameId));
}

function renderGameHub(games = []) {
    const hub = document.getElementById("game-hub");
    const count = document.getElementById("library-count");
    if (!hub) return;

    const validGames = Array.isArray(games)
        ? games.filter((game) => game && typeof game.name === "string" && game.name.trim())
        : [];

    if (count) {
        count.textContent = `${validGames.length} ${validGames.length === 1 ? "game" : "games"}`;
    }

    if (!validGames.length) {
        hub.innerHTML = `
            <div class="empty-state">
                <span>🎮</span>
                <h3>No games yet</h3>
                <p>Add a game to games.json to grow the arcade.</p>
            </div>
        `;
        return;
    }

    hub.innerHTML = validGames.map((game) => {
        const gameId = getGameIdentifier(game);
        const cost = Number(game.cost) > 0 ? Math.floor(Number(game.cost)) : 100;
        const unlocked = isGameUnlocked(gameId);
        const icon = String(game.icon || "🎮");
        const description = String(game.description || "Play now.");

        return `
            <button class="game-card ${unlocked ? "unlocked" : "locked"}" type="button" data-game-id="${encodeURIComponent(gameId)}">
                <div class="game-card__topline">
                    <span class="game-card__icon">${icon}</span>
                    <span class="game-card__badge">${unlocked ? "OWNED" : `${cost} 🪙`}</span>
                </div>

                <div class="game-card__content">
                    <h3>${escapeHtml(String(game.name))}</h3>
                    <p>${escapeHtml(description)}</p>
                </div>

                <span class="game-card__action">
                    ${unlocked ? "▶ Play now" : "🛒 Buy game"}
                </span>
            </button>
        `;
    }).join("");
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function openPurchaseModal(game) {
    if (!game) return;

    const gameId = getGameIdentifier(game);
    const cost = Number(game.cost) > 0 ? Math.floor(Number(game.cost)) : 100;
    const name = String(game.name || "Game");
    const description = String(game.description || "Play this game offline.");
    const balanceAfter = appState.coins - cost;

    purchaseTarget = game;

    document.getElementById("purchase-title").textContent = `Buy ${name}?`;
    document.getElementById("purchase-game-name").textContent = name;
    document.getElementById("purchase-game-description").textContent = description;
    document.getElementById("purchase-icon").textContent = String(game.icon || "🎮");
    document.getElementById("purchase-cost").textContent = `${cost.toLocaleString("en-US")} 🪙`;
    document.getElementById("purchase-balance").textContent = `${appState.coins.toLocaleString("en-US")} 🪙`;
    document.getElementById("purchase-after").textContent = `${Math.max(0, balanceAfter).toLocaleString("en-US")} 🪙`;

    const note = document.getElementById("purchase-note");
    const confirmButton = document.getElementById("confirm-purchase");

    if (appState.coins < cost) {
        note.textContent = `You need ${(cost - appState.coins).toLocaleString("en-US")} more coins. Claim a daily reward first.`;
        confirmButton.disabled = true;
        confirmButton.textContent = "Not enough coins";
    } else {
        note.textContent = isOnline()
            ? "The newest game HTML will be downloaded now and kept in your offline cache."
            : "You are offline. The purchase can only continue if this game's HTML was already cached.";
        confirmButton.disabled = false;
        confirmButton.textContent = `Buy for ${cost} 🪙`;
    }

    openModal(document.getElementById("purchase-modal"));
}

function closePurchaseModal() {
    if (purchaseBusy) return;
    purchaseTarget = null;
    closeModal(document.getElementById("purchase-modal"));
}

function setPurchaseBusy(busy) {
    purchaseBusy = busy;
    const confirmButton = document.getElementById("confirm-purchase");
    const cancelButton = document.getElementById("cancel-purchase");
    if (!confirmButton || !cancelButton) return;

    confirmButton.disabled = busy;
    cancelButton.disabled = busy;
    confirmButton.textContent = busy ? "Preparing game…" : "Buy game";
}

function cleanupFrameBlob() {
    const frame = document.getElementById("game-frame");
    if (!frame) return;

    if (gameBlobUrl) {
        URL.revokeObjectURL(gameBlobUrl);
        gameBlobUrl = "";
    }

    frame.src = "about:blank";
    frame.srcdoc = "";
    delete frame.dataset.blobUrl;
}

function prepareGameHtml(html, gameUrl) {
    const sourceUrl = new URL(gameUrl, window.location.href).href;
    const baseTag = `<base href="${escapeHtml(sourceUrl)}">`;

    if (/<base\s/i.test(html)) {
        return html;
    }

    if (/<head[\s>]/i.test(html)) {
        return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    }

    return `<!doctype html><html><head>${baseTag}</head><body>${html}</body></html>`;
}

async function fetchLatestGameHtml(gameData) {
    const gameId = getGameIdentifier(gameData);
    const gameUrl = String(gameData?.path || "").trim();

    if (!gameUrl) {
        return await getCachedGameHtml(gameId);
    }

    try {
        const response = await fetch(gameUrl, {
            cache: "no-store",
            headers: { "Accept": "text/html, */*" }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        if (!html.trim()) {
            throw new Error("Empty game response");
        }

        await setCachedGameHtml(gameId, html, gameUrl);
        return html;
    } catch (error) {
        console.warn(`Latest version unavailable for ${gameId}:`, error);
        return await getCachedGameHtml(gameId);
    }
}

async function openGameModal(game) {
    if (!game) return;

    const gameId = getGameIdentifier(game);
    if (!isGameUnlocked(gameId)) {
        showToast("Buy this game first.", "info");
        return;
    }

    const title = document.getElementById("modal-title");
    const frame = document.getElementById("game-frame");

    if (!title || !frame) return;

    title.textContent = String(game.name || "Game");
    currentFrameGameId = gameId;

    cleanupFrameBlob();

    const html = await fetchLatestGameHtml(game);

    if (!html) {
        showToast(
            isOnline()
                ? "Could not load the game right now."
                : "This game has not been cached for offline play yet.",
            "error"
        );
        currentFrameGameId = "";
        return;
    }

    const preparedHtml = prepareGameHtml(html, String(game.path || window.location.href));
    frame.srcdoc = preparedHtml;

    openModal(document.getElementById("game-modal"));
}

function closeGameModal() {
    currentFrameGameId = "";
    cleanupFrameBlob();
    closeModal(document.getElementById("game-modal"));
}

async function purchaseGame(gameData) {
    if (purchaseBusy || !gameData) return;

    const gameId = getGameIdentifier(gameData);
    const cost = Number(gameData.cost) > 0 ? Math.floor(Number(gameData.cost)) : 100;

    if (isGameUnlocked(gameId)) {
        closePurchaseModal();
        await openGameModal(gameData);
        return;
    }

    if (appState.coins < cost) {
        closePurchaseModal();
        showToast(`You need ${(cost - appState.coins).toLocaleString("en-US")} more coins.`, "error");
        return;
    }

    setPurchaseBusy(true);

    try {
        // First obtain the newest online HTML. If online fails, use the previous cached HTML.
        const html = await fetchLatestGameHtml(gameData);

        if (!html) {
            throw new Error("No online version and no cached version are available.");
        }

        // The transaction only commits after content availability is confirmed.
        if (isGameUnlocked(gameId)) {
            closePurchaseModal();
            await openGameModal(gameData);
            return;
        }

        appState.coins -= cost;
        appState.unlocked = [...new Set([...appState.unlocked, gameId])];

        renderCoins();
        renderGameHub(defaultGames);
        await saveState();

        closePurchaseModal();
        showToast(
            isOnline()
                ? `${gameData.name} purchased and cached with the latest version.`
                : `${gameData.name} purchased from your offline cache.`,
            "success"
        );

        await openGameModal(gameData);
    } catch (error) {
        console.error("Purchase cancelled:", error);
        showToast(
            isOnline()
                ? "Purchase cancelled: the latest game could not be downloaded."
                : "Purchase cancelled: this game is not cached yet.",
            "error"
        );
    } finally {
        setPurchaseBusy(false);
    }
}

async function loadGamesList() {
    try {
        const response = await fetch("games.json", {
            cache: "no-store",
            headers: { "Accept": "application/json" }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const games = Array.isArray(data) ? data : Object.values(data);
        defaultGames = games;
        renderGameHub(games);
    } catch (error) {
        console.warn("Could not load the newest games list; trying cache:", error);

        try {
            const cache = await openAppCache();
            const cached = cache ? await cache.match("games.json") : null;

            if (!cached) {
                throw error;
            }

            const data = await cached.json();
            defaultGames = Array.isArray(data) ? data : Object.values(data);
            renderGameHub(defaultGames);
            showToast("Using your cached game list.", "info");
        } catch (cacheError) {
            console.error("Could not load games.json:", cacheError);
            renderGameHub([]);
            showToast("The game list could not be loaded.", "error");
        }
    }
}

async function initializeApp() {
    appState = await readState();

    renderCoins();
    renderRewardList();
    updateConnectionStatus();

    window.addEventListener("online", () => {
        updateConnectionStatus();
        showToast("Back online. New game code will be used when you open a game.", "success");
        loadGamesList();
    });

    window.addEventListener("offline", () => {
        updateConnectionStatus();
        showToast("Offline mode: cached games remain available.", "info");
    });

    document.getElementById("reward-button")?.addEventListener("click", openRewardModal);
    document.getElementById("close-reward")?.addEventListener("click", closeRewardModal);
    document.getElementById("claim-daily")?.addEventListener("click", claimDailyReward);

    document.getElementById("close-purchase")?.addEventListener("click", closePurchaseModal);
    document.getElementById("cancel-purchase")?.addEventListener("click", closePurchaseModal);
    document.getElementById("confirm-purchase")?.addEventListener("click", async () => {
        if (purchaseTarget) {
            await purchaseGame(purchaseTarget);
        }
    });

    document.getElementById("close-game")?.addEventListener("click", closeGameModal);

    document.querySelectorAll(".app-modal, .game-modal").forEach((modal) => {
        modal.addEventListener("click", (event) => {
            if (event.target !== modal) return;

            if (modal.id === "purchase-modal") closePurchaseModal();
            if (modal.id === "reward-modal") closeRewardModal();
            if (modal.id === "game-modal") closeGameModal();
        });
    });

    document.getElementById("game-hub")?.addEventListener("click", async (event) => {
        const card = event.target.closest(".game-card");
        if (!card) return;

        const encodedId = card.dataset.gameId || "";
        const gameId = decodeURIComponent(encodedId);
        const game = getGameById(gameId);

        if (!game) {
            showToast("That game is no longer available in the current list.", "error");
            return;
        }

        if (isGameUnlocked(gameId)) {
            await openGameModal(game);
        } else {
            openPurchaseModal(game);
        }
    });

    if ("serviceWorker" in navigator && window.isSecureContext) {
        try {
            await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
        } catch (error) {
            console.warn("Service worker registration failed:", error);
        }

        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!navigator.serviceWorker.controller) return;
            window.location.reload();
        });
    }

    await loadGamesList();
}

document.addEventListener("DOMContentLoaded", initializeApp);
