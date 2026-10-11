// 90-09: the site Gantt (ScheduleTask list) as ONE large-format landscape page for plotting — A0 to A3,
// scaled to fit like the office skill "planner-gantt-pdf" (which adds the office logo; here no office data).
// Drawn with jspdf (vectors, sharp when plotted), imported dynamically.
//
// In:  tasks ({ name, start_date, end_date, progress, trade, planner_ebene? }), project, format.
// Out: { bytes: Uint8Array, dateiname, bericht: { zeilen, zeileH_mm, von, bis } }.

/** Landscape sheet sizes in mm (DIN 476). */
export const FORMATE = Object.freeze({ A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297] });

/** 12 bucket colours, readable on white, repeated when there are more buckets. */
const PALETTE = [[59, 130, 246], [16, 185, 129], [245, 158, 11], [139, 92, 246], [239, 68, 68], [6, 182, 212], [236, 72, 153], [132, 204, 22], [100, 116, 139], [234, 88, 12], [20, 184, 166], [168, 85, 247]];

const TAG = 86400000;
const tag = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);

/**
 * Layout numbers (exported for tests): time range padded to whole months, row height that fits all rows
 * on the sheet (capped at 8 mm, at least 1.2 mm), name column width = 22 % of the sheet [ASSUMED].
 * @param {Array<{start_date: string, end_date: string}>} tasks
 * @param {keyof typeof FORMATE} format
 */
export function ganttLayout(tasks, format = "A1") {
  const [w, h] = FORMATE[format] || FORMATE.A1;
  const rand = Math.max(8, w * 0.012), kopf = Math.max(18, h * 0.06), achse = 10, legende = 10;
  const starts = tasks.map((t) => tag(t.start_date)).filter(Number.isFinite), ends = tasks.map((t) => tag(t.end_date)).filter(Number.isFinite);
  const heute = Date.now();
  const v = new Date(starts.length ? Math.min(...starts) : heute), b = new Date(ends.length ? Math.max(...ends) : heute + 30 * TAG);
  const von = Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), 1), bis = Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1);
  const nameW = w * 0.22;
  const plotX = rand + nameW, plotW = w - rand - plotX;
  const plotY = rand + kopf + achse, plotH = h - plotY - rand - legende;
  const zeileH = Math.max(1.2, Math.min(8, plotH / Math.max(1, tasks.length)));
  return { w, h, rand, kopf, achse, nameW, plotX, plotW, plotY, plotH, zeileH, von, bis, x: (ms) => plotX + ((ms - von) / (bis - von)) * plotW };
}

/**
 * @param {Array<any>} tasks
 * @param {{name?: string}|null} projekt
 * @param {{format?: keyof typeof FORMATE, titel?: string, jetzt?: Date}} [o]
 * @returns {Promise<{bytes: Uint8Array, dateiname: string, bericht: {zeilen: number, zeileH_mm: number, von: string, bis: string}}>}
 */
export async function ganttPdf(tasks, projekt, { format = "A1", titel = "Terminplan", jetzt = new Date() } = {}) {
  const { jsPDF } = await import("jspdf");
  const liste = [...tasks].filter((t) => Number.isFinite(tag(t.start_date)) && Number.isFinite(tag(t.end_date)))
    .sort((a, b) => String(a.planner_gliederung || "").localeCompare(String(b.planner_gliederung || ""), "de", { numeric: true }) || tag(a.start_date) - tag(b.start_date));
  const L = ganttLayout(liste, format);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [L.w, L.h] });
  const s = L.w / 841; // font scale relative to A1
  // Header
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(22 * s); pdf.text(`${titel}${projekt?.name ? ` – ${projekt.name}` : ""}`, L.rand, L.rand + 9 * s);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10 * s);
  pdf.text(`Stand ${jetzt.toLocaleDateString("de-DE")} · ${liste.length} Vorgänge · Format ${format} quer`, L.rand, L.rand + 15 * s);
  // Month axis + grid
  pdf.setFontSize(Math.max(5, 8 * s)); pdf.setDrawColor(220); pdf.setLineWidth(0.15);
  const monat = new Date(L.von);
  while (monat.getTime() < L.bis) {
    const x = L.x(monat.getTime());
    pdf.line(x, L.plotY - 2, x, L.plotY + liste.length * L.zeileH);
    pdf.setTextColor(90); pdf.text(monat.toLocaleDateString("de-DE", { month: "short", year: "2-digit", timeZone: "UTC" }), x + 1, L.plotY - 3);
    monat.setUTCMonth(monat.getUTCMonth() + 1);
  }
  pdf.setTextColor(0);
  // Rows
  const buckets = [...new Set(liste.map((t) => t.trade || ""))];
  const farbe = (b) => PALETTE[buckets.indexOf(b) % PALETTE.length];
  const fs = Math.max(3.5, Math.min(9 * s, L.zeileH * 2.2));
  pdf.setFontSize(fs);
  liste.forEach((t, i) => {
    const y = L.plotY + i * L.zeileH;
    if (i % 2 === 0) { pdf.setFillColor(248, 250, 252); pdf.rect(L.rand, y, L.w - 2 * L.rand, L.zeileH, "F"); }
    const ebene = Number(t.planner_ebene) || 0;
    const sammel = liste.some((x) => x.planner_gliederung && t.planner_gliederung && String(x.planner_gliederung).startsWith(`${t.planner_gliederung}.`));
    pdf.setFont("helvetica", sammel ? "bold" : "normal");
    let name = String(t.name || "");
    const maxW = L.nameW - 4 - ebene * 3 * s;
    while (name.length > 1 && pdf.getTextWidth(name) > maxW) name = name.slice(0, -2) + "…";
    pdf.text(name, L.rand + 1 + ebene * 3 * s, y + L.zeileH * 0.72);
    const x0 = L.x(tag(t.start_date)), x1 = Math.max(x0 + 0.6, L.x(tag(t.end_date) + TAG));
    const [r, g, b] = farbe(t.trade || "");
    const bh = L.zeileH * (sammel ? 0.4 : 0.66), by = y + (L.zeileH - bh) / 2;
    pdf.setFillColor(r, g, b); pdf.rect(x0, by, x1 - x0, bh, "F");
    const p = Math.max(0, Math.min(100, Number(t.progress) || 0));
    if (p > 0) { pdf.setFillColor(Math.round(r * 0.55), Math.round(g * 0.55), Math.round(b * 0.55)); pdf.rect(x0, by + bh * 0.6, (x1 - x0) * p / 100, bh * 0.4, "F"); }
  });
  // Today line
  const heute = Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate());
  if (heute >= L.von && heute <= L.bis) { pdf.setDrawColor(220, 38, 38); pdf.setLineWidth(0.4); pdf.line(L.x(heute), L.plotY - 2, L.x(heute), L.plotY + liste.length * L.zeileH); }
  // Bucket legend
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(Math.max(5, 8 * s));
  let lx = L.rand; const ly = L.h - L.rand - 3;
  for (const bkt of buckets) {
    const [r, g, b] = farbe(bkt);
    pdf.setFillColor(r, g, b); pdf.rect(lx, ly - 3 * s, 6 * s, 3 * s, "F");
    const txt = bkt || "ohne Bucket";
    pdf.text(txt, lx + 8 * s, ly - 0.5 * s);
    lx += 12 * s + pdf.getTextWidth(txt);
    if (lx > L.w - L.rand - 40) break;
  }
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const safe = String(projekt?.name || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname: `${safe}_Gantt_${format}.pdf`, bericht: { zeilen: liste.length, zeileH_mm: Math.round(L.zeileH * 100) / 100, von: iso(L.von), bis: iso(L.bis) } };
}
