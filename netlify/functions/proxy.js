const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
    try {
        const game = String(
            event.queryStringParameters?.game || ""
        ).trim();

        console.log("Requested game:", game);
        console.log("cwd:", process.cwd());
        console.log("__dirname:", __dirname);

        if (!game) {
            return {
                statusCode: 400,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8"
                },
                body: "Missing game parameter"
            };
        }

        // Solo nombres simples: pong, tetris, flappy-bird, etc.
        if (!/^[a-zA-Z0-9_-]+$/.test(game)) {
            return {
                statusCode: 400,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8"
                },
                body: "Invalid game name"
            };
        }

        /*
         * Netlify incluye games/** en el bundle de la Function.
         *
         * __dirname:
         *   /.../netlify/functions
         *
         * Subimos dos niveles:
         *   /.../netlify/functions
         *          ↓ ..
         *   /.../netlify
         *          ↓ ..
         *   /...
         *
         * y entramos en games/
         */
        const projectRoot = path.resolve(__dirname, "../..");

        const filePath = path.join(
            projectRoot,
            "games",
            `${game}.html`
        );

        console.log("Looking for:", filePath);
        console.log("Exists:", fs.existsSync(filePath));

        if (!fs.existsSync(filePath)) {
            return {
                statusCode: 404,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8"
                },
                body: `Game not found: ${game}.html`
            };
        }

        const html = fs.readFileSync(filePath, "utf8");

        if (!html.trim()) {
            return {
                statusCode: 404,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8"
                },
                body: "Game file is empty"
            };
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store"
            },
            body: html
        };

    } catch (error) {
        console.error("Proxy error:", error);

        return {
            statusCode: 500,
            headers: {
                "Content-Type": "text/plain; charset=utf-8"
            },
            body: `Proxy error: ${error.message}`
        };
    }
};