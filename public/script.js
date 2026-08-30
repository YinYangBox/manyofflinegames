document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
});

document.addEventListener("keydown", (e) => {
    const blocked =
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) ||
        (e.ctrlKey && e.key === "U");

    if (blocked) {
        e.preventDefault();
        return false;
    }
});

function slugify(value = "") {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function resolveGameRoute({ gamesFolder, game }) {
    if (game.path) {
        return `${gamesFolder}/${game.path}`;
    }

    const folder = game.folder || slugify(game.name);
    return `${gamesFolder}/${folder}/index.html`;
}

function openGameModal(gameName) {
    const modal = document.getElementById("game-modal");
    const frame = document.getElementById("game-frame");
    const title = document.getElementById("modal-title");

    if (!modal || !frame) return;

    const cleanName = slugify(gameName || "");
    if (!cleanName) return;

    title.textContent = gameName;
    frame.src = `/.netlify/functions/proxy?game=${encodeURIComponent(cleanName)}`;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
}

function closeGameModal() {
    const modal = document.getElementById("game-modal");
    const frame = document.getElementById("game-frame");

    if (modal) {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
    }
    if (frame) {
        frame.src = "about:blank";
    }
}

function renderGameHub({ gamesFolder = "games", games = [] } = {}) {
    const hub = document.getElementById("game-hub");
    if (!hub) return;

    const validGames = games.filter((game) => game && game.name);

    if (!validGames.length) {
        hub.innerHTML = "<p>No hay juegos añadidos todavía.</p>";
        return;
    }

    hub.innerHTML = validGames.map((game) => {
        const route = resolveGameRoute({ gamesFolder, game });
        const icon = game.icon || "🎮";
        const description = game.description || "Jugar ahora";
        const gameKey = slugify(game.name);

        return `
            <button class="game-card" type="button" data-game="${gameKey}" data-path="${route}">
                <div class="game-icon">${icon}</div>
                <h2>${game.name}</h2>
                <p>${description}</p>
            </button>
        `;
    }).join("");

    hub.querySelectorAll(".game-card").forEach((card) => {
        card.addEventListener("click", () => {
            openGameModal(card.dataset.game || card.dataset.path);
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const closeBtn = document.getElementById("close-game");
    const modal = document.getElementById("game-modal");

    if (closeBtn) {
        closeBtn.addEventListener("click", closeGameModal);
    }

    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeGameModal();
        });
    }

    renderGameHub({
        gamesFolder: "games",
        games: [
            { name: "snake", description: "Juego clásico" },
            { name: "pong", description: "Arcade" },
            { name: "tetris", description: "Rompe récords" }
        ]
    });
});