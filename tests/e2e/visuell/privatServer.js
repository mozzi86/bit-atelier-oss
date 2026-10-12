// privatServer.js — a private, freshly seeded API server for the visual baseline (72-06).
//
// Why: the dev server of the E2E run shares ONE JSON database with every other spec, and
// many specs write into it (projects, forms, check runs). Screenshots against that data
// would differ with the order of the suite. So the visual spec seeds its own data folder
// (BIT_DATA_DIR in the OS temp dir) at a fixed instant (fester-zeitpunkt.mjs), starts
// `server/index.js` on its own port and the browser's /api requests are routed there.
// Vite still serves the front end of the shared dev server.
//
// In:  port (number). Out: { basis, stoppen() }; side effects: temp folder, child process.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ZEIT = "./tests/e2e/visuell/fester-zeitpunkt.mjs";

/**
 * Seeds a temp data folder and starts the API on `port`.
 * @param {number} port TCP port of the private API
 * @returns {Promise<{ basis: string, stoppen: () => void }>}
 */
export async function privatenServerStarten(port) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "bit-visuell-"));
  const env = { ...process.env, BIT_DATA_DIR: ordner, API_PORT: String(port), API_HOST: "127.0.0.1" };
  const seed = spawnSync(process.execPath, ["--import", ZEIT, "server/seed.js"], { cwd: REPO, env, encoding: "utf8" });
  if (seed.status !== 0) throw new Error(`Seed für die visuelle Basis fehlgeschlagen:\n${seed.stderr || seed.stdout}`);

  const kind = spawn(process.execPath, ["--import", ZEIT, "server/index.js"], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  let ausgabe = "";
  kind.stdout.on("data", (d) => { ausgabe += d; });
  kind.stderr.on("data", (d) => { ausgabe += d; });

  const basis = `http://127.0.0.1:${port}`;
  const bis = Date.now() + 30000;
  for (;;) {
    try {
      const r = await fetch(`${basis}/api/entities/Project`);
      if (r.ok) break;
    } catch {
      // not listening yet
    }
    if (kind.exitCode !== null) throw new Error(`Privater API-Server beendet (Code ${kind.exitCode}):\n${ausgabe}`);
    if (Date.now() > bis) {
      kind.kill();
      throw new Error(`Privater API-Server antwortet nicht auf ${basis}:\n${ausgabe}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    basis,
    stoppen() {
      kind.kill();
      try {
        fs.rmSync(ordner, { recursive: true, force: true });
      } catch {
        // Windows may still hold a handle for a moment — the temp folder is harmless.
      }
    },
  };
}

/**
 * Routes the page: only localhost is reachable, `/api/…` goes to the private server.
 * A fetch that hits a keep-alive socket the server just closed fails with ECONNRESET
 * (Node closes idle connections after 5 s) — such a request is retried, twice at most.
 * @param {import("@playwright/test").Page} page
 * @param {string} basis base URL of the private server, e.g. http://127.0.0.1:3036
 */
export async function apiUmleiten(page, basis) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    for (let versuch = 0; ; versuch++) {
      try {
        const antwort = await route.fetch({ url: `${basis}${url.pathname}${url.search}` });
        return route.fulfill({ response: antwort });
      } catch (e) {
        if (versuch >= 2 || !/ECONNRESET|socket hang up/i.test(String(e))) throw e;
      }
    }
  });
}
