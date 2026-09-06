
const APP_CACHE = "many-offline-games-v6";
const LEGACY_APP_CACHES = ["many-offline-games-v5"];

const STATE_KEY = "./__state__/hub-state-v2.json";
const LEGACY_STATE_KEYS = ["hub-state-v1"];

const LOCAL_COINS_KEY = "many-offline-games-coins-v1";
const LEGACY_LOCAL_STATE_KEY = "many-offline-games-state-v2";

const DAILY_REWARDS = [10, 20, 30, 40, 50, 60, 70];
const CREDIT_PACKS = [
    { credits: 100, coins: 10 },
    { credits: 300, coins: 25 },
    { credits: 1000, coins: 50 },
    { credits: 1500, coins: 100 }
];
const COIN_PACKS = [
    { coins: 400, price: "EUR 0.49" },
    { coins: 1200, price: "EUR 0.99" },
    { coins: 2500, price: "EUR 1.99" },
    { coins: 7000, price: "EUR 4.99" },
    { coins: 20000, price: "EUR 9.99" },
    { coins: 50000, price: "EUR 19.99" }
];
// PayPal Client ID is public and belongs here. Replace this placeholder with
// the Client ID from your PayPal Developer Dashboard (Sandbox while testing).
const PAYPAL_CLIENT_ID = "PON_AQUI_TU_PAYPAL_CLIENT_ID";
// Use "sandbox" for tests and "production" after your PayPal account is live.
const PAYPAL_ENVIRONMENT = "sandbox";
const PAYPAL_CURRENCY = "EUR";
const PACK_DISCOUNTS = [10, 20, 35, 50];
const DAILY_OFFERS_KEY = "many-offline-games-daily-offers-v1";

const DEFAULT_STATE = {
    coins: 0,
    lastDailyClaim: "",
    dailyStreak: 0,
    unlocked: [],
    codeUnlocked: []
};

let defaultGames = [];
let appState = { ...DEFAULT_STATE };

let purchaseTarget = null;
let purchaseBusy = false;
let currentFrameGameId = "";
let packTarget = null;
let packBusy = false;
let coinTarget = null;
let coinBusy = false;
let paypalButtons = null;
let activeStoreTab = "library";


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
        closeCodeModal();
        closePackModal();
        closeCoinModal();
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
        unlocked: [],
        codeUnlocked: []
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

    const codeUnlocked = Array.isArray(data?.codeUnlocked)
        ? [
            ...new Set(
                data.codeUnlocked
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
        unlocked,
        codeUnlocked
    };
}

function getCachedStateSnapshot() {
    return JSON.stringify({
        lastDailyClaim: appState.lastDailyClaim,
        dailyStreak: appState.dailyStreak,
        unlocked: appState.unlocked,
        codeUnlocked: appState.codeUnlocked
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

function getGameCost(game) {
    return Number(game?.cost) > 0
        ? Math.floor(Number(game.cost))
        : 100;
}

function getCodeCost(game) {
    return Math.max(1, Math.ceil(getGameCost(game) * 0.1));
}

function getGameById(gameId) {
    return defaultGames.find(
        (game) =>
            getGameIdentifier(game) ===
            String(gameId)
    ) || null;
}

function getSavedGameKey(game) {
    return getGameIdentifier(game) === "space-invaders"
        ? "SPACE_INVADERS"
        : getGameIdentifier(game);
}

function readArcadeGames() {
    try {
        const data = JSON.parse(
            localStorage.getItem("ARCADE_GAMES") || "{}"
        );

        return data && typeof data === "object" && !Array.isArray(data)
            ? data
            : {};
    } catch (error) {
        console.warn("Could not read game credits:", error);
        return {};
    }
}

function addGameCredits(game, credits) {
    const root = readArcadeGames();
    const key = getSavedGameKey(game);
    const current = root[key] && typeof root[key] === "object"
        ? root[key]
        : {};

    current.credits = Math.max(
        0,
        Math.floor(Number(current.credits) || 0) + credits
    );
    root[key] = current;
    localStorage.setItem("ARCADE_GAMES", JSON.stringify(root));
}

function renderGameIcon(icon, alt, className = "") {
    const value = String(icon || "🎮").trim();
    const isImage = /^(?:https?:\/\/|\.?\.?\/)?[^\s]+\.(?:png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i.test(value);

    if (!isImage) {
        return escapeHtml(value);
    }

    return `<img class="${className}" src="${escapeHtml(value)}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

function renderCreditStore() {
    const store = document.getElementById("credits-store");

    if (!store) {
        return;
    }

    const purchasedGames = defaultGames.filter((game) =>
        isGameUnlocked(getGameIdentifier(game))
    );

    if (!purchasedGames.length) {
        store.innerHTML = `
            <div class="empty-state">
                <span>🎮</span>
                <h3>No purchased games yet</h3>
                <p>Buy a game first to get credits for it.</p>
            </div>
        `;
        return;
    }

    store.innerHTML = purchasedGames.map((game) => `
        <article class="store-card">
            <div class="store-card__icon">${renderGameIcon(game.icon, String(game.name))}</div>
            <div class="store-card__content">
                <h3>${escapeHtml(String(game.name))}</h3>
                <p>Use these credits inside this game.</p>
            </div>
            <div class="credit-options">
                ${CREDIT_PACKS.slice(0, 3).map((pack) => `
                    <button class="secondary-button credit-option" type="button"
                        data-credit-game="${encodeURIComponent(getGameIdentifier(game))}"
                        data-credit-value="${pack.credits}" data-credit-cost="${pack.coins}">
                        +${pack.credits} C / ${pack.coins} 🪙
                    </button>
                `).join("")}
            </div>
        </article>
    `).join("");
}

function renderCoinStore() {
    const store = document.getElementById("coin-store");

    if (!store) {
        return;
    }

    store.innerHTML = COIN_PACKS.map((pack, index) => `
        <button class="store-card coin-card ${index === 2 ? "coin-card--featured" : ""}" type="button" data-coin-pack="${index}">
            ${index === 2 ? '<span class="pack-card__tag">BEST VALUE</span>' : ""}
            <span class="coin-card__icon">COIN</span>
            <h3>${pack.coins.toLocaleString("en-US")} coins</h3>
            <strong>${pack.price}</strong>
            <span class="store-card__action">Buy coin pack</span>
        </button>
    `).join("");
}

function closeCoinModal() {
    if (coinBusy) {
        return;
    }

    coinTarget = null;
    closeModal(document.getElementById("coin-modal"));
}

function openCoinModal(packIndex) {
    if (!isOnline()) {
        showToast("Go online to buy coins.", "info");
        return;
    }

    const pack = COIN_PACKS[Number(packIndex)];

    if (!pack) {
        return;
    }

    coinTarget = pack;
    document.getElementById("coin-purchase-amount").textContent = `${pack.coins.toLocaleString("en-US")} coins`;
    document.getElementById("coin-purchase-price").textContent = pack.price;
    document.getElementById("coin-purchase-note").textContent = PAYPAL_CLIENT_ID.startsWith("PON_AQUI")
        ? "Add your PayPal Client ID in public/script.js to enable secure checkout."
        : "You will be redirected to PayPal to complete payment securely.";
    renderPayPalButtons();
    openModal(document.getElementById("coin-modal"));
}

function loadPayPalSdk() {
    if (window.paypal) {
        return Promise.resolve(window.paypal);
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(PAYPAL_CLIENT_ID)}&currency=${PAYPAL_CURRENCY}&intent=capture&components=buttons`;
        script.onload = () => resolve(window.paypal);
        script.onerror = () => reject(new Error("PayPal SDK could not load."));
        document.head.appendChild(script);
    });
}

async function renderPayPalButtons() {
    const container = document.getElementById("paypal-button-container");

    if (!container || PAYPAL_CLIENT_ID.startsWith("PON_AQUI")) {
        return;
    }

    container.innerHTML = "";

    try {
        const paypal = await loadPayPalSdk();
        paypalButtons = paypal.Buttons({
            style: { layout: "vertical", shape: "rect", label: "paypal" },
            createOrder: async () => {
                const response = await fetch("/.netlify/functions/paypal-create-order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ coins: coinTarget.coins })
                });
                const data = await response.json();
                if (!response.ok || !data.id) {
                    throw new Error(data.error || "Could not create PayPal order.");
                }
                return data.id;
            },
            onApprove: async (data) => {
                coinBusy = true;
                try {
                    const response = await fetch("/.netlify/functions/paypal-capture-order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orderID: data.orderID })
                    });
                    const result = await response.json();
                    if (!response.ok || result.status !== "COMPLETED") {
                        throw new Error(result.error || "PayPal payment was not completed.");
                    }
                    appState.coins += result.coins;
                    renderCoins();
                    await saveState();
                    closeCoinModal();
                    showToast(`Payment complete: +${result.coins.toLocaleString("en-US")} coins.`, "success");
                } catch (error) {
                    console.error("PayPal capture error:", error);
                    showToast("PayPal could not confirm the payment.", "error");
                } finally {
                    coinBusy = false;
                }
            },
            onError: (error) => {
                coinBusy = false;
                console.error("PayPal checkout error:", error);
                showToast("PayPal could not complete the payment.", "error");
            }
        });
        await paypalButtons.render(container);
    } catch (error) {
        console.error("PayPal setup error:", error);
        showToast("PayPal checkout is not configured yet.", "error");
    }
}

function getPackGames(size) {
    return defaultGames.slice(0, size);
}

function seededRandom(seed) {
    let value = seed;

    return () => {
        value = (value * 9301 + 49297) % 233280;
        return value / 233280;
    };
}

function getDailyOffers() {
    const today = getTodayKey();
    const stored = (() => {
        try {
            return JSON.parse(localStorage.getItem(DAILY_OFFERS_KEY) || "null");
        } catch {
            return null;
        }
    })();

    if (
        stored?.date === today &&
        Array.isArray(stored.offers) &&
        stored.offers.length > 0
    ) {
        return {
            ...stored,
            revealed: Array.isArray(stored.revealed)
                ? stored.revealed
                : []
        };
    }

    const seed = [...today].reduce((total, character) => total + character.charCodeAt(0), 0);
    const random = seededRandom(seed);
    const shuffledGames = [...defaultGames].sort(() => random() - 0.5);
    const offers = Array.from({ length: Math.min(3, Math.floor(defaultGames.length / 2)) }, (_, index) => {
        const size = 1 + Math.floor(random() * 4);
        const discount = PACK_DISCOUNTS[Math.floor(random() * PACK_DISCOUNTS.length)];
        const start = index * 2;

        return {
            id: `${today}-${index}`,
            size,
            discount,
            gameIds: shuffledGames.slice(start, start + size).map(getGameIdentifier)
        };
    });
    const next = { date: today, offers, revealed: [] };

    try {
        localStorage.setItem(DAILY_OFFERS_KEY, JSON.stringify(next));
    } catch (error) {
        console.warn("Could not save daily offers:", error);
    }

    return next;
}

function getOfferGames(offer) {
    return offer.gameIds
        .map(getGameById)
        .filter(Boolean);
}

function revealDailyOffer(offerId) {
    const daily = getDailyOffers();

    if (!daily.revealed.includes(offerId)) {
        daily.revealed.push(offerId);
        try {
            localStorage.setItem(DAILY_OFFERS_KEY, JSON.stringify(daily));
        } catch (error) {
            console.warn("Could not save revealed offer:", error);
        }
    }

    renderPackStore();
}

function renderPackStore() {
    const store = document.getElementById("packs-store");

    if (!store) {
        return;
    }

    const daily = getDailyOffers();

    store.innerHTML = daily.offers.map((offer, index) => {
        const games = getOfferGames(offer);
        const regularCost = games.reduce((total, game) => total + getGameCost(game), 0);
        const discount = offer.discount;
        const price = Math.ceil(regularCost * (1 - discount / 100));
        const revealed = daily.revealed.includes(offer.id);

        return `
            <button class="store-card pack-card ${revealed ? "is-revealed" : "is-hidden"}" type="button" data-offer-id="${offer.id}" ${games.length !== offer.size ? "disabled" : ""}>
                ${revealed ? `
                    <span class="pack-card__tag">${discount}% OFF</span>
                    <h3>${offer.size}-GAME DROP</h3>
                    <p>${games.map((game) => escapeHtml(String(game.name))).join(" · ")}</p>
                    <strong>${price.toLocaleString("en-US")} 🪙</strong>
                    <span class="store-card__action">Tap to claim offer</span>
                ` : `
                    <span class="pack-card__mystery">?</span>
                    <h3>MYSTERY DROP ${index + 1}</h3>
                    <p>Today's secret bundle is waiting.</p>
                    <span class="store-card__action">Tap to reveal</span>
                `}
            </button>
        `;
    }).join("");
}

function getGameCost(game) {
    return Number(game?.cost) > 0 ? Math.floor(Number(game.cost)) : 100;
}

function closePackModal() {
    if (packBusy) {
        return;
    }

    packTarget = null;
    closeModal(document.getElementById("pack-modal"));
}

function openPackModal(offerId) {
    if (!isOnline()) {
        showToast("Go online to buy a pack.", "info");
        return;
    }

    const daily = getDailyOffers();
    const offer = daily.offers.find((item) => item.id === offerId);

    if (!offer || !daily.revealed.includes(offerId)) {
        return;
    }

    const games = getOfferGames(offer);
    const discount = offer.discount;
    const regularCost = games.reduce((total, game) => total + getGameCost(game), 0);
    const price = Math.ceil(regularCost * (1 - discount / 100));
    packTarget = { games, price, discount, regularCost };

    document.getElementById("pack-title").textContent = `${offer.size}-game daily drop`;
    document.getElementById("pack-games").innerHTML = games.map((game) => `
        <span class="pack-preview__game">${renderGameIcon(game.icon, String(game.name), "pack-preview__icon")} ${escapeHtml(String(game.name))}</span>
    `).join("");
    document.getElementById("pack-regular-cost").textContent = `${regularCost.toLocaleString("en-US")} 🪙`;
    document.getElementById("pack-discount").textContent = `${discount}%`;
    document.getElementById("pack-balance").textContent = `${appState.coins.toLocaleString("en-US")} 🪙`;

    const note = document.getElementById("pack-note");
    const confirm = document.getElementById("confirm-pack");
    note.textContent = appState.coins < price
        ? `You need ${(price - appState.coins).toLocaleString("en-US")} more coins.`
        : `Pay ${price.toLocaleString("en-US")} coins to unlock and cache every game.`;
    confirm.disabled = appState.coins < price;
    confirm.textContent = appState.coins < price ? "Not enough coins" : `Buy for ${price} 🪙`;
    openModal(document.getElementById("pack-modal"));
}

async function purchasePack() {
    if (packBusy || !packTarget || appState.coins < packTarget.price) {
        return;
    }

    packBusy = true;
    const purchasedGameCount = packTarget.games.length;
    const confirm = document.getElementById("confirm-pack");
    confirm.disabled = true;
    confirm.textContent = "Preparing pack...";

    try {
        for (const game of packTarget.games) {
            if (!await fetchLatestGameHtml(game)) {
                throw new Error(`Could not download ${game.name}`);
            }
        }

        appState.coins -= packTarget.price;
        appState.unlocked = [...new Set([
            ...appState.unlocked,
            ...packTarget.games.map(getGameIdentifier)
        ])];
        renderCoins();
        renderLibraries();
        await saveState();
        packBusy = false;
        closePackModal();
        showToast(`Pack purchased: ${purchasedGameCount} games unlocked.`, "success");
    } catch (error) {
        console.error("Pack purchase cancelled:", error);
        showToast("Pack cancelled: a game could not be downloaded.", "error");
    } finally {
        packBusy = false;
    }
}

function isGameUnlocked(gameId) {
    return appState.unlocked.includes(
        String(gameId)
    );
}

function isCodeUnlocked(gameId) {
    return appState.codeUnlocked.includes(
        String(gameId)
    );
}

function createGameCard(game) {
    const gameId =
        getGameIdentifier(game);

    const cost = getGameCost(game);
    const codeCost = getCodeCost(game);

    const unlocked =
        isGameUnlocked(
            gameId
        );

    const icon =
        renderGameIcon(
            game.icon,
            String(game.name || "Game"),
            "game-card__icon-image"
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

    renderCreditStore();
    renderCoinStore();
    renderPackStore();
}

function setStoreTab(tab) {
    const validTab = ["library", "offers", "coins", "credits"].includes(tab)
        ? tab
        : "library";

    activeStoreTab = validTab;

    document.querySelectorAll("[data-store-tab]").forEach((button) => {
        const selected = button.dataset.storeTab === validTab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
    });

    document.querySelectorAll(".store-tab-panel").forEach((panel) => {
        panel.hidden = !panel.classList.contains(`store-tab-panel--${validTab}`);
    });
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
    ).innerHTML = renderGameIcon(
        game.icon,
        name,
        "purchase-icon-image"
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

    const codeButton = document.getElementById("get-code");

    codeButton.textContent = isCodeUnlocked(gameId)
        ? "Code"
        : `Get code for ${codeCost} 🪙`;
    codeButton.disabled = false;

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

async function unlockGameCode(game) {
    if (purchaseBusy || !game) {
        return;
    }

    const gameId = getGameIdentifier(game);

    if (isCodeUnlocked(gameId)) {
        await openCodeModal(game);
        return;
    }

    if (!isOnline()) {
        showToast("Go online to unlock the game code.", "info");
        return;
    }

    const cost = getCodeCost(game);

    if (appState.coins < cost) {
        showToast(`You need ${(cost - appState.coins).toLocaleString("en-US")} more coins.`, "error");
        return;
    }

    const button = document.getElementById("get-code");
    purchaseBusy = true;
    button.disabled = true;
    button.textContent = "Preparing code...";

    try {
        const html = await fetchLatestGameHtml(game);

        if (!html) {
            throw new Error("No game code available.");
        }

        appState.coins -= cost;
        appState.codeUnlocked = [...new Set([
            ...appState.codeUnlocked,
            gameId
        ])];
        renderCoins();
        await saveState();
        button.disabled = false;
        button.textContent = "Code";
        showToast(`${game.name} code unlocked.`, "success");
        await openCodeModal(game, html);
    } catch (error) {
        console.error("Code unlock cancelled:", error);
        button.disabled = false;
        button.textContent = `Get code for ${cost} 🪙`;
        showToast("The game code could not be unlocked.", "error");
    } finally {
        purchaseBusy = false;
    }
}

async function openCodeModal(game, html = "") {
    if (!game) {
        return;
    }

    const code = html || await fetchLatestGameHtml(game);

    if (!code) {
        showToast("The game code could not be loaded.", "error");
        return;
    }

    closeModal(document.getElementById("purchase-modal"));
    document.getElementById("code-title").textContent = `${game.name} code`;
    document.getElementById("code-display").textContent = code;
    document.getElementById("download-code").onclick = () => {
        const filename = `${getGameIdentifier(game)}.html`;
        const url = URL.createObjectURL(new Blob([code], { type: "text/html" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    };
    openModal(document.getElementById("code-modal"));
}

function closeCodeModal() {
    closeModal(document.getElementById("code-modal"));
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

    const cost = getGameCost(gameData);

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

function handleCreditPurchase(event) {
    const button = event.target.closest("[data-credit-game]");

    if (!button) {
        return;
    }

    const game = getGameById(decodeURIComponent(button.dataset.creditGame));
    const credits = Number(button.dataset.creditValue);
    const cost = Number(button.dataset.creditCost);

    if (!game || !Number.isFinite(credits) || !Number.isFinite(cost)) {
        return;
    }

    if (!isGameUnlocked(getGameIdentifier(game))) {
        renderCreditStore();
        showToast("Buy this game first to get credits.", "error");
        return;
    }

    if (appState.coins < cost) {
        showToast(`You need ${(cost - appState.coins).toLocaleString("en-US")} more coins.`, "error");
        return;
    }

    try {
        addGameCredits(game, credits);
        appState.coins -= cost;
        renderCoins();
        saveState();
        showToast(`${credits} credits added to ${game.name}.`, "success");
    } catch (error) {
        console.error("Credit purchase cancelled:", error);
        showToast("Credit purchase could not be completed.", "error");
    }
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
        .querySelectorAll("[data-store-tab]")
        .forEach((button) => {
            button.addEventListener("click", () => {
                setStoreTab(button.dataset.storeTab);
            });
        });

    setStoreTab(activeStoreTab);

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
        .getElementById("get-code")
        ?.addEventListener("click", () => {
            if (purchaseTarget) {
                unlockGameCode(purchaseTarget);
            }
        });

    document
        .getElementById("close-code")
        ?.addEventListener("click", closeCodeModal);

    document
        .getElementById("close-pack")
        ?.addEventListener("click", closePackModal);

    document
        .getElementById("cancel-pack")
        ?.addEventListener("click", closePackModal);

    document
        .getElementById("confirm-pack")
        ?.addEventListener("click", purchasePack);

    document
        .getElementById("close-coin")
        ?.addEventListener("click", closeCoinModal);

    document
        .getElementById("cancel-coin")
        ?.addEventListener("click", closeCoinModal);

    document
        .getElementById("coin-store")
        ?.addEventListener("click", (event) => {
            const card = event.target.closest("[data-coin-pack]");

            if (card) {
                openCoinModal(card.dataset.coinPack);
            }
        });

    document
        .getElementById("credits-store")
        ?.addEventListener("click", handleCreditPurchase);

    document
        .getElementById("packs-store")
        ?.addEventListener("click", (event) => {
            const card = event.target.closest("[data-offer-id]");

            if (!card || card.disabled) {
                return;
            }

            const daily = getDailyOffers();
            if (!daily.revealed.includes(card.dataset.offerId)) {
                revealDailyOffer(card.dataset.offerId);
                return;
            }

            openPackModal(card.dataset.offerId);
        });

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

                        if (modal.id === "code-modal") {
                            closeCodeModal();
                        }

                        if (
                            modal.id ===
                            "reward-modal"
                        ) {
                            closeRewardModal();
                        }

                        if (modal.id === "pack-modal") {
                            closePackModal();
                        }

                        if (modal.id === "coin-modal") {
                            closeCoinModal();
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

