const fs = require("fs");
const path = require("path");

function isAllowedHost(hostname) {
    const host = (hostname || "").toLowerCase();

    return host.endsWith(".netlify.app");
}

function isAllowedRequest(event) {
    const headers = event.headers || {};
    const referer = headers.referer || headers.Referer || "";
    const origin = headers.origin || headers.Origin || "";
    const host = headers.host || headers.Host || "";

    const candidates = [];

    if (referer) {
        try {
            candidates.push(new URL(referer).hostname);
        } catch {}
    }

    if (origin) {
        try {
            candidates.push(new URL(origin).hostname);
        } catch {}
    }

    if (host) {
        candidates.push(host.split(":")[0]);
    }

    return candidates.some((value) => isAllowedHost(value));
}

exports.handler = async function (event) {
    const gameName = event.queryStringParameters?.game;
    if (!gameName) {
        return { statusCode: 400, body: "Missing ?game=" };
    }

    const safeGame = String(gameName)
        .replace(/\.html$/i, "")
        .replace(/[^a-z0-9_-]/gi, "")
        .toLowerCase();

    if (!safeGame) {
        return { statusCode: 400, body: "Invalid game name" };
    }

    if (!isAllowedRequest(event)) {
        return {
            statusCode: 403,
            body: "Forbidden: only your Netlify site can access this endpoint."
        };
    }

    const filePath = path.join(process.cwd(), "games", `${safeGame}.html`);

    if (!fs.existsSync(filePath)) {
        return { statusCode: 404, body: "Game not found" };
    }

    const html = fs.readFileSync(filePath, "utf8");

    return {
        statusCode: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        },
        body: html
    };
};