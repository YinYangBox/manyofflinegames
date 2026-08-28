const fs = require("fs");
const path = require("path");

export async function handler(event) {
	const gameName = event.queryStringParameters?.game;
	if (!gameName) return { statusCode: 400, body: "Missing ?game=" };

	const ref = event.headers.referer || "";
	if (!ref.includes("itch.io") && !ref.includes("localhost")) {
		return { statusCode: 403, body: "Only from itch.io" };
	}

	if (gameName.includes("..") || gameName.includes("/")) {
		return { statusCode: 400, body: "Invalid name" };
	}

  const gamesDir = fs.readdirSync(path.join(process.cwd(), "games"));

  if (!gamesDir.includes(`${gameName}.html`)) {
    return { statusCode: 404, body: "Game not found" };
  }

	try {
		const p = path.join(process.cwd(), `games/${gameName}.html`);
		const html = fs.readFileSync(p, "utf8");
		return {
			statusCode: 200,
			headers: {
				"Content-Type": "text/html",
				"Access-Control-Allow-Origin": "https://itch.io"
			},
			body: html
		};
	} catch (e) {
		return { statusCode: 404, body: "Not found" };
	}
}
