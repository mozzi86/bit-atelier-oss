// Phase 28 evidence (price reference TED + DÖE): pins the central behaviour of
// packages/nova-ausschreibung/src/lib/priceReference.js and of the TED proxy route
// POST /api/prices/ted-search (packages/nova-ausschreibung/server/routes.js).
//
// In:  hand-made, neutral data (invented notice ids, round euro amounts) — no real tender.
// Out: assertions only. Every expected number is worked out by hand in the comment next to it;
//      the library result is never its own reference. The proxy test never reaches the
//      internet: global fetch is replaced for the duration of each case.
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Buffer } from "node:buffer";
import express from "express";

import {
  parseCsv, bundeslandFromNuts, cpvGroup, buildTedQuery, parseTedResponse, parseDoeeCsv,
  aggregateLots, benchmarkFor, korridorText, TRADE_CPV, CPV_LABELS,
} from "@ava/lib/priceReference.js";
import { pricesRouter } from "../../packages/nova-ausschreibung/server/routes.js";

describe("28 RFC-4180-Parser (parseCsv)", () => {
  it("quoted fields keep embedded commas, line breaks and doubled quotes; CRLF and LF both end a record", () => {
    const text = 'a,b,c\r\n"x,1","y\nz","sagt ""ja"""\n2,,3\n';
    const { header, rows } = parseCsv(text);
    assert.deepEqual(header, ["a", "b", "c"]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { a: "x,1", b: "y\nz", c: 'sagt "ja"' });
    assert.deepEqual(rows[1], { a: "2", b: "", c: "3" });
  });

  it("last record without a line break, blank trailing lines, BOM/whitespace in the header and missing cells", () => {
    const { header, rows } = parseCsv("﻿ id , wert\n1,10\n2\n\n\n3,30");
    assert.deepEqual(header, ["id", "wert"]); // trim() also removes the BOM
    assert.deepEqual(rows, [{ id: "1", wert: "10" }, { id: "2", wert: "" }, { id: "3", wert: "30" }]);
  });

  it("empty or missing input gives an empty table, never a throw", () => {
    assert.deepEqual(parseCsv(""), { header: [], rows: [] });
    assert.deepEqual(parseCsv(undefined), { header: [], rows: [] });
  });
});

describe("28 NUTS / CPV mapping", () => {
  it("NUTS of any depth → federal state; unknown, too short or missing → \"DE\" (nationwide)", () => {
    assert.equal(bundeslandFromNuts("DE21"), "Bayern");
    assert.equal(bundeslandFromNuts("dea1a"), "Nordrhein-Westfalen"); // case-insensitive
    assert.equal(bundeslandFromNuts("DEG"), "Thüringen");
    assert.equal(bundeslandFromNuts("DEU"), "DE");
    assert.equal(bundeslandFromNuts("AT1"), "DE");
    assert.equal(bundeslandFromNuts("DE"), "DE");
    assert.equal(bundeslandFromNuts(undefined), "DE");
  });

  it("only construction CPV (45*) has a group; the four-digit prefix is the group", () => {
    assert.equal(cpvGroup("45331000"), "4533");
    assert.equal(cpvGroup(" 45210000 "), "4521");
    assert.equal(cpvGroup("30192000"), null);
    // R-28-01: the 4x neighbours of 45 are not construction work (44 = construction materials, 42 = machinery, 48 = software)
    for (const fremd of ["44111000", "42000000", "48000000", "40000000", "4"]) assert.equal(cpvGroup(fremd), null, fremd);
    assert.equal(cpvGroup(""), null);
    assert.equal(cpvGroup(null), null);
    // every trade code of the [ASSUMED] mapping is a construction code with a label or the generic fallback
    for (const [trade, cpv] of Object.entries(TRADE_CPV)) assert.ok(cpvGroup(cpv), `${trade} → ${cpv} ist kein Bau-CPV`);
    assert.equal(CPV_LABELS[4533], "Heizung/Lüftung/Sanitär");
  });
});

describe("28 TED search API (buildTedQuery, parseTedResponse)", () => {
  it("query: CPV 45*, buyer country DEU, contract award notices, one calendar year, limit capped at 250, page ≥ 1", () => {
    const q = buildTedQuery({ year: 2025, page: 0, limit: 999 });
    assert.match(q.query, /classification-cpv=45\*/);
    assert.match(q.query, /buyer-country IN \(DEU\)/);
    assert.match(q.query, /notice-type IN \(can-standard\)/);
    assert.match(q.query, /publication-date=\(20250101<>20251231\)/);
    assert.equal(q.limit, 250);
    assert.equal(q.page, 1);
    assert.ok(q.fields.includes("tender-value") && q.fields.includes("place-of-performance"));
    assert.equal(buildTedQuery({ year: 2024, page: 3, limit: 100 }).limit, 100);
    assert.equal(buildTedQuery({ year: 2024, page: 3, limit: 100 }).page, 3);
  });

  it("parallel arrays → one lot per EUR tender value; non-construction, foreign currency and broken notices are dropped without a throw", () => {
    const json = {
      notices: [
        // two lots, first 45* CPV wins, first DE* place wins
        { "tender-value": ["18962.00", "5000"], "tender-value-cur": ["EUR", "EUR"], "classification-cpv": ["03000000", "45120000"], "place-of-performance": ["DEA1A"] },
        { "classification-cpv": ["45000000"] },                                                   // no value → dropped
        { "tender-value": ["7000"], "classification-cpv": ["30192000"] },                         // no construction CPV → dropped
        { "tender-value": ["9000", "8000"], "tender-value-cur": ["EUR", "USD"], "classification-cpv": "45210000" }, // USD lot dropped
        { "tender-value": 30000, "classification-cpv": "45210000" },                              // scalar value, no place
        { "tender-value": ["abc"], "classification-cpv": ["45210000"] },                          // not a number → dropped
        null,                                                                                     // broken notice → skipped
      ],
    };
    const lots = parseTedResponse(json, "2025");
    assert.deepEqual(lots, [
      { value: 18962, cpv: "45120000", nuts: "DEA1A", year: 2025 },
      { value: 5000, cpv: "45120000", nuts: "DEA1A", year: 2025 },
      { value: 9000, cpv: "45210000", nuts: null, year: 2025 },
      { value: 30000, cpv: "45210000", nuts: null, year: 2025 },
    ]);
    assert.deepEqual(parseTedResponse({}, 2025), []);
    assert.deepEqual(parseTedResponse(null, 2025), []);
  });

  // FINDING F-28-01 (fixed in the belege finish): the place filter used to take the first entry that STARTS WITH "DE", so the
  // ISO country code "DEU" matched too and a notice listing the country before its NUTS code (["DEU", "DE21"]) was booked as
  // nationwide ("DE") instead of Bayern. Red before the fix: 'DEU' !== 'DE21'.
  it("TED place: the country code DEU is not a NUTS code — [\"DEU\", \"DE21\"] must give nuts \"DE21\" (Bayern)", () => {
    const [lot] = parseTedResponse({ notices: [{ "tender-value": ["50000"], "classification-cpv": ["45210000"], "place-of-performance": ["DEU", "DE21"] }] }, 2025);
    assert.equal(lot.nuts, "DE21");
    assert.equal(aggregateLots([lot])[0].region, "Bayern");
    // only "DEU"/"deu" → no place (nationwide later); NUTS 0 "DE" and NUTS 3 stay valid places
    const ort = (/** @type {string[]} */ p) => parseTedResponse({ notices: [{ "tender-value": ["50000"], "classification-cpv": ["45210000"], "place-of-performance": p }] }, 2025)[0].nuts;
    assert.equal(ort(["DEU"]), null);
    assert.equal(ort(["deu", "DEA1A"]), "DEA1A");
    assert.equal(ort(["DEU", "DE"]), "DE");
    assert.equal(ort(["DEUTSCHLAND", "FR10", "DEZZZ"]), "DEZZZ");
  });
});

describe("28 DÖE bulk CSV (parseDoeeCsv)", () => {
  // Invented notices N1…N5. Expected: only N1, highest version 2, two distinct tenders, EUR or empty currency.
  const tenderCsv = [
    "noticeIdentifier,noticeVersion,tenderId,tenderValue,tenderValueCurrency,titel",
    'N1,1,T1,50000,EUR,"alt, Version 1"',  // older version → dropped
    'N1,2,T1,60000,EUR,"Los 1,\nzweizeilig"', // kept
    "N1,2,T1,60000,EUR,Doppel",            // same (notice, tender) → dedupe
    "N1,2,T2,70000,,ohne Währung",         // empty currency counts as EUR
    "N2,1,T1,80000,USD,fremd",             // foreign currency → dropped
    "N3,1,T1,90000,EUR,kein Bau",          // CPV 30* → dropped
    "N5,1,T1,40000,EUR,ohne CPV",          // no classification row → dropped
  ].join("\n");
  const classificationCsv = "noticeIdentifier,mainClassificationCode\nN1,45210000\nN1,45000000\nN2,45210000\nN3,30192000\n";
  const placeCsv = "noticeIdentifier,placePerformanceCountrySubdivision\nN1,DE21\nN1,DE3\n";
  const submissionsCsv = "noticeIdentifier,receivedSubmissionsCount\nN1,4\n";

  it("joins tender × classification × place × submissions over noticeIdentifier; highest version, dedupe, EUR, CPV 45* only", () => {
    const lots = parseDoeeCsv({ tenderCsv, classificationCsv, placeCsv, submissionsCsv, year: 2025 });
    assert.deepEqual(lots, [
      { value: 60000, cpv: "45210000", nuts: "DE21", year: 2025, bidders: 4 },
      { value: 70000, cpv: "45210000", nuts: "DE21", year: 2025, bidders: 4 },
    ]);
  });

  it("submissions are optional; without any file nothing comes out and nothing throws", () => {
    const lots = parseDoeeCsv({ tenderCsv, classificationCsv, placeCsv, year: 2025 });
    assert.equal(lots.length, 2);
    assert.ok(lots.every((l) => !("bidders" in l)));
    assert.deepEqual(parseDoeeCsv(), []);
  });
});

describe("28 aggregation (aggregateLots): median, Q1/Q3, hygiene", () => {
  const lot = (/** @type {number} */ value, extra = {}) => ({ value, cpv: "45331000", nuts: "DE21", year: 2025, ...extra });

  it("odd n: Q1/Q3 are the medians of the lower/upper half WITHOUT the median", () => {
    // sorted 100k 150k 200k 250k 300k → median 200k; lower [100k, 150k] → 125k; upper [250k, 300k] → 275k
    const [c] = aggregateLots([lot(300000), lot(100000), lot(250000), lot(150000), lot(200000)], { source: "doee", fetched_at: "2026-01-01" });
    assert.deepEqual(
      { n: c.n, median: c.median, q1: c.q1, q3: c.q3, min: c.min, max: c.max },
      { n: 5, median: 200000, q1: 125000, q3: 275000, min: 100000, max: 300000 },
    );
    assert.equal(c.ebene, "los"); // never a unit price
    assert.equal(c.cpv_group, "4533");
    assert.equal(c.cpv_label, "Heizung/Lüftung/Sanitär");
    assert.equal(c.region, "Bayern");
    assert.equal(c.year, 2025);
    assert.equal(c.currency, "EUR");
    assert.equal(c.source, "doee");
    assert.equal(c.fetched_at, "2026-01-01");
    assert.equal(c.avg_bidders, null);
  });

  it("even n: median = mean of the two middle values, halves split evenly", () => {
    // sorted 10k 20k 40k 80k → median (20k+40k)/2 = 30k; lower [10k, 20k] → 15k; upper [40k, 80k] → 60k
    const [c] = aggregateLots([lot(80000), lot(10000), lot(40000), lot(20000)]);
    assert.deepEqual({ n: c.n, median: c.median, q1: c.q1, q3: c.q3 }, { n: 4, median: 30000, q1: 15000, q3: 60000 });
    assert.equal(c.source, "demo"); // default source
  });

  it("n = 1: Q1 = Q3 = the only value", () => {
    const [c] = aggregateLots([lot(12345.6)]);
    assert.deepEqual({ median: c.median, q1: c.q1, q3: c.q3, min: c.min, max: c.max }, { median: 12346, q1: 12346, q3: 12346, min: 12346, max: 12346 });
  });

  it("placeholders below 1 000 EUR, non-finite values and non-construction CPV are dropped; cells split by group × state × year", () => {
    const cells = aggregateLots([
      lot(999.99), lot(0.01), lot(NaN), lot(Infinity), lot(50000, { cpv: "30192000" }), // all dropped
      lot(1000),                                       // exactly 1 000 EUR is kept
      lot(60000, { nuts: "DEA1" }),                    // other state
      lot(70000, { year: 2024 }),                      // other year
      lot(80000, { cpv: "45210000" }),                 // other group
      null,
    ]);
    const keys = cells.map((c) => `${c.cpv_group}|${c.region}|${c.year}|${c.n}|${c.median}`).sort();
    assert.deepEqual(keys, ["4521|Bayern|2025|1|80000", "4533|Bayern|2024|1|70000", "4533|Bayern|2025|1|1000", "4533|Nordrhein-Westfalen|2025|1|60000"]);
    assert.deepEqual(aggregateLots(undefined), []);
  });

  it("average bidder count to one decimal over the lots that carry one", () => {
    // (3 + 4 + 4) / 3 = 3.67 → 3.7
    const [c] = aggregateLots([lot(10000, { bidders: 3 }), lot(20000, { bidders: 4 }), lot(30000, { bidders: 4 }), lot(40000)]);
    assert.equal(c.avg_bidders, 3.7);
  });
});

describe("28 benchmark lookup (benchmarkFor): exact, nationwide, newest year", () => {
  const z = (/** @type {string} */ g, /** @type {string} */ region, /** @type {number} */ year) => ({ cpv_group: g, region, year, n: 30, median: 1 });
  const A = z("4533", "Bayern", 2025), B = z("4533", "DE", 2025), C = z("4533", "Hessen", 2023), D = z("4533", "DE", 2024), E = z("4521", "Bayern", 2025);
  const cells = [C, D, A, B, E];

  it("exact group × region × year is an exact hit", () => {
    assert.deepEqual(benchmarkFor(cells, { trade: "TGA", region: "Bayern", year: 2025 }), { cell: A, exact: true });
    assert.deepEqual(benchmarkFor(cells, { trade: "Rohbau", region: "Bayern", year: "2025" }), { cell: E, exact: true });
  });

  it("missing region → the nationwide cell of the same year, not exact", () => {
    assert.deepEqual(benchmarkFor(cells, { trade: "TGA", region: "Sachsen", year: 2025 }), { cell: B, exact: false });
    assert.deepEqual(benchmarkFor(cells, { trade: "TGA", year: 2024 }), { cell: D, exact: false });
  });

  it("missing year → newest year; preference: wanted region, then nationwide, then any", () => {
    assert.deepEqual(benchmarkFor(cells, { trade: "TGA", region: "Hessen", year: 2026 }), { cell: C, exact: false });
    assert.deepEqual(benchmarkFor(cells, { trade: "TGA", region: "Sachsen", year: 2026 }), { cell: B, exact: false });
    assert.deepEqual(benchmarkFor([C], { trade: "TGA", region: "Sachsen", year: 2026 }), { cell: C, exact: false });
  });

  it("unknown trade maps to CPV 4500; no cell in the group or no list → none, never a throw", () => {
    assert.deepEqual(benchmarkFor(cells, { trade: "Sonstige", region: "DE", year: 2025 }), { none: true, reason: "keine Zelle für CPV-Gruppe" });
    assert.equal(benchmarkFor([z("4500", "DE", 2025)], { trade: "Sonstige" }).cell.cpv_group, "4500");
    assert.equal(benchmarkFor(null, { trade: "TGA" }).none, true);
    assert.equal(benchmarkFor(cells).none, true); // no trade → 4500 → none here
  });
});

describe("28 corridor text (korridorText): trust levels by n", () => {
  const cell = { median: 1234567, q1: 500400, q3: 2000000 };
  it("n ≥ 20: median and Q1–Q3 span in thousand euro (de-DE)", () => {
    // 1 234 567 € → 1 235 T€; 500 400 € → 500 T€; 2 000 000 € → 2 000 T€
    assert.equal(korridorText({ ...cell, n: 25 }), "Median 1.235 T€ · Spanne 500 T€–2.000 T€ (Q1–Q3) · n=25");
    assert.match(korridorText({ ...cell, n: 20 }), /Spanne/);
  });
  it("5 ≤ n < 20: median and n only, no span", () => {
    assert.equal(korridorText({ ...cell, n: 7 }), "Median 1.235 T€ · n=7 (zu wenig Zuschläge für Quartilsspanne)");
    assert.doesNotMatch(korridorText({ ...cell, n: 19 }), /Spanne/);
    assert.match(korridorText({ ...cell, n: 5 }), /n=5/);
  });
  it("n < 5, missing n or no cell: no number at all (null)", () => {
    assert.equal(korridorText({ ...cell, n: 4 }), null);
    assert.equal(korridorText({ ...cell, n: NaN }), null);
    assert.equal(korridorText({ ...cell }), null);
    assert.equal(korridorText(null), null);
  });
  it("never a unit price: no €/m², €/Stk or similar in any tier", () => {
    for (const n of [5, 19, 20, 200]) assert.doesNotMatch(korridorText({ ...cell, n }), /€\s*\/|\/\s*(m|Stk|St)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// TED proxy route: always HTTP 200, { offline: true } on every failure path, body reduced to the expected fields, limit ≤ 250,
// target URL fixed. The test server listens on an ephemeral port on 127.0.0.1; global fetch is the stub, the test talks to its
// own server through node:http so the stub never sees that traffic.
// ---------------------------------------------------------------------------------------------------------------------------
describe("28 TED proxy POST /api/prices/ted-search", () => {
  /** @type {http.Server} */
  let server;
  let port = 0;
  const echtesFetch = globalThis.fetch;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", pricesRouter());
    server = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
    port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  });
  after(() => new Promise((ok) => server.close(() => ok(undefined))));
  afterEach(() => { globalThis.fetch = echtesFetch; });

  /** POST JSON to the test server. @param {any} body @returns {Promise<{status: number, json: any}>} */
  const post = (body) => new Promise((ok, fail) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path: "/api/prices/ted-search", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let text = "";
      res.on("data", (c) => { text += c; });
      res.on("end", () => { try { ok({ status: res.statusCode || 0, json: JSON.parse(text) }); } catch (e) { fail(e); } });
    });
    req.on("error", fail);
    req.end(data);
  });

  it("network error (offline) → 200 { offline: true }, never 5xx", async () => {
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    const r = await post(buildTedQuery({ year: 2025 }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { offline: true });
  });

  it("upstream error status (429, 504) → 200 { offline: true, status }", async () => {
    for (const status of [429, 504]) {
      globalThis.fetch = async () => new Response("busy", { status });
      const r = await post({ query: "x" });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { offline: true, status });
    }
  });

  it("success: answer passed through; request goes to the fixed TED URL with only the expected fields and limit ≤ 250", async () => {
    /** @type {any[]} */
    const aufrufe = [];
    globalThis.fetch = async (url, init) => {
      aufrufe.push({ url: String(url), init });
      return new Response(JSON.stringify({ notices: [{ "tender-value": ["1"] }], totalNoticeCount: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const r = await post({ query: "classification-cpv=45*", fields: ["tender-value"], page: 0, scope: "ALL", limit: 5000, ziel: "https://example.invalid", extra: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { notices: [{ "tender-value": ["1"] }], totalNoticeCount: 1 });
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0].url, "https://api.ted.europa.eu/v3/notices/search");
    assert.equal(aufrufe[0].init.method, "POST");
    assert.deepEqual(JSON.parse(aufrufe[0].init.body), { query: "classification-cpv=45*", fields: ["tender-value"], page: 1, scope: "ALL", limit: 250 });
    assert.ok(aufrufe[0].init.signal, "a timeout signal is set");
  });

  it("non-string query and non-array fields are not forwarded", async () => {
    /** @type {any} */
    let gesendet = null;
    globalThis.fetch = async (_url, init) => { gesendet = JSON.parse(String(init?.body)); return new Response("{}", { status: 200 }); };
    await post({ query: { $where: "1" }, fields: "alles", limit: 10, page: 2 });
    assert.deepEqual(gesendet, { page: 2, limit: 10 });
  });
});
