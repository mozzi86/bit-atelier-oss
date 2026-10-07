// befundHtml.js — standalone HTML summary of a check run (Phase 69-14).
//
// Why: the findings package must open WITHOUT any software (plan must-have) —
// a single .html with inline CSS, no external resources except the footer
// link back to the platform. Pure function, no DOM, fully escaped.
//
// In:  { projekt, datum, kennzahlen, befunde, fussnote } — befunde are the
//      clash findings (clash.js shape) and IDS results (evaluateIds shape).
// Out: a complete HTML document string.

// 83-02: the footer points at the open-source project instead of the former demo.
import { REPO_URL } from "@core/lib/projektInfo";

/**
 * Escape the five XML-significant characters — everything user/model-derived
 * passes through this before landing in the document.
 * @param {unknown} v any value (stringified)
 * @returns {string} escaped text
 */
export function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * German label for a finding kind — same wording family as ModelCheck's
 * KIND_LABELS (one truth would be nicer, but that map lives inside the .jsx
 * page; duplicating four strings is cheaper than extracting a module the
 * plan did not ask for — documented in the SUMMARY).
 * @param {string} kind clash finding kind
 * @returns {string} label
 */
function artLabel(kind) {
  const M = {
    hard: "Kollision",
    clearance: "Abstand",
    duplicate: "Duplikat",
    enthalten: "nicht größer als (AABB-Näherung)",
    gefuellt: "gefüllt (AABB-Näherung)",
    deckung: "deckungsgleich (AABB-Näherung)",
    ohne_partner: "ohne Gegenstück",
  };
  return M[kind] || kind || "Befund";
}

/**
 * Build the standalone HTML summary.
 * @param {{
 *   projekt?: string, modell?: string, datum?: string, regelsatz?: string,
 *   kennzahlen?: {bauteile?: number, kollisionen?: number, duplikate?: number,
 *                 idsFehler?: number, [k: string]: number|undefined},
 *   befunde?: {clash?: any[], ids?: any[]},
 *   fussnote?: string
 * }} p
 *   kennzahlen: the run's key figures; befunde.clash: clash.js findings
 *   ({kind, aType, bType, aGuid, bGuid, overlapVol, center, abweichungMm?});
 *   befunde.ids: evaluateIds results ({spec:{name}, bestanden, verletzungen}).
 *   The list is capped at 200 rows — an HTML with 10,000 <li> is not a
 *   summary [ASSUMED]; the BCF/PDF carry the full detail.
 * @returns {string} complete HTML document
 */
export function befundHtml({ projekt = "—", modell = "—", datum = "—", regelsatz = "", kennzahlen = {}, befunde = {}, fussnote = "" } = {}) {
  const k = kennzahlen || {};
  const clash = Array.isArray(befunde.clash) ? befunde.clash : [];
  const ids = Array.isArray(befunde.ids) ? befunde.ids : [];
  const idsOffen = ids.filter((r) => r && r.bestanden === false);
  const MAX = 200;

  /** One table row for the key figures. */
  const zeile = (label, wert) =>
    `<tr><td>${esc(label)}</td><td class="z">${esc(wert)}</td></tr>`;

  const clashZeilen = clash.slice(0, MAX).map((c, i) => {
    const abw = c.abweichungMm == null ? "" : ` · Abweichung ${Number(c.abweichungMm).toFixed(1)} mm`;
    const mitte = c.center ? ` @ (${Number(c.center.x || 0).toFixed(2)} / ${Number(c.center.y || 0).toFixed(2)} / ${Number(c.center.z || 0).toFixed(2)} m)` : "";
    return (
      `<li><span class="n">${i + 1}.</span> <b>${esc(artLabel(c.kind))}</b>: ` +
      `${esc(c.aType || "?")} <code>${esc(c.aGuid || "—")}</code> ↔ ${esc(c.bType || "?")} <code>${esc(c.bGuid || "—")}</code>` +
      `${esc(mitte)}${esc(abw)}</li>`
    );
  }).join("\n");

  const idsZeilen = idsOffen.slice(0, MAX).map((r, i) => {
    const v = Array.isArray(r.verletzungen) ? r.verletzungen : [];
    const erste = v.slice(0, 5).map((x) =>
      `<li><code>${esc(x.globalId || "—")}</code> ${esc(x.elementName || "")}: ${esc(x.facette || "")} — erwartet ${esc(x.erwartet ?? "?")}, gefunden ${esc(x.gefunden ?? "—")}</li>`
    ).join("");
    return (
      `<li><span class="n">${i + 1}.</span> <b>IDS verletzt: ${esc(r.spec?.name || "?")}</b>` +
      (v.length ? ` (${v.length} Element${v.length === 1 ? "" : "e"})<ul>${erste}${v.length > 5 ? `<li>… und ${v.length - 5} weitere</li>` : ""}</ul>` : "") +
      `</li>`
    );
  }).join("\n");

  const leer =
    clash.length === 0 && idsOffen.length === 0
      ? `<p class="leer">Keine Befunde in diesem Lauf — Kollisions- und IDS-Prüfung sind ohne Verstöße durchgelaufen.</p>`
      : "";
  const gekuerzt =
    clash.length > MAX || idsOffen.length > MAX
      ? `<p class="leer">Liste gekürzt (erste ${MAX} je Art) — vollständig im BCF und im PDF-Bericht.</p>`
      : "";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Befund-Zusammenfassung — ${esc(projekt)}</title>
<style>
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; margin: 0; background: #f8fafc; }
  .blatt { max-width: 46rem; margin: 2rem auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 1.5rem 0 .5rem; color: #334155; }
  .meta { color: #64748b; font-size: .85rem; }
  table.kpi { border-collapse: collapse; margin-top: .75rem; }
  table.kpi td { border: 1px solid #e2e8f0; padding: .3rem .6rem; }
  table.kpi td.z { text-align: right; font-variant-numeric: tabular-nums; min-width: 4rem; }
  ol { padding-left: 0; list-style: none; }
  ol > li { margin: .35rem 0; }
  ol ul { margin: .2rem 0 .4rem 1.2rem; padding-left: 1rem; }
  .n { color: #94a3b8; font-variant-numeric: tabular-nums; }
  code { background: #f1f5f9; border-radius: 4px; padding: 0 .25rem; font-size: .85em; }
  .leer { color: #475569; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: .6rem .8rem; }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: .78rem; }
  footer a { color: #0d9488; text-decoration: none; }
</style>
</head>
<body>
<div class="blatt">
  <h1>Befund-Zusammenfassung</h1>
  <p class="meta">Projekt: <b>${esc(projekt)}</b> · Modell: ${esc(modell)} · Datum: ${esc(datum)}${regelsatz ? ` · Regelsatz: ${esc(regelsatz)}` : ""}</p>

  <h2>Kennzahlen des Laufs</h2>
  <table class="kpi">
    ${zeile("Bauteile mit Geometrie", k.bauteile ?? 0)}
    ${zeile("Kollisionen (hart)", k.kollisionen ?? 0)}
    ${zeile("Duplikate", k.duplikate ?? 0)}
    ${zeile("IDS-Verstöße (Spezifikationen)", k.idsFehler ?? 0)}
  </table>

  <h2>Geometrische Befunde (${clash.length})</h2>
  ${clash.length ? `<ol>\n${clashZeilen}\n</ol>` : ""}

  <h2>IDS-Verstöße (${idsOffen.length})</h2>
  ${idsOffen.length ? `<ol>\n${idsZeilen}\n</ol>` : ""}
  ${leer}${gekuerzt}

  ${fussnote ? `<p class="meta">${esc(fussnote)}</p>` : ""}

  <footer>
    Erstellt mit BIT-Atelier — läuft im Browser, Ihre Daten verlassen Ihr Gerät nicht.<br>
    Open Source (MIT): <a href="${esc(REPO_URL)}">${esc(REPO_URL)}</a>
  </footer>
</div>
</body>
</html>`;
}
