const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = __dirname;
const publicRoot = path.join(root, "public");
const gamesRoot = path.join(root, "games");
const port = Number(process.env.PORT || 5501);

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
};

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
    response.writeHead(statusCode, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
    });
    response.end(body);
}

function servePublicFile(requestPath, response) {
    const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
    const filePath = path.resolve(publicRoot, relativePath);

    if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
        send(response, 403, "Forbidden");
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            send(response, 404, "Not found");
            return;
        }

        const extension = path.extname(filePath).toLowerCase();
        send(response, 200, content, contentTypes[extension] || "application/octet-stream");
    });
}

function serveGame(game, response) {
    if (!/^[a-zA-Z0-9_-]+$/.test(game)) {
        send(response, 400, "Invalid game name");
        return;
    }

    const filePath = path.join(gamesRoot, `${game}.html`);
    fs.readFile(filePath, "utf8", (error, content) => {
        if (error) {
            send(response, 404, "Game not found");
            return;
        }

        send(response, 200, content, "text/html; charset=utf-8");
    });
}

const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (requestUrl.pathname === "/api/proxy") {
        serveGame(requestUrl.searchParams.get("game") || "", response);
        return;
    }

    if (requestUrl.pathname === "/api/paypal-config") {
        send(response, 200, JSON.stringify({
            clientId: process.env.PAYPAL_CLIENT_ID || ""
        }), "application/json; charset=utf-8");
        return;
    }

    servePublicFile(requestUrl.pathname, response);
});

server.listen(port, "0.0.0.0", () => {
    console.log(`Many Offline Games running at http://localhost:${port}`);
    console.log("Open /public/index.html in the Codespaces forwarded port.");
});