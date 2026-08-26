import fs from "fs";
import path from "path";

export async function handler(event) {
  const gameName = event.queryStringParameters.game;

  if (!gameName) {
    return { statusCode: 400, body: "Missing ?game=name" };
  }

  try {
    const filePath = path.join(__dirname, `games/${gameName}.html`);
    const gameHtml = fs.readFileSync(filePath, "utf8");

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "https://itch.io",
        "Content-Type": "text/html",
      },
      body: gameHtml,
    };
  } catch {
    return { statusCode: 404, body: "Game not found: " + gameName };
  }
}
