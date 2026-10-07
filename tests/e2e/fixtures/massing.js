// Shared helpers for the Massing-Studio specs (Phase 75).
// The footprint persists in db.json via useBimModelSync, so every spec first
// resets it to a known rectangle using only the UI (double-click removes a
// corner, a tap on "+" inserts one, arrow keys move a focused corner by
// 0.1 m / Shift 1 m - all built in 75-01).

export const ERLAUBT_OFFLINE = /(ERR_|net::|Failed to fetch|timeout|aborted|404|503|tiles\.|openfreemap|elevation-tiles|Image could not be loaded|AbortError|GL Driver Message|WebGL)/i;

/**
 * Set a Werkstatt rule switch (`wt-regel-<k>`) and retry until the state sticks.
 * useFachlayer drops inputs while the layer is still loading (loadingRef) and
 * then applies the loaded state, so a click right after page load can be
 * silently undone — this is the observable "layer loaded" signal we have.
 * @param {import("@playwright/test").Page} page
 * @param {string} k rule key, e.g. "wandstaerken"
 * @param {boolean} an desired state
 */
export async function schalteRegel(page, k, an) {
  const box = page.getByTestId(`wt-regel-${k}`);
  for (let v = 0; v < 12; v += 1) {
    if ((await box.isChecked()) === an) {
      // Hold for one debounce-free tick: a pending layer load may still flip it back.
      await page.waitForTimeout(300);
      if ((await box.isChecked()) === an) return;
    }
    await box.click({ force: true });
    await page.waitForTimeout(400);
  }
  throw new Error(`Regel ${k} laesst sich nicht auf ${an} setzen (Layer laedt noch?)`);
}

/** Footprint corners in site metres plus screen px per metre, read from the live SVG. */
export async function punkte(page) {
  return page.evaluate(() => {
    const poly = document.querySelector('polygon[data-griff="flaeche"]');
    if (!poly) return null;
    const svg = poly.closest("svg");
    const vlines = [...svg.querySelectorAll('line[stroke="#e2e8f0"]')].filter((l) => l.getAttribute("x1") === l.getAttribute("x2"));
    const hlines = [...svg.querySelectorAll('line[stroke="#e2e8f0"]')].filter((l) => l.getAttribute("y1") === l.getAttribute("y2"));
    const xs = [...new Set(vlines.map((l) => Number(l.getAttribute("x1"))))].sort((a, b) => a - b);
    const ys = [...new Set(hlines.map((l) => Number(l.getAttribute("y1"))))].sort((a, b) => a - b);
    const upm = (xs[1] - xs[0]) / 10; // grid every 10 m
    const vb = svg.getAttribute("viewBox").split(" ").map(Number);
    const pxPerUnit = svg.getBoundingClientRect().width / vb[2];
    const pts = poly.getAttribute("points").split(" ").map((p) => p.split(",").map(Number));
    const rect = svg.getBoundingClientRect();
    return {
      pts: pts.map(([x, y]) => ({ x: (x - xs[0]) / upm, y: (y - ys[0]) / upm })),
      pxPerM: upm * pxPerUnit,
      unitsPerM: upm,
      // screen position of site metre (0,0): viewBox origin vb[0]/vb[1] maps to rect.left/top
      origin: { x: rect.left + (xs[0] - vb[0]) * pxPerUnit, y: rect.top + (ys[0] - vb[1]) * pxPerUnit },
    };
  });
}

/** Bounding box of the footprint in metres. */
export async function messen(page) {
  const p = await punkte(page);
  if (!p) return { w: NaN, d: NaN, pxPerM: NaN, n: -1 };
  const xs = p.pts.map((q) => q.x), ys = p.pts.map((q) => q.y);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), pxPerM: p.pxPerM, n: p.pts.length };
}

/** Press a key n times. */
export async function presse(page, key, n) {
  for (let i = 0; i < n; i += 1) await page.keyboard.press(key);
}

/**
 * Resets the footprint to an axis-parallel rectangle via the UI only.
 * Default: corners (10,10) (40,10) (40,30) (10,30) -> 30 x 20 m.
 */
export async function resetRechteck(page, ziel = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }, { x: 10, y: 30 }]) {
  const polyLoc = page.locator('polygon[data-griff="flaeche"]');
  await polyLoc.waitFor({ timeout: 15000 });
  let p = await punkte(page);
  for (let k = 0; k < 8 && p.pts.length > 4; k += 1) {
    await page.locator('[data-griff="ecke"]').nth(p.pts.length - 1).dblclick({ force: true });
    await page.waitForTimeout(150);
    p = await punkte(page);
  }
  for (let k = 0; k < 4 && p.pts.length < 4; k += 1) {
    await page.locator('[data-griff="mitte"]').first().click({ force: true });
    await page.waitForTimeout(150);
    p = await punkte(page);
  }
  if (p.pts.length !== 4) throw new Error(`resetRechteck: ${p.pts.length} Ecken statt 4`);
  // One Alt-drag per corner (Alt = no phi magnet); clampPt rounds to 0.1 m.
  for (let i = 0; i < 4; i += 1) {
    p = await punkte(page);
    const cur = p.pts[i], t = ziel[i];
    if (Math.abs(cur.x - t.x) + Math.abs(cur.y - t.y) < 0.1) continue;
    const griff = page.locator('[data-griff="ecke"]').nth(i);
    const box = await griff.boundingBox();
    const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
    const tx = p.origin.x + t.x * p.pxPerM, ty = p.origin.y + t.y * p.pxPerM;
    await page.keyboard.down("Alt");
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (let k = 1; k <= 8; k += 1) await page.mouse.move(sx + ((tx - sx) * k) / 8, sy + ((ty - sy) * k) / 8);
    await page.waitForTimeout(60);
    await page.mouse.up(); await page.keyboard.up("Alt");
    await page.waitForTimeout(80);
  }
  // Fine adjustment: arrow keys move a focused corner by 0.1 m. Up to three rounds, then the
  // corners must sit EXACTLY (0.01 m) — the phi magnet only works on axis-parallel rectangles.
  for (let runde = 0; runde < 3; runde += 1) {
    p = await punkte(page);
    let offen = 0;
    for (let i = 0; i < 4; i += 1) {
      const cur = p.pts[i], t = ziel[i];
      const dx = Math.round((t.x - cur.x) * 10), dy = Math.round((t.y - cur.y) * 10);
      if (dx === 0 && dy === 0) continue;
      offen += 1;
      await page.locator('[data-griff="ecke"]').nth(i).focus();
      await presse(page, dx > 0 ? "ArrowRight" : "ArrowLeft", Math.min(9, Math.abs(dx)));
      await presse(page, dy > 0 ? "ArrowDown" : "ArrowUp", Math.min(9, Math.abs(dy)));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(60);
    }
    if (!offen) break;
  }
  await page.waitForTimeout(150);
  p = await punkte(page);
  for (let i = 0; i < 4; i += 1) {
    const e = Math.abs(p.pts[i].x - ziel[i].x) + Math.abs(p.pts[i].y - ziel[i].y);
    if (e > 0.011) throw new Error(`resetRechteck: Ecke ${i} bei ${p.pts[i].x},${p.pts[i].y} statt ${ziel[i].x},${ziel[i].y}`);
  }
  return messen(page);
}

/** Screen point at 1/4 of the north edge hit line (the "+" handle sits at the midpoint). */
export async function nordkante(page) {
  const boxes = [];
  const lines = page.locator('line[data-griff="kante"]');
  const n = await lines.count();
  for (let i = 0; i < n; i += 1) {
    const b = await lines.nth(i).boundingBox();
    if (b && b.width > b.height) boxes.push({ i, x: b.x + b.width / 4, y: b.y + b.height / 2 });
  }
  boxes.sort((a, b) => a.y - b.y);
  return boxes[0];
}

/** Blocks every non-localhost request (no egress). */
export async function nurLocalhost(page) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return route.continue();
    return route.abort();
  });
}
