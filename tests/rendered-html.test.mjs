import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the book-to-RPG library shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Playable Books<\/title>/i);
  assert.match(html, /Learn by playing/i);
  assert.match(html, /Put your book into practice/i);
  assert.match(html, /The City of Misfit Things/i);
  assert.match(html, /Create my game/i);
  assert.match(html, /5 uploads in 24 hours per browser or shared network/i);
  assert.match(html, /Your book is sent to OpenAI for processing/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships six quests, local progress, 3D inspection, and narration", async () => {
  const [game, inspector, page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/Game.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/GateInspector3D.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.equal((game.match(/number: "0[1-6]"/g) ?? []).length, 6);
  assert.match(game, /design-warden-progress:v2:/);
  assert.match(game, /design-warden-audio:v1/);
  assert.match(game, /unsolved-investigation\.(ogg|mp3)/);
  assert.match(game, /Turn background music (on|off)/);
  assert.match(game, /Play narration/);
  assert.match(game, /SpeechSynthesisUtterance/);
  assert.match(game, /chooseNarrationVoice/);
  assert.match(game, /Here is what the inspection revealed/);
  assert.match(game, /Which explanation best matches that evidence/);
  assert.match(game, /NARRATION_DUCK_VOLUME/);
  assert.match(game, /<GateInspector3D/);
  assert.match(inspector, /WebGLRenderer/);
  assert.match(inspector, /OrbitControls/);
  assert.match(inspector, /Handle cue/);
  assert.match(inspector, /Push motion/);
  assert.match(inspector, /gate-inspector-fallback/);
  assert.match(game, /false-handle-gate\.png/);
  assert.match(game, /prefers-reduced-motion|Principle journal/i);
  assert.match(page, /<BookRpgApp\b/);
  assert.match(layout, /title: "Playable Books"/);
  assert.match(css, /--yellow: #f0ca08/);
  assert.match(css, /\.gate-inspector-canvas/);
  assert.match(packageJson, /"three"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/assets/false-handle-gate.png", import.meta.url));
  await access(new URL("../public/audio/unsolved-investigation.ogg", import.meta.url));
  await access(new URL("../public/audio/unsolved-investigation.mp3", import.meta.url));
  await access(new URL("../public/audio/unsolved-investigation.LICENSE.txt", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("public/favicon.svg", root)));
});

test("ships the resumable, quota-protected PDF-to-RPG job flow", async () => {
  const [shell, client, gameLibrary, legacyRoute, advanceRoute, gamePackage] = await Promise.all([
    readFile(new URL("../app/BookRpgApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/book-job-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate-game/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/book-jobs/[jobId]/advance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game-package.ts", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /accept="application\/pdf,.pdf"/);
  assert.match(shell, /I own this book or have permission to use it/);
  assert.match(gameLibrary, /design-book-rpg-library:v1/);
  assert.match(shell, /5 uploads in 24 hours per browser or shared network/);
  assert.match(shell, /Your book is sent to OpenAI for processing/);
  assert.match(client, /create.+upload.+status.+advance.+acknowledge/s);
  assert.match(client, /RESUMABLE_JOB_KEY/);
  assert.match(client, /persistValidGameThenAcknowledge/);
  assert.match(legacyRoute, /job_api_required/);
  assert.doesNotMatch(legacyRoute, /input_file|OPENAI_API_KEY/);
  assert.match(advanceRoute, /generateGameStage/);
  assert.match(gamePackage, /minItems: 3/);
  assert.match(gamePackage, /maxItems: 3/);
  assert.match(gamePackage, /sourceAnchors/);
});
