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

function openGameModal(game) {
    const modal = document.getElementById("game-modal");
    const frame = document.getElementById("game-frame");
    const title = document.getElementById("modal-title");

    if (!modal || !frame || !title) return;

    const gameData = typeof game === "object" ? game : { name: String(game || "Game"), path: String(game || "") };
    const gameName = String(gameData.name || "Game");
    const gamePath = String(gameData.path || "");

    title.textContent = gameName;
    frame.src = gamePath;
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

function renderGameHub(games = []) {
    const hub = document.getElementById("game-hub");
    if (!hub) return;

    const validGames = Array.isArray(games)
        ? games.filter((game) => game && game.name)
        : [];

    if (!validGames.length) {
        hub.innerHTML = "<p>No hay juegos añadidos todavía.</p>";
        return;
    }

    hub.innerHTML = validGames.map((game) => {
        const icon = game.icon || "🎮";
        const description = game.description || "Jugar ahora";
        const gameName = String(game.name || "Game");
        const gamePath = String(game.path || "");

        return `
            <button class="game-card" type="button" data-name="${gameName}" data-path="${gamePath}">
                <div class="game-icon">${icon}</div>
                <h2>${gameName}</h2>
                <p>${description}</p>
            </button>
        `;
    }).join("");

    hub.querySelectorAll(".game-card").forEach((card) => {
        card.addEventListener("click", () => {
            openGameModal({
                name: card.dataset.name || "Game",
                path: card.dataset.path || ""
            });
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

    fetch("games.json")
        .then((response) => response.json())
        .then((data) => {
            const games = Array.isArray(data) ? data : Object.values(data);
            renderGameHub(games);
        })
        .catch((error) => {
            console.error("Error loading games.json:", error);
            alert("Error loading games.json. Please check the console for details.");
        });
});