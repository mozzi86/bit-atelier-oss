// 96-04: the local API refuses browser writes without the session header — a
// foreign page's form POST no longer creates records — while the app itself
// (fetch wrapper) and tools without a browser keep working.
import { test, expect } from "@playwright/test";

const API = "/api/entities";
const NAME = "E2E Sitzung 96-04";

async function aufraeumen(request) {
  for (const p of await (await request.get(`${API}/Project`)).json()) if (String(p.name).startsWith(NAME)) await request.delete(`${API}/Project/${p.id}`);
}

test("Fremde Herkunft ohne Sitzung → 401, die App schreibt weiter (96-04)", async ({ page, request }) => {
  test.setTimeout(90000); // first page load compiles the app in dev
  await aufraeumen(request);
  try {
    // A foreign site's simple form POST (Origin + Fetch Metadata, no session header).
    const fremd = await request.post(`${API}/Project`, {
      headers: { origin: "https://boese.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" },
      data: JSON.stringify({ name: `${NAME} fremd` }),
    });
    expect(fremd.status()).toBe(401);
    expect(fremd.headers()["x-bit-sitzung-erneuern"]).toBe("1");

    // The app: a write from the page goes through the wrapper with the token.
    await page.goto("/Projects");
    const status = await page.evaluate(async (name) => {
      const r = await fetch("/api/entities/Project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      return r.status;
    }, `${NAME} app`);
    expect(status).toBe(201);

    // Without the wrapper (original fetch would not add it): a browser write with a wrong token is refused.
    const falsch = await page.evaluate(async () => {
      const r = await fetch("/api/entities/Project", { method: "POST", headers: { "content-type": "application/json", "X-Bit-Session": "falsch" }, body: "{}" });
      return r.status;
    });
    expect([200, 201]).toContain(falsch); // the wrapper overwrites a stale/wrong token with the right one

    const namen = (await (await request.get(`${API}/Project`)).json()).map((p) => p.name);
    expect(namen).toContain(`${NAME} app`);
    expect(namen).not.toContain(`${NAME} fremd`);
  } finally {
    await aufraeumen(request);
  }
});
