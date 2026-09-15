const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const proxy = require("../api/proxy.js");
const files = fs
  .readdirSync(path.join(__dirname, "../games"))
  .filter((n) => n.startsWith("-") && n.endsWith(".html"));
let browser, server, base;
before(async () => {
  server = http.createServer((req, res) => {
    const game = new URL(req.url, "http://localhost").searchParams.get("game");
    const response = {
      status(n) {
        res.statusCode = n;
        return this;
      },
      setHeader(k, v) {
        res.setHeader(k, v);
        return this;
      },
      send(html) {
        res.end(html);
      },
    };
    proxy({ query: { game } }, response);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});
async function withGame(name, fn, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 390, height: 844 },
    hasTouch: options.touch || false,
    isMobile: options.touch || false,
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => errors.push(e.message));
  if (options.init) await page.addInitScript(options.init);
  try {
    await page.goto(base + "/?game=-" + name);
    await fn(page);
    assert.deepEqual(errors, [], name + " browser errors");
  } finally {
    await context.close();
  }
}
for (const file of files) {
  const name = file.slice(1, -5);
  test(
    name + ": opens menu and plays at mobile and desktop widths",
    async () => {
      for (const width of [320, 390, 1365])
        await withGame(
          name,
          async (p) => {
            assert.equal(await p.locator("#hero-play").isVisible(), true);
            assert.equal(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              true,
              "menu overflow at " + width,
            );
            await p.locator("#hero-play").click();
            assert.equal(await p.locator("#game-screen").isVisible(), true);
            await p.waitForTimeout(100);
            assert.equal(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              true,
              "game overflow at " + width,
            );
          },
          { viewport: { width, height: 900 }, touch: width < 500 },
        );
    },
  );
  test(
    name + ": saves preserve other games and external credit top-ups",
    async () =>
      withGame(name, async (p) => {
        const result = await p.evaluate(() => {
          const m = typeof saveManager !== "undefined" ? saveManager : save,
            key = m.constructor.GAME_KEY || m.constructor.KEY,
            root = JSON.parse(localStorage.ARCADE_GAMES);
          root.unrelated = { credits: 777, active: { marker: "keep" } };
          root[key].credits += 500;
          localStorage.ARCADE_GAMES = JSON.stringify(root);
          m.data.credits += 25;
          m.persist();
          const a = JSON.parse(localStorage.ARCADE_GAMES);
          m.persist();
          const b = JSON.parse(localStorage.ARCADE_GAMES);
          return {
            other: b.unrelated,
            credits: a[key].credits,
            again: b[key].credits,
          };
        });
        assert.deepEqual(result, {
          other: { credits: 777, active: { marker: "keep" } },
          credits: 525,
          again: 525,
        });
      }),
  );
}
test("corrupt storage is preserved and a saving warning is visible", async () =>
  withGame(
    "freecell",
    async (p) => {
      assert.equal(
        await p.evaluate(() => localStorage.ARCADE_GAMES),
        "{broken",
      );
      assert.equal(await p.locator("#save-warning").isVisible(), true);
      await p.locator("#hero-play").click();
      assert.equal(await p.locator("#game-screen").isVisible(), true);
    },
    { init: () => localStorage.setItem("ARCADE_GAMES", "{broken") },
  ));
test("failed save retry does not duplicate a store credit top-up", async () =>
  withGame("freecell", async (p) => {
    assert.equal(
      await p.evaluate(() => {
        const root = JSON.parse(localStorage.ARCADE_GAMES);
        root.freecell.credits = 500;
        localStorage.ARCADE_GAMES = JSON.stringify(root);
        save.data.credits += 25;
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function () {
          throw Error("Quota");
        };
        save.persist();
        Storage.prototype.setItem = original;
        save.persist();
        save.persist();
        return JSON.parse(localStorage.ARCADE_GAMES).freecell.credits;
      }),
      525,
    );
  }));
test("invalid settings and negative statistics recover to supported values", async () =>
  withGame(
    "basketball",
    async (p) => {
      assert.deepEqual(
        await p.evaluate(() => ({
          mode: save.data.selectedMode,
          court: save.data.selectedCourt,
          credits: save.data.credits,
          shots: save.data.stats.shots,
        })),
        { mode: "free", court: "sunset", credits: 0, shots: 0 },
      );
    },
    {
      init: () =>
        (localStorage.ARCADE_GAMES = JSON.stringify({
          basketball: {
            selectedMode: "missing",
            selectedCourt: "missing",
            credits: -50,
            stats: { shots: -5 },
          },
        })),
    },
  ));
test("FreeCell: deterministic deals, legal cell moves, undo and card validation", async () =>
  withGame("freecell", async (p) => {
    assert.deepEqual(
      await p.evaluate(() => {
        save.data.assist = false;
        newGame(11982);
        const first = JSON.stringify(state.columns);
        newGame(11982);
        const deterministic = first === JSON.stringify(state.columns),
          before = state.columns[0].length;
        selected = { type: "tableau", index: 0, cardIndex: before - 1 };
        const moved = doMove({ type: "cell", index: 0 }),
          valid = validCardSave(save.data.activeGame, true);
        undo();
        const restored =
          state.columns[0].length === before && state.cells[0] === null;
        const bad = structuredClone(save.data.activeGame);
        bad.columns[0][0] = bad.columns[0][1];
        return {
          deterministic,
          moved,
          valid,
          restored,
          corrupt: validCardSave(bad, true),
        };
      }),
      {
        deterministic: true,
        moved: true,
        valid: true,
        restored: true,
        corrupt: false,
      },
    );
  }));
test("FreeCell: pause freezes elapsed time; quick actions keep fractions", async () =>
  withGame("freecell", async (p) => {
    assert.ok(
      (await p.evaluate(() => {
        newGame(5);
        state.startedAt = Date.now() - 350;
        saveActive();
        state.startedAt = Date.now() - 350;
        saveActive();
        setPause(true);
        return currentElapsed();
      })) >= 0.7,
    );
    const t = await p.evaluate(() => currentElapsed());
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(() => currentElapsed()), t);
  }));
test("Solitaire: draw three, recycle and reload preserve every card", async () =>
  withGame("solitaire", async (p) => {
    assert.deepEqual(
      await p.evaluate(() => {
        saveManager.data.selectedDraw = 3;
        dealNew();
        drawStock();
        const drawn = game.waste.length;
        for (let i = 0; i < 7; i++) drawStock();
        const empty = game.stock.length === 0;
        drawStock();
        saveActive();
        return {
          drawn,
          empty,
          recycled: game.stock.length,
          valid: validCardSave(saveManager.data.activeRun),
        };
      }),
      { drawn: 3, empty: true, recycled: 24, valid: true },
    );
    await p.reload();
    await p.locator("#continue-btn").click();
    assert.equal(await p.evaluate(() => game.stock.length), 24);
  }));
test("Connect Four: second side starts bot; pause and restart cancel its old task", async () =>
  withGame("connect-four", async (p) => {
    await p.evaluate(() => {
      save.data.preferredSide = "second";
      createNewGame();
      pauseGame();
    });
    await p.waitForTimeout(800);
    assert.deepEqual(
      await p.evaluate(() => ({ human: game.human, moves: game.moves })),
      { human: 2, moves: 0 },
    );
    await p.evaluate(() => {
      resumeGame();
      save.data.preferredSide = "first";
      createNewGame();
    });
    await p.waitForTimeout(800);
    assert.equal(await p.evaluate(() => game.moves), 0);
  }));
test("Connect Four: local win, gravity validation and negamax perspective", async () =>
  withGame("connect-four", async (p) => {
    const result = await p.evaluate(async () => {
      save.data.selectedMatch = "local";
      createNewGame();
      for (const col of [0, 1, 0, 1, 0, 1, 0]) await makeMove(col);
      const winner = game.winner;
      closeModal("result-modal");
      createNewGame();
      const invalid = structuredClone(game);
      invalid.board[0][0] = 1;
      invalid.moves = 1;
      invalid.current = 2;
      const b = emptyBoard(MODES.classic);
      placeOn(b, 3, 1);
      return {
        winner,
        invalid: validSavedGame(invalid),
        signed:
          negamax(b, 0, -Infinity, Infinity, 2, 1, 2, MODES.classic) ===
          -evaluateBoard(b, 1, 2, MODES.classic),
      };
    });
    assert.deepEqual(result, { winner: 1, invalid: false, signed: true });
  }));
test("Word Search: all categories and difficulties produce complete themed puzzles", async () =>
  withGame("word-search", async (p) => {
    const failures = await p.evaluate(() => {
      const bad = [];
      for (const category of Object.keys(CATEGORIES))
        for (const difficulty of Object.keys(DIFFICULTIES))
          for (let i = 0; i < 4; i++) {
            const g = generatePuzzle(difficulty, category);
            if (
              !validWordSave(g) ||
              g.placements.some((p) => !CATEGORIES[category].includes(p.word))
            )
              bad.push(category + "/" + difficulty);
          }
      return bad;
    });
    assert.deepEqual(failures, []);
  }));
test("Word Search: found words and elapsed time survive menu and reload", async () =>
  withGame("word-search", async (p) => {
    await p.evaluate(() => {
      startNew(true);
      game.startedAt -= 65100;
      const word = game.placements[0];
      submitPath(word.cells.map(([r, c]) => ({ r, c })));
      menuFromGame();
    });
    const before = await p.evaluate(() => save.data.active.elapsedBefore);
    assert.ok(before >= 65);
    await p.reload();
    await p.locator("#continue-btn").click();
    assert.equal(await p.evaluate(() => game.found.length), 1);
    assert.ok((await p.evaluate(() => elapsed())) >= 65);
  }));
test("Nonogram: alternate clue solution wins, undo retains penalties, hint fixes crosses", async () =>
  withGame("nonogram", async (p) => {
    const result = await p.evaluate(() => {
      save.data.selectedSize = 5;
      startNew();
      const i = state.solution.findIndex(Boolean);
      state.marks[i] = 2;
      state.hints = 0;
      hint();
      const hintUsed = state.hints === 1;
      state.mistakes = 3;
      pushUndo();
      state.mistakes = 4;
      undo();
      const mistakes = state.mistakes;
      state.size = 5;
      state.rowClues = state.colClues = Array.from({ length: 5 }, () => [1]);
      state.solution = Array.from(
        { length: 25 },
        (_, i) => Math.floor(i / 5) === i % 5,
      );
      state.marks = Array.from({ length: 25 }, (_, i) =>
        Math.floor(i / 5) === 4 - (i % 5) ? 1 : 2,
      );
      return {
        hintUsed,
        mistakes,
        alternate: checkWin(),
        solver: !!solveClues(state.marks),
      };
    });
    assert.deepEqual(result, {
      hintUsed: true,
      mistakes: 4,
      alternate: true,
      solver: true,
    });
  }));
test("Nonogram: right click marks exactly once", async () =>
  withGame("nonogram", async (p) => {
    await p.locator("#hero-play").click();
    await p.locator("#grid .cell").first().click({ button: "right" });
    assert.equal(await p.evaluate(() => state.marks[0]), 2);
  }));
test("Basketball: in-flight shot survives save and resize; zero-shot end has no credits", async () =>
  withGame("basketball", async (p) => {
    const before = await p.evaluate(() => {
      newRun();
      startShot(500, -600);
      step(0.1);
      pause();
      return { ball: save.data.activeRun.ball, shots: run.shots };
    });
    await p.reload();
    await p.locator("#continue-btn").click();
    await p.evaluate(() => pause());
    assert.equal(await p.evaluate(() => ball.air), true);
    await p.setViewportSize({ width: 1365, height: 900 });
    assert.equal(await p.evaluate(() => ball.x), before.ball.x);
    const earned = await p.evaluate(() => {
      newRun();
      const before = save.data.credits;
      finishRun();
      return save.data.credits - before;
    });
    assert.equal(earned, 0);
  }));
test("Basketball: swish score survives floor bounce; pending reset blocks shots", async () =>
  withGame("basketball", async (p) => {
    assert.deepEqual(
      await p.evaluate(() => {
        newRun();
        const m = dims();
        ball.x = m.rimX;
        ball.y = m.rimY - 2;
        ball.vy = 100;
        ball.vx = 0;
        ball.air = true;
        run.between = false;
        step(0.03);
        const swish = ball.scoredSwish;
        ball.swish = false;
        ball.air = false;
        endShot(true, ball.scoredSwish);
        const score = run.score;
        startShot(100, -500);
        return { swish, score, blocked: !ball.air };
      }),
      { swish: true, score: 4, blocked: true },
    );
  }));
test("Drift Circuit: steering creates slip and score, save resumes, rewards count drift once", async () =>
  withGame("drift-circuit", async (p) => {
    const result = await p.evaluate(() => {
      startRace();
      cancelAnimationFrame(raceFrame);
      game.clock = game.startAt + 1000;
      const c = game.car;
      c.vx = Math.cos(c.angle) * 150;
      c.vy = Math.sin(c.angle) * 150;
      input.gas = true;
      input.right = true;
      input.handbrake = true;
      for (let i = 0; i < 36; i++)
        simulate(1 / 120, game.clock + (i * 1000) / 120);
      const slip = Math.abs(
        Math.atan2(
          Math.sin(Math.atan2(c.vy, c.vx) - c.angle),
          Math.cos(Math.atan2(c.vy, c.vx) - c.angle),
        ),
      );
      pauseGame();
      const valid = validRace(save.data.activeRace);
      game.driftScore = 200;
      game.currentDrift = 100;
      const before = save.data.totalDrift;
      finishRace("Test");
      return { slip, valid, awarded: save.data.totalDrift - before };
    });
    assert.ok(result.slip > 0.05);
    assert.equal(result.valid, true);
    assert.equal(result.awarded, 200);
  }));
test("Bubble Shooter: row insertion preserves horizontal geometry and adjacency", async () =>
  withGame("bubble-shooter", async (p) => {
    assert.deepEqual(
      await p.evaluate(() => {
        game.newGame();
        const before = game.cellPos(2, 4),
          neighbors = game.neighbors(2, 4);
        game.addRow();
        return {
          sameX: before.x === game.cellPos(3, 4).x,
          neighbors: neighbors.every(([r, c]) =>
            game.neighbors(3, 4).some(([rr, cc]) => rr === r + 1 && cc === c),
          ),
          inside: game.cellPos(0, 9).x + game.R < game.W,
        };
      }),
      { sameX: true, neighbors: true, inside: true },
    );
  }));
test("Bubble Shooter: restore shot, mode and zero timer without resetting them", async () =>
  withGame("bubble-shooter", async (p) => {
    assert.deepEqual(
      await p.evaluate(() => {
        save.data.selectedMode = "rush";
        game.newGame();
        game.fire();
        game.rushLeft = 0;
        game.persistRun();
        const snap = structuredClone(save.data.activeRun);
        save.data.selectedMode = "classic";
        const restored = game.restore(snap);
        const mode = save.data.selectedMode,
          shot = !!game.shot,
          time = game.rushLeft;
        game.update(0.01);
        return { restored, mode, shot, time, ended: game.ended };
      }),
      { restored: true, mode: "rush", shot: true, time: 0, ended: true },
    );
  }));
test("FreeCell: tap-select and drag both reach an empty free cell", async () =>
  withGame("freecell", async (p) => {
    await p.evaluate(() => {
      save.data.assist = false;
      newGame(11982);
    });
    const top = p
      .locator('.playing-card[data-type="tableau"][data-index="0"]')
      .last();
    await top.click();
    await p.locator('[data-free="0"]').click();
    assert.equal(await p.evaluate(() => !!state.cells[0]), true);
    await p.evaluate(() => undo());
    const card = p
      .locator('.playing-card[data-type="tableau"][data-index="0"]')
      .last();
    const a = await card.boundingBox(),
      b = await p.locator('[data-free="0"]').boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + a.height - 10);
    await p.mouse.down();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await p.mouse.up();
    assert.equal(await p.evaluate(() => !!state.cells[0]), true);
  }));
test("Connect Four: pausing during drop keeps a valid reloadable board", async () =>
  withGame("connect-four", async (p) => {
    await p.emulateMedia({ reducedMotion: "no-preference" });
    const result = await p.evaluate(() => {
      save.data.selectedMatch = "local";
      createNewGame();
      void makeMove(0);
      pauseGame();
      return validSavedGame(save.data.activeGame);
    });
    assert.equal(result, true);
    await p.reload();
    await p.locator("#continue-btn").click();
    assert.equal(await p.evaluate(() => game.moves), 1);
  }));
test("Solitaire: canceling auto-finish leaves a valid paused deal", async () =>
  withGame("solitaire", async (p) => {
    const result = await p.evaluate(async () => {
      dealNew();
      const cards = newDeck().map((c) => ({ ...c, faceUp: true }));
      game.stock = [];
      game.waste = [];
      game.tableau = Array.from({ length: 7 }, () => []);
      game.foundations = { H: [], D: [], C: [], S: [] };
      for (const c of cards)
        if (c.rank < 13) game.foundations[c.suit].push(c);
        else game.tableau[["H", "D", "C", "S"].indexOf(c.suit)].push(c);
      const task = autoFinish();
      pauseTimer();
      game.paused = true;
      saveActive();
      const count = foundationCount();
      await task;
      return {
        same: foundationCount() === count,
        valid: validCardSave(saveManager.data.activeRun),
        running: game.autoRunning,
      };
    });
    assert.deepEqual(result, { same: true, valid: true, running: false });
  }));
test("Word Search: keyboard selection finds a real word", async () =>
  withGame("word-search", async (p) => {
    await p.locator("#hero-play").click();
    const [a, b] = await p.evaluate(() => [
      game.placements[0].cells[0],
      game.placements[0].cells.at(-1),
    ]);
    await p.locator(`.cell[data-r="${a[0]}"][data-c="${a[1]}"]`).focus();
    await p.keyboard.press("Enter");
    await p.locator(`.cell[data-r="${b[0]}"][data-c="${b[1]}"]`).focus();
    await p.keyboard.press("Enter");
    assert.equal(await p.evaluate(() => game.found.length), 1);
  }));
test("Drift Circuit: touch controls visible, pause clears all pressed pedals", async () =>
  withGame(
    "drift-circuit",
    async (p) => {
      await p.locator("#hero-play").click();
      assert.equal(await p.locator("#gas-btn").isVisible(), true);
      const pedal = await p.locator("#gas-btn").boundingBox();
      await p.mouse.move(pedal.x + pedal.width / 2, pedal.y + pedal.height / 2);
      await p.mouse.down();
      assert.equal(await p.evaluate(() => input.gas), true);
      await p.evaluate(() => pauseGame());
      assert.equal(
        await p.evaluate(() => input.gas || input.brake || input.handbrake),
        false,
      );
      await p.mouse.up();
    },
    { touch: true },
  ));
