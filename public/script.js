
const APP_CACHE = "many-offline-games-v6";
const LEGACY_APP_CACHES = ["many-offline-games-v5"];

const STATE_KEY = "./__state__/hub-state-v2.json";
const LEGACY_STATE_KEYS = ["hub-state-v1"];

const LOCAL_COINS_KEY = "many-offline-games-coins-v1";
const LEGACY_LOCAL_STATE_KEY = "many-offline-games-state-v2";

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


// ======================================================
// BASIC PROTECTION
// ======================================================

document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
});

document.addEventListener("keydown", (event) => {
    const blocked =
        event.key === "F12" ||
        (
            event.ctrlKey &&
            event.shiftKey &&
            ["I", "J", "C"].includes(
                event.key.toUpperCase()
            )
        ) ||
        (
            event.ctrlKey &&
            event.key.toUpperCase() === "U"
        );

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


// ======================================================
// STATE
// ======================================================

function cloneDefaultState() {
    return {
        ...DEFAULT_STATE,
        unlocked: []
    };
}

function normalizeState(data) {
    const dailyStreak = Math.max(
        0,
        Math.floor(Number(data?.dailyStreak) || 0)
    );

    const lastDailyClaim = String(
        data?.lastDailyClaim || ""
    );

    const unlocked = Array.isArray(data?.unlocked)
        ? [
            ...new Set(
                data.unlocked
                    .map(String)
                    .map((id) => id.trim())
                    .filter(Boolean)
            )
        ]
        : [];

    return {
        coins: 0,
        lastDailyClaim,
        dailyStreak,
        unlocked
    };
}

function getCachedStateSnapshot() {
    return JSON.stringify({
        lastDailyClaim: appState.lastDailyClaim,
        dailyStreak: appState.dailyStreak,
        unlocked: appState.unlocked
    });
}

function readLocalCoins() {
    try {
        const value = localStorage.getItem(
            LOCAL_COINS_KEY
        );

        if (value !== null) {
            const coins = Number(value);

            if (Number.isFinite(coins)) {
                return Math.max(
                    0,
                    Math.floor(coins)
                );
            }
        }
    } catch (error) {
        console.warn(
            "Could not read local coins:",
            error
        );
    }

    return null;
}

function saveLocalCoins() {
    try {
        localStorage.setItem(
            LOCAL_COINS_KEY,
            String(
                Math.max(
                    0,
                    Math.floor(
                        Number(appState.coins) || 0
                    )
                )
            )
        );
    } catch (error) {
        console.warn(
            "Could not save local coins:",
            error
        );
    }
}

function readLegacyLocalState() {
    try {
        return JSON.parse(
            localStorage.getItem(
                LEGACY_LOCAL_STATE_KEY
            ) || "null"
        );
    } catch {
        return null;
    }
}

async function openAppCache() {
    if (!("caches" in window)) {
        return null;
    }

    return caches.open(APP_CACHE);
}

async function readState() {
    let cachedState = null;

    // Current Cache Storage state
    try {
        const cache = await openAppCache();

        if (cache) {
            const response = await cache.match(
                STATE_KEY
            );

            if (response) {
                cachedState = normalizeState(
                    await response.json()
                );
            }
        }
    } catch (error) {
        console.warn(
            "Could not read current cached state:",
            error
        );
    }

    // Legacy Cache Storage migration
    if (!cachedState) {
        try {
            for (
                const legacyCacheName of LEGACY_APP_CACHES
            ) {
                const legacyCache =
                    await caches.open(
                        legacyCacheName
                    );

                for (
                    const legacyKey of LEGACY_STATE_KEYS
                ) {
                    const response =
                        await legacyCache.match(
                            legacyKey
                        );

                    if (response) {
                        const legacyData =
                            await response.json();

                        cachedState =
                            normalizeState(
                                legacyData
                            );

                        break;
                    }
                }

                if (cachedState) {
                    break;
                }
            }
        } catch (error) {
            console.warn(
                "Could not migrate legacy state:",
                error
            );
        }
    }

    if (!cachedState) {
        cachedState = cloneDefaultState();

        // Migrate old localStorage state only
        // when the new coins key does not exist.
        const legacyLocalState =
            readLegacyLocalState();

        if (
            legacyLocalState &&
            Array.isArray(
                legacyLocalState.unlocked
            )
        ) {
            cachedState.unlocked =
                [
                    ...new Set(
                        legacyLocalState.unlocked
                            .map(String)
                            .map((id) =>
                                id.trim()
                            )
                            .filter(Boolean)
                    )
                ];

            cachedState.lastDailyClaim =
                String(
                    legacyLocalState.lastDailyClaim ||
                    ""
                );

            cachedState.dailyStreak =
                Math.max(
                    0,
                    Math.floor(
                        Number(
                            legacyLocalState.dailyStreak
                        ) || 0
                    )
                );
        }
    }

    // Coins are ONLY read from localStorage.
    const localCoins = readLocalCoins();

    if (localCoins !== null) {
        cachedState.coins = localCoins;
    } else {
        // One-time migration of old coins value.
        const legacyLocalState =
            readLegacyLocalState();

        const migratedCoins =
            Number(legacyLocalState?.coins);

        cachedState.coins =
            Number.isFinite(migratedCoins)
                ? Math.max(
                    0,
                    Math.floor(
                        migratedCoins
                    )
                )
                : 0;

        saveLocalCoins();
    }

    appState = normalizeState(cachedState);

    // normalizeState intentionally ignores coins,
    // so restore them separately.
    appState.coins =
        readLocalCoins() ??
        cachedState.coins ??
        0;

    return appState;
}

async function saveState() {
    // Coins -> ONLY localStorage
    saveLocalCoins();

    // Purchases + daily reward -> Cache Storage
    try {
        const cache = await openAppCache();

        if (!cache) {
            return true;
        }

        await cache.put(
            STATE_KEY,
            new Response(
                getCachedStateSnapshot(),
                {
                    headers: {
                        "Content-Type":
                            "application/json; charset=utf-8",
                        "Cache-Control":
                            "no-store"
                    }
                }
            )
        );

        return true;
    } catch (error) {
        console.warn(
            "Could not save game state:",
            error
        );

        return false;
    }
}


// ======================================================
// DATE / DAILY REWARD
// ======================================================

function getTodayKey() {
    return formatDateKey(
        new Date()
    );
}

function formatDateKey(date) {
    const year =
        date.getFullYear();

    const month =
        String(
            date.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            date.getDate()
        ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            String(value || "")
        )
    ) {
        return null;
    }

    const [
        year,
        month,
        day
    ] = value.split("-").map(Number);

    const date =
        new Date(
            year,
            month - 1,
            day
        );

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    date.setHours(
        12,
        0,
        0,
        0
    );

    return date;
}

function daysBetween(dateA, dateB) {
    const a = parseDateKey(dateA);
    const b = parseDateKey(dateB);

    if (!a || !b) {
        return null;
    }

    return Math.round(
        Math.abs(
            b.getTime() -
            a.getTime()
        ) / 86400000
    );
}

function getDailyStatus() {
    const today = getTodayKey();
    const last = appState.lastDailyClaim;

    const gap = last
        ? daysBetween(last, today)
        : null;

    const claimedToday =
        last === today;

    const streak =
        claimedToday
            ? Math.max(
                1,
                appState.dailyStreak || 1
            )
            : gap === 1
                ? Math.max(
                    1,
                    appState.dailyStreak || 0
                ) + 1
                : 1;

    const cycleDay =
        ((streak - 1) %
            DAILY_REWARDS.length) + 1;

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
    const status =
        getDailyStatus();

    return DAILY_REWARDS[
        status.cycleDay - 1
    ];
}


// ======================================================
// UI STATE
// ======================================================

function renderCoins() {
    const coinNodes =
        document.querySelectorAll(
            "[data-coin-value]"
        );

    coinNodes.forEach((node) => {
        node.textContent =
            appState.coins.toLocaleString(
                "en-US"
            );
    });
}

function showToast(
    message,
    type = "info"
) {
    const toast =
        document.getElementById(
            "status-toast"
        );

    if (!toast) {
        return;
    }

    toast.textContent =
        message;

    toast.dataset.type =
        type;

    toast.classList.add(
        "show"
    );

    clearTimeout(
        showToast.timeoutId
    );

    showToast.timeoutId =
        setTimeout(() => {
            toast.classList.remove(
                "show"
            );
        }, 2400);
}

function isOnline() {
    return navigator.onLine;
}

function updateConnectionStatus() {
    const status =
        document.getElementById(
            "connection-status"
        );

    const dot =
        document.getElementById(
            "connection-dot"
        );

    if (!status || !dot) {
        return;
    }

    const online =
        isOnline();

    status.textContent =
        online
            ? "Online • latest code"
            : "Offline • cached code";

    dot.classList.toggle(
        "connection-dot--online",
        online
    );

    dot.classList.toggle(
        "connection-dot--offline",
        !online
    );

    updateRewardButton();
    renderLibraries();
}


// ======================================================
// MODALS
// ======================================================

function openModal(modal) {
    if (!modal) {
        return;
    }

    modal.classList.add("open");
    modal.setAttribute(
        "aria-hidden",
        "false"
    );
}

function closeModal(modal) {
    if (!modal) {
        return;
    }

    modal.classList.remove(
        "open"
    );

    modal.setAttribute(
        "aria-hidden",
        "true"
    );
}

function openRewardModal() {
    renderRewardList();

    openModal(
        document.getElementById(
            "reward-modal"
        )
    );
}

function closeRewardModal() {
    closeModal(
        document.getElementById(
            "reward-modal"
        )
    );
}


// ======================================================
// DAILY REWARD UI
// ======================================================

function renderRewardList() {
    const rewardList =
        document.getElementById(
            "reward-list"
        );

    const claimButton =
        document.getElementById(
            "claim-daily"
        );

    const streakNode =
        document.getElementById(
            "reward-streak"
        );

    const nextText =
        document.getElementById(
            "reward-next-text"
        );

    const topText =
        document.getElementById(
            "reward-button-text"
        );

    const status =
        getDailyStatus();

    const cycleDay =
        status.cycleDay;

    if (streakNode) {
        streakNode.textContent =
            `${status.streak}-day streak`;
    }

    if (nextText) {
        nextText.textContent =
            status.claimedToday
                ? "Come back tomorrow to keep your streak."
                : `Today is Day ${cycleDay}: claim ${getNextRewardForToday()} coins.`;
    }

    if (topText) {
        topText.textContent =
            status.claimedToday
                ? "Claimed today"
                : `Claim +${getNextRewardForToday()}`;
    }

    if (rewardList) {
        rewardList.innerHTML =
            DAILY_REWARDS.map(
                (amount, index) => {
                    const day =
                        index + 1;

                    const isToday =
                        day === cycleDay;

                    const isClaimed =
                        status.claimedToday &&
                        isToday;

                    const repeatDay =
                        day ===
                        DAILY_REWARDS.length
                            ? " • then repeats"
                            : "";

                    return `
                        <div class="reward-item ${isToday ? "reward-item--today" : ""} ${isClaimed ? "reward-item--claimed" : ""}">
                            <div>
                                <span class="reward-item__day">
                                    DAY ${day}
                                </span>

                                <strong>
                                    ${day === 7 ? "Big reward" : "Daily reward"}${repeatDay}
                                </strong>
                            </div>

                            <span class="reward-item__value">
                                ${isClaimed ? "✓ Claimed" : `+${amount} 🪙`}
                            </span>
                        </div>
                    `;
                }
            ).join("");
    }

    if (claimButton) {
        claimButton.disabled =
            status.claimedToday;

        claimButton.textContent =
            status.claimedToday
                ? "Come back tomorrow"
                : `Claim +${getNextRewardForToday()} coins`;
    }
}

function updateRewardButton() {
    const topText =
        document.getElementById(
            "reward-button-text"
        );

    if (!topText) {
        return;
    }

    const status =
        getDailyStatus();

    topText.textContent =
        status.claimedToday
            ? "Claimed today"
            : `Claim +${getNextRewardForToday()}`;
}

async function claimDailyReward() {
    const status =
        getDailyStatus();

    if (status.claimedToday) {
        showToast(
            "You already claimed today's reward.",
            "info"
        );

        return;
    }

    const reward =
        getNextRewardForToday();

    appState.coins +=
        reward;

    appState.lastDailyClaim =
        status.today;

    appState.dailyStreak =
        status.streak;

    renderCoins();
    renderRewardList();

    await saveState();

    showToast(
        `Daily reward claimed: +${reward} coins!`,
        "success"
    );
}


// ======================================================
// GAMES
// ======================================================

function getGameIdentifier(game) {
    if (
        typeof game?.id === "string" &&
        game.id.trim()
    ) {
        return game.id.trim();
    }

    if (
        typeof game?.name === "string" &&
        game.name.trim()
    ) {
        return game.name
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9]+/g,
                "-"
            );
    }

    if (
        typeof game?.path === "string" &&
        game.path.trim()
    ) {
        return game.path
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9]+/g,
                "-"
            );
    }

    return "game";
}

function getGameById(gameId) {
    return defaultGames.find(
        (game) =>
            getGameIdentifier(game) ===
            String(gameId)
    ) || null;
}

function isGameUnlocked(gameId) {
    return appState.unlocked.includes(
        String(gameId)
    );
}

function createGameCard(game) {
    const gameId =
        getGameIdentifier(game);

    const cost =
        Number(game.cost) > 0
            ? Math.floor(
                Number(game.cost)
            )
            : 100;

    const unlocked =
        isGameUnlocked(
            gameId
        );

    const icon =
        String(
            game.icon || "🎮"
        );

    const description =
        String(
            game.description ||
            "Play now."
        );

    return `
        <button
            class="game-card ${unlocked ? "unlocked" : "locked"}"
            type="button"
            data-game-id="${encodeURIComponent(gameId)}"
        >
            <div class="game-card__topline">
                <span class="game-card__icon">
                    ${icon}
                </span>

                <span class="game-card__badge">
                    ${unlocked ? "OWNED" : `${cost} 🪙`}
                </span>
            </div>

            <div class="game-card__content">
                <h3>
                    ${escapeHtml(
                        String(game.name)
                    )}
                </h3>

                <p>
                    ${escapeHtml(
                        description
                    )}
                </p>
            </div>

            <span class="game-card__action">
                ${
                    unlocked
                        ? "▶ Play now"
                        : "🛒 Buy game"
                }
            </span>
        </button>
    `;
}

function renderYourGames(
    games = []
) {
    const hub =
        document.getElementById(
            "your-game-hub"
        );

    const count =
        document.getElementById(
            "your-games-count"
        );

    if (!hub) {
        return;
    }

    const purchasedGames =
        Array.isArray(games)
            ? games.filter(
                (game) =>
                    game &&
                    typeof game.name ===
                        "string" &&
                    game.name.trim() &&
                    isGameUnlocked(
                        getGameIdentifier(
                            game
                        )
                    )
            )
            : [];

    if (count) {
        count.textContent =
            `${purchasedGames.length} ${
                purchasedGames.length === 1
                    ? "game"
                    : "games"
            }`;
    }

    if (!purchasedGames.length) {
        hub.innerHTML = `
            <div class="empty-state">
                <span>🎮</span>

                <h3>
                    No games purchased yet
                </h3>

                <p>
                    ${
                        isOnline()
                            ? "Buy a game from the Game Gallery to add it here."
                            : "Your purchased games will appear here when available offline."
                    }
                </p>
            </div>
        `;

        return;
    }

    hub.innerHTML =
        purchasedGames
            .map(createGameCard)
            .join("");
}

function renderGameGallery(
    games = []
) {
    const gallery =
        document.getElementById(
            "game-gallery"
        );

    const count =
        document.getElementById(
            "gallery-count"
        );

    if (!gallery) {
        return;
    }

    const validGames =
        Array.isArray(games)
            ? games.filter(
                (game) =>
                    game &&
                    typeof game.name ===
                        "string" &&
                    game.name.trim()
            )
            : [];

    if (count) {
        count.textContent =
            `${validGames.length} ${
                validGames.length === 1
                    ? "game"
                    : "games"
            }`;
    }

    if (!validGames.length) {
        gallery.innerHTML = `
            <div class="empty-state">
                <span>🎮</span>

                <h3>
                    No games available
                </h3>

                <p>
                    Check again when you're online.
                </p>
            </div>
        `;

        return;
    }

    gallery.innerHTML =
        validGames
            .map(createGameCard)
            .join("");
}

function renderLibraries() {
    renderYourGames(
        defaultGames
    );

    const gallerySection =
        document.getElementById(
            "gallery-section"
        );

    if (!gallerySection) {
        return;
    }

    const online =
        isOnline();

    gallerySection.hidden =
        !online;

    if (online) {
        renderGameGallery(
            defaultGames
        );
    }
}


// ======================================================
// ESCAPE HTML
// ======================================================

function escapeHtml(value) {
    return String(value)
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


// ======================================================
// PURCHASE MODAL
// ======================================================

function openPurchaseModal(
    game
) {
    if (!game) {
        return;
    }

    if (!isOnline()) {
        showToast(
            "Go online to buy new games.",
            "info"
        );

        return;
    }

    const gameId =
        getGameIdentifier(
            game
        );

    const cost =
        Number(game.cost) > 0
            ? Math.floor(
                Number(game.cost)
            )
            : 100;

    const name =
        String(
            game.name ||
            "Game"
        );

    const description =
        String(
            game.description ||
            "Play this game offline."
        );

    const balanceAfter =
        appState.coins -
        cost;

    purchaseTarget =
        game;

    document.getElementById(
        "purchase-title"
    ).textContent =
        `Buy ${name}?`;

    document.getElementById(
        "purchase-game-name"
    ).textContent =
        name;

    document.getElementById(
        "purchase-game-description"
    ).textContent =
        description;

    document.getElementById(
        "purchase-icon"
    ).textContent =
        String(
            game.icon || "🎮"
        );

    document.getElementById(
        "purchase-cost"
    ).textContent =
        `${cost.toLocaleString("en-US")} 🪙`;

    document.getElementById(
        "purchase-balance"
    ).textContent =
        `${appState.coins.toLocaleString("en-US")} 🪙`;

    document.getElementById(
        "purchase-after"
    ).textContent =
        `${Math.max(
            0,
            balanceAfter
        ).toLocaleString("en-US")} 🪙`;

    const note =
        document.getElementById(
            "purchase-note"
        );

    const confirmButton =
        document.getElementById(
            "confirm-purchase"
        );

    if (
        appState.coins <
        cost
    ) {
        note.textContent =
            `You need ${(cost - appState.coins).toLocaleString("en-US")} more coins. Claim a daily reward first.`;

        confirmButton.disabled =
            true;

        confirmButton.textContent =
            "Not enough coins";
    } else {
        note.textContent =
            "The newest game HTML will be downloaded now and kept in your offline cache.";

        confirmButton.disabled =
            false;

        confirmButton.textContent =
            `Buy for ${cost} 🪙`;
    }

    openModal(
        document.getElementById(
            "purchase-modal"
        )
    );
}

function closePurchaseModal() {
    if (purchaseBusy) {
        return;
    }

    purchaseTarget =
        null;

    closeModal(
        document.getElementById(
            "purchase-modal"
        )
    );
}

function setPurchaseBusy(
    busy
) {
    purchaseBusy =
        busy;

    const confirmButton =
        document.getElementById(
            "confirm-purchase"
        );

    const cancelButton =
        document.getElementById(
            "cancel-purchase"
        );

    if (
        !confirmButton ||
        !cancelButton
    ) {
        return;
    }

    confirmButton.disabled =
        busy;

    cancelButton.disabled =
        busy;

    confirmButton.textContent =
        busy
            ? "Preparing game…"
            : "Buy game";
}


// ======================================================
// GAME LOADING
// ======================================================

function cleanupFrame() {
    const frame =
        document.getElementById(
            "game-frame"
        );

    if (!frame) {
        return;
    }

    frame.src =
        "about:blank";

    frame.srcdoc =
        "";

    frame.removeAttribute(
        "data-game-source"
    );
}

function prepareGameHtml(
    html,
    gameUrl
) {
    const sourceUrl =
        new URL(
            gameUrl,
            window.location.href
        ).href;

    const baseTag =
        `<base href="${escapeHtml(
            sourceUrl
        )}">`;

    if (
        /<base\s/i.test(
            html
        )
    ) {
        return html;
    }

    if (
        /<head[\s>]/i.test(
            html
        )
    ) {
        return html.replace(
            /<head([^>]*)>/i,
            `<head$1>${baseTag}`
        );
    }

    return `
        <!doctype html>
        <html>
            <head>
                ${baseTag}
            </head>
            <body>
                ${html}
            </body>
        </html>
    `;
}

async function fetchLatestGameHtml(
    gameData
) {
    const gameUrl =
        String(
            gameData?.path || ""
        ).trim();

    if (!gameUrl) {
        return "";
    }

    try {
        /*
         * ONLINE:
         * Service Worker contacts Netlify,
         * receives the newest HTML and stores it.
         *
         * OFFLINE:
         * Service Worker returns the last cached copy.
         */
        const response =
            await fetch(
                gameUrl,
                {
                    cache: "no-store",
                    headers: {
                        "Accept":
                            "text/html, */*"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const html =
            await response.text();

        if (!html.trim()) {
            throw new Error(
                "Empty game response"
            );
        }

        return html;
    } catch (error) {
        console.warn(
            "Game fetch failed:",
            error
        );

        /*
         * Extra fallback in case the Service Worker
         * is not currently controlling the page.
         */
        try {
            const cached =
                await caches.match(
                    gameUrl
                );

            if (cached) {
                return await cached.text();
            }
        } catch (cacheError) {
            console.warn(
                "Could not read cached game:",
                cacheError
            );
        }

        return "";
    }
}

async function openGameModal(
    game
) {
    if (!game) {
        return;
    }

    const gameId =
        getGameIdentifier(
            game
        );

    if (
        !isGameUnlocked(
            gameId
        )
    ) {
        showToast(
            "Buy this game first.",
            "info"
        );

        return;
    }

    const title =
        document.getElementById(
            "modal-title"
        );

    const frame =
        document.getElementById(
            "game-frame"
        );

    if (!title || !frame) {
        return;
    }

    title.textContent =
        String(
            game.name ||
            "Game"
        );

    currentFrameGameId =
        gameId;

    cleanupFrame();

    const html =
        await fetchLatestGameHtml(
            game
        );

    if (!html) {
        showToast(
            isOnline()
                ? "Could not load the game right now."
                : "This game has not been cached for offline play yet.",
            "error"
        );

        currentFrameGameId =
            "";

        return;
    }

    const preparedHtml =
        prepareGameHtml(
            html,
            String(
                game.path ||
                window.location.href
            )
        );

    frame.dataset.gameSource =
        String(
            game.path || ""
        );

    frame.srcdoc =
        preparedHtml;

    openModal(
        document.getElementById(
            "game-modal"
        )
    );
}

function closeGameModal() {
    currentFrameGameId =
        "";

    cleanupFrame();

    closeModal(
        document.getElementById(
            "game-modal"
        )
    );
}


// ======================================================
// PURCHASE
// ======================================================

async function purchaseGame(
    gameData
) {
    if (
        purchaseBusy ||
        !gameData
    ) {
        return;
    }

    if (!isOnline()) {
        closePurchaseModal();

        showToast(
            "Go online to buy new games.",
            "info"
        );

        return;
    }

    const gameId =
        getGameIdentifier(
            gameData
        );

    const cost =
        Number(gameData.cost) > 0
            ? Math.floor(
                Number(gameData.cost)
            )
            : 100;

    if (
        isGameUnlocked(
            gameId
        )
    ) {
        closePurchaseModal();

        await openGameModal(
            gameData
        );

        return;
    }

    if (
        appState.coins <
        cost
    ) {
        closePurchaseModal();

        showToast(
            `You need ${(cost - appState.coins).toLocaleString("en-US")} more coins.`,
            "error"
        );

        return;
    }

    setPurchaseBusy(
        true
    );

    try {
        /*
         * This request gets the NEWEST online
         * version. The Service Worker simultaneously
         * updates GAME_CACHE.
         */
        const html =
            await fetchLatestGameHtml(
                gameData
            );

        if (!html) {
            throw new Error(
                "No online version available."
            );
        }

        if (
            isGameUnlocked(
                gameId
            )
        ) {
            closePurchaseModal();

            await openGameModal(
                gameData
            );

            return;
        }

        appState.coins -=
            cost;

        appState.unlocked =
            [
                ...new Set(
                    [
                        ...appState.unlocked,
                        gameId
                    ]
                )
            ];

        renderCoins();
        renderLibraries();

        await saveState();

        closePurchaseModal();

        showToast(
            `${gameData.name} purchased and cached with the latest version.`,
            "success"
        );

        await openGameModal(
            gameData
        );
    } catch (error) {
        console.error(
            "Purchase cancelled:",
            error
        );

        showToast(
            "Purchase cancelled: the latest game could not be downloaded.",
            "error"
        );
    } finally {
        setPurchaseBusy(
            false
        );
    }
}


// ======================================================
// GAMES.JSON
// ======================================================

async function loadGamesList() {
    try {
        const response =
            await fetch(
                "games.json",
                {
                    cache: "no-store",
                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        const games =
            Array.isArray(data)
                ? data
                : Object.values(data);

        defaultGames =
            games;

        renderLibraries();
    } catch (error) {
        console.warn(
            "Could not load newest games list; using cache:",
            error
        );

        try {
            const cache =
                await openAppCache();

            const cached =
                cache
                    ? await cache.match(
                        "games.json"
                    )
                    : null;

            if (!cached) {
                throw error;
            }

            const data =
                await cached.json();

            defaultGames =
                Array.isArray(data)
                    ? data
                    : Object.values(data);

            renderLibraries();

            showToast(
                "Using your cached game list.",
                "info"
            );
        } catch (cacheError) {
            console.error(
                "Could not load games.json:",
                cacheError
            );

            defaultGames =
                [];

            renderLibraries();

            showToast(
                "The game list could not be loaded.",
                "error"
            );
        }
    }
}


// ======================================================
// GAME CARD CLICK
// ======================================================

async function handleGameCardClick(
    event
) {
    const card =
        event.target.closest(
            ".game-card"
        );

    if (!card) {
        return;
    }

    const encodedId =
        card.dataset.gameId ||
        "";

    const gameId =
        decodeURIComponent(
            encodedId
        );

    const game =
        getGameById(
            gameId
        );

    if (!game) {
        showToast(
            "That game is no longer available in the current list.",
            "error"
        );

        return;
    }

    if (
        isGameUnlocked(
            gameId
        )
    ) {
        await openGameModal(
            game
        );

        return;
    }

    if (!isOnline()) {
        showToast(
            "Go online to buy new games.",
            "info"
        );

        return;
    }

    openPurchaseModal(
        game
    );
}


// ======================================================
// INITIALIZATION
// ======================================================

async function initializeApp() {
    appState =
        await readState();

    renderCoins();
    renderRewardList();
    updateConnectionStatus();

    window.addEventListener(
        "online",
        () => {
            updateConnectionStatus();

            showToast(
                "Back online. Updating to the latest code.",
                "success"
            );

            loadGamesList();
        }
    );

    window.addEventListener(
        "offline",
        () => {
            updateConnectionStatus();

            showToast(
                "Offline mode: your cached games remain available.",
                "info"
            );
        }
    );

    document
        .getElementById(
            "reward-button"
        )
        ?.addEventListener(
            "click",
            openRewardModal
        );

    document
        .getElementById(
            "close-reward"
        )
        ?.addEventListener(
            "click",
            closeRewardModal
        );

    document
        .getElementById(
            "claim-daily"
        )
        ?.addEventListener(
            "click",
            claimDailyReward
        );

    document
        .getElementById(
            "close-purchase"
        )
        ?.addEventListener(
            "click",
            closePurchaseModal
        );

    document
        .getElementById(
            "cancel-purchase"
        )
        ?.addEventListener(
            "click",
            closePurchaseModal
        );

    document
        .getElementById(
            "confirm-purchase"
        )
        ?.addEventListener(
            "click",
            async () => {
                if (
                    purchaseTarget
                ) {
                    await purchaseGame(
                        purchaseTarget
                    );
                }
            }
        );

    document
        .getElementById(
            "close-game"
        )
        ?.addEventListener(
            "click",
            closeGameModal
        );

    document
        .querySelectorAll(
            ".app-modal, .game-modal"
        )
        .forEach(
            (modal) => {
                modal.addEventListener(
                    "click",
                    (event) => {
                        if (
                            event.target !==
                            modal
                        ) {
                            return;
                        }

                        if (
                            modal.id ===
                            "purchase-modal"
                        ) {
                            closePurchaseModal();
                        }

                        if (
                            modal.id ===
                            "reward-modal"
                        ) {
                            closeRewardModal();
                        }

                        if (
                            modal.id ===
                            "game-modal"
                        ) {
                            closeGameModal();
                        }
                    }
                );
            }
        );

    document
        .getElementById(
            "your-game-hub"
        )
        ?.addEventListener(
            "click",
            handleGameCardClick
        );

    document
        .getElementById(
            "game-gallery"
        )
        ?.addEventListener(
            "click",
            handleGameCardClick
        );

    if (
        "serviceWorker" in navigator &&
        window.isSecureContext
    ) {
        try {
            await navigator.serviceWorker.register(
                "./sw.js",
                {
                    updateViaCache:
                        "none"
                }
            );
        } catch (error) {
            console.warn(
                "Service worker registration failed:",
                error
            );
        }

        navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
                if (
                    !navigator.serviceWorker
                        .controller
                ) {
                    return;
                }

                window.location.reload();
            }
        );
    }

    await loadGamesList();
}

document.addEventListener(
    "DOMContentLoaded",
    initializeApp
);

