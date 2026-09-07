const fs = require("fs");
const path = require("path");

module.exports = (request, response) => {
    const game = String(request.query.game || "").trim();

    if (!/^[a-zA-Z0-9_-]+$/.test(game)) {
        response.status(400).send("Invalid game name");
        return;
    }

    const filePath = path.resolve(process.cwd(), "games", `${game}.html`);

    if (!filePath.startsWith(`${path.resolve(process.cwd(), "games")}${path.sep}`)) {
        response.status(403).send("Forbidden");
        return;
    }

    try {
        const html = fs.readFileSync(filePath, "utf8");

        if (!html.trim()) {
            response.status(404).send("Game file is empty");
            return;
        }

        response
            .status(200)
            .setHeader("Content-Type", "text/html; charset=utf-8")
            .setHeader("Cache-Control", "no-store")
            .send(html);
    } catch {
        response.status(404).send("Game not found");
    }
};