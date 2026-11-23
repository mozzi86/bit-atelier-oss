// Generates the BIT-Atelier design file (design/bit-atelier-design.figcraft) from design/bit-atelier-tokens.json with the FigCraft
// command line — so the design file never drifts from the values the app is built on. Run it after every change of the tokens
// or of the layout decisions (.planning/phases/115-bedienung-gebaeudemodell/115-CONTEXT.md, 115-DESIGN.md) and commit the result.
//
// Run from the repo root:  node scripts/figcraft-design.mjs
// Needs FigCraft (figcraft-cli); path via FIGCRAFT_CLI, default "C:/Program Files/FigCraft/figcraft-cli.exe".
// In:  design/bit-atelier-tokens.json. Out: design/bit-atelier-design.figcraft and design/vorschau/*.png (one picture per page).
//
// How: one script of commands for `figcraft-cli run`. Layers name their parent by a symbolic key; FigCraft numbers layers in the
// order of creation, so the script is run once to learn the ids and again with the real parents (checked: the ids must not change).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HIER = join(dirname(fileURLToPath(import.meta.url)), "..", "design"); // the design folder: tokens in, design file and previews out
const CLI = process.env.FIGCRAFT_CLI || "C:/Program Files/FigCraft/figcraft-cli.exe";
const T = JSON.parse(readFileSync(join(HIER, "bit-atelier-tokens.json"), "utf8"));
const SCHRIFT = T.schrift.familie;

/** @type {Array<{command: string, params: Record<string, any>, key?: string, parentKey?: string}>} */
const schritte = [];
const v = (/** @type {string} */ name) => ({ $var: name }); // a fill or stroke bound to a variable
let nr = 0;
const neu = (/** @type {string} */ k) => `${k}#${++nr}`;

/** Frame; returns its key for children. Sizes in px. */
function rahmen(name, x, y, w, h, props = {}, parentKey = undefined) {
  const key = neu(name);
  schritte.push({ command: "node.create", key, parentKey, params: { type: "frame", x, y, width: w, height: h, name, props: { fill: v("farbe/weiss"), clip: true, ...props }, select: false } });
  return key;
}
function flaeche(parentKey, name, x, y, w, h, props = {}) {
  const key = neu(name);
  schritte.push({ command: "node.create", key, parentKey, params: { type: "rectangle", x, y, width: w, height: h, name, props, select: false } });
  return key;
}
function kreis(parentKey, name, x, y, d, props = {}) {
  schritte.push({ command: "node.create", key: neu(name), parentKey, params: { type: "ellipse", x, y, width: d, height: d, name, props, select: false } });
}
function linie(parentKey, name, x, y, w, h, props = {}) { // a hairline as a thin rectangle (1 px), fill = line colour
  return flaeche(parentKey, name, x, y, w, h, { fill: v("farbe/grau-4"), ...props });
}
/** Text in one of the nine type steps (by name) or with explicit size. */
function text(parentKey, inhalt, x, y, stufe = "Text", props = {}, breite = undefined) {
  const s = T.schrift.stufen.find((/** @type {any[]} */ z) => z[0] === stufe) || ["", 15, 22, "Regular"];
  schritte.push({ command: "text.create", key: neu("t"), parentKey, params: { text: inhalt, x, y, ...(breite ? { width: breite } : {}), name: inhalt.slice(0, 40),
    props: { fontFamily: SCHRIFT, fontStyle: s[3], fontSize: s[1], lineHeight: s[2], fill: v("farbe/schwarz"), ...props }, select: false } });
}
function seite(name, erste = false) {
  schritte.push(erste ? { command: "page.rename", params: { name } } : { command: "page.add", params: { name } });
  schritte.push({ command: "page.setBackground", params: { color: T.farben["farbe/grau-6"][0] } });
}

// ---- variables: one collection with a light and a dark mode ----------------------------------------------------------------
schritte.push({ command: "variable.createCollection", params: { name: "BIT-Atelier", modes: ["Hell", "Dunkel"] } });
for (const [name, [hell, dunkel]] of Object.entries(T.farben)) schritte.push({ command: "variable.create", params: { collection: "BIT-Atelier", name, type: "color", values: { Hell: hell, Dunkel: dunkel } } });
for (const [name, wert] of Object.entries(T.werkbank)) schritte.push({ command: "variable.create", params: { collection: "BIT-Atelier", name, type: "color", values: { Hell: wert, Dunkel: wert } } });
for (const a of T.abstand) schritte.push({ command: "variable.create", params: { collection: "BIT-Atelier", name: `abstand/${a}`, type: "number", values: { Hell: a, Dunkel: a } } });
for (const [n, r] of Object.entries(T.radius)) schritte.push({ command: "variable.create", params: { collection: "BIT-Atelier", name: `radius/${n}`, type: "number", values: { Hell: r, Dunkel: r } } });

// ---- 00 overview -------------------------------------------------------------------------------------------------------------
seite("00 · Übersicht", true);
{
  const f = rahmen("Gestaltungsgrundlage", 0, 0, 1200, 760);
  text(f, "BIT-Atelier", 64, 64, "Label", { fill: v("farbe/grau-2") });
  text(f, "Gestaltungsgrundlage", 64, 88, "Display");
  text(f, `Stand ${T.stand} · erzeugt aus design/bit-atelier-tokens.json · Regeln: ${T.quelle}`, 64, 140, "Klein", { fill: v("farbe/grau-2") }, 1070);
  linie(f, "Linie", 64, 184, 1072, 1);
  const saetze = [
    ["Sofort schön", "Jede Ansicht sieht ohne Nacharbeit wie eine Architekturdarstellung aus."],
    ["Flach und ruhig", "Schwarz auf Weiß, Grautöne. Kein Glas, keine Verläufe, keine Glanzschatten."],
    ["Eine Trennung je Fläche", "Eine 1-px-Linie oder ein schwebender Schatten – Schatten nur über dem Modell."],
    ["Akzent ist Schwarz", "Ein schwarzer Primärknopf je Bereich; weiße Schrift steht nur dort."],
    ["Farbe trägt Bedeutung", "Status immer als Farbe, Form und Wort. Keine Farbe als Schmuck."],
    ["Zeichnung zuerst", "Die Zeichenfläche ist die größte Fläche; nichts springt beim Wechseln der Ansicht."],
  ];
  saetze.forEach(([titel, satz], i) => {
    const y = 216 + i * 84;
    text(f, String(i + 1).padStart(2, "0"), 64, y, "Kennzahl", { fill: v("farbe/grau-4") });
    text(f, titel, 136, y, "Titel 3");
    text(f, satz, 136, y + 28, "Text", { fill: v("farbe/grau-1") }, 980);
  });
}

// ---- 01 colours ----------------------------------------------------------------------------------------------------------------
seite("01 · Farben");
{
  const namen = Object.keys(T.farben);
  const f = rahmen("Farben · Hell", 0, 0, 1200, 120 + Math.ceil(namen.length / 6) * 150 + 40);
  text(f, "Farben", 48, 40, "Titel 1");
  text(f, "Jedes Feld ist an seine Variable gebunden (Sammlung „BIT-Atelier“, Modi Hell und Dunkel).", 48, 80, "Klein", { fill: v("farbe/grau-2") });
  namen.forEach((name, i) => {
    const x = 48 + (i % 6) * 186, y = 124 + Math.floor(i / 6) * 150;
    flaeche(f, name, x, y, 170, 80, { fill: v(name), cornerRadius: 8, stroke: v("farbe/grau-4"), strokeWeight: 1, strokeAlign: "inside" });
    text(f, name, x, y + 90, "Klein");
    text(f, `${T.farben[name][0]} · dunkel ${T.farben[name][1]}`, x, y + 110, "Label", { fill: v("farbe/grau-2") });
  });
}

// ---- 02 white model ------------------------------------------------------------------------------------------------------------
seite("02 · Weißmodell");
{
  const f = rahmen("Weißmodell (3D-Standard)", 0, 0, 1200, 760);
  text(f, "Weißmodell", 48, 40, "Titel 1");
  text(f, "Standard der 3D-Ansicht: Gebäude weiß, Umgebung grau, Grün und Wasser nur angedeutet, feine schwarze Kanten. Materialfarben erst im Render-Modus.", 48, 80, "Text", { fill: v("farbe/grau-1") }, 1100);
  Object.keys(T.werkbank).forEach((name, i) => {
    const x = 48 + (i % 7) * 160, y = 150 + Math.floor(i / 7) * 120;
    flaeche(f, name, x, y, 144, 56, { fill: v(name), cornerRadius: 8, stroke: v("farbe/grau-4"), strokeWeight: 1, strokeAlign: "inside" });
    text(f, name.replace("werkbank/", ""), x, y + 64, "Klein");
    text(f, T.werkbank[name], x, y + 84, "Label", { fill: v("farbe/grau-2") });
  });
  // a small scene in the palette: ground, lawn, path, neighbour, house with a shaded side
  const s = flaeche(f, "Szene Grund", 48, 410, 1104, 310, { fill: v("werkbank/grund"), cornerRadius: 16 });
  void s;
  flaeche(f, "Rasen", 96, 600, 1008, 96, { fill: v("werkbank/rasen"), cornerRadius: 8 });
  flaeche(f, "Weg", 520, 600, 72, 96, { fill: v("werkbank/weg") });
  flaeche(f, "Nachbar", 150, 500, 200, 100, { fill: v("werkbank/nachbar"), stroke: v("werkbank/kante"), strokeWeight: 1 });
  flaeche(f, "Nachbar Seite", 350, 500, 60, 100, { fill: v("werkbank/nachbar-seite"), stroke: v("werkbank/kante"), strokeWeight: 1 });
  flaeche(f, "Haus", 470, 470, 260, 130, { fill: v("werkbank/volumen"), stroke: v("werkbank/kante"), strokeWeight: 1 });
  flaeche(f, "Haus Seite", 730, 470, 90, 130, { fill: v("werkbank/volumen-seite"), stroke: v("werkbank/kante"), strokeWeight: 1 });
  flaeche(f, "Dach", 458, 448, 374, 22, { fill: v("werkbank/volumen-schatten"), stroke: v("werkbank/kante"), strokeWeight: 1 });
  [500, 580, 660].forEach((x, i) => flaeche(f, `Fenster ${i + 1}`, x, 510, 44, 50, { fill: v("werkbank/wasser"), stroke: v("werkbank/kante"), strokeWeight: 1 }));
  kreis(f, "Baum", 900, 520, 80, { fill: v("werkbank/baum") });
  flaeche(f, "Stamm", 934, 596, 12, 24, { fill: v("werkbank/stamm") });
}

// ---- 03 type ---------------------------------------------------------------------------------------------------------------------
seite("03 · Schrift");
{
  const f = rahmen("Schrift", 0, 0, 1200, 760);
  text(f, "Schrift", 48, 40, "Titel 1");
  text(f, `${SCHRIFT} in neun Stufen. Kleinste Stufe 12 px, keine Versalien-Beschriftungen, fett nur für Zahlen.`, 48, 80, "Klein", { fill: v("farbe/grau-2") });
  let y = 132;
  for (const [name, groesse, zeile, schnitt, zweck] of T.schrift.stufen) {
    text(f, "Grundriss Erdgeschoss 1:100", 48, y, name);
    text(f, `${name} · ${groesse}/${zeile} · ${schnitt}`, 620, y + Math.max(0, (zeile - 18) / 2), "Klein", { fill: v("farbe/grau-2") });
    text(f, zweck, 900, y + Math.max(0, (zeile - 18) / 2), "Klein", { fill: v("farbe/grau-2") });
    y += zeile + 30;
    linie(f, "Linie", 48, y - 15, 1104, 1, { fill: v("farbe/grau-5") });
  }
}

// ---- 04 sizes --------------------------------------------------------------------------------------------------------------------
seite("04 · Maße");
{
  const f = rahmen("Maße", 0, 0, 1200, 620);
  text(f, "Maße", 48, 40, "Titel 1");
  text(f, "Abstände", 48, 100, "Titel 3");
  let x = 48;
  for (const a of T.abstand) { flaeche(f, `abstand/${a}`, x, 140, a, 48, { fill: v("farbe/schwarz") }); text(f, String(a), x, 196, "Label", { fill: v("farbe/grau-2") }); x += a + 40; }
  text(f, "Radien", 48, 250, "Titel 3");
  Object.entries(T.radius).forEach(([n, r], i) => {
    flaeche(f, `radius/${n}`, 48 + i * 150, 290, 120, 64, { fill: v("farbe/grau-6"), stroke: v("farbe/schwarz"), strokeWeight: 1, strokeAlign: "inside", cornerRadius: Math.min(r, 32) });
    text(f, `${n}${r < 999 ? ` · ${r} px` : " · voll rund"}`, 48 + i * 150, 362, "Label", { fill: v("farbe/grau-2") });
  });
  text(f, "Trefferflächen", 48, 420, "Titel 3");
  Object.entries(T.treffer).forEach(([n, d], i) => {
    kreis(f, `treffer/${n}`, 48 + i * 150, 460, d, { fill: v("farbe/schwarz") });
    text(f, `${n} · ${d} px`, 48 + i * 150, 460 + 68, "Label", { fill: v("farbe/grau-2") });
  });
}

// ---- 10 drawing surface: the layout decided on 15.11.2026 (D-115-01 … 06, 41) ----------------------------------------------
seite("10 · Zeichenfläche (Entwurf)");
{
  const W = 1440, H = 900;
  const f = rahmen("Gebäudemodell · 1440 × 900", 0, 0, W, H, { fill: v("farbe/weiss") });
  // app side bar and head (existing shell, only indicated)
  flaeche(f, "Seitenleiste App", 0, 0, 220, H, { fill: v("farbe/grau-6") });
  linie(f, "Linie Seitenleiste", 220, 0, 1, H);
  text(f, "BIT-Atelier", 24, 22, "Titel 3");
  ["Projektübersicht", "Komplex-Designer", "Skizze", "Prüf-Suite", "AVA"].forEach((n, i) => text(f, n, 24, 84 + i * 36, "Tabelle", { fill: v(i === 1 ? "farbe/schwarz" : "farbe/grau-2"), fontStyle: i === 1 ? "Medium" : "Regular" }));
  // head: three zones — Haus · Ansicht · Ausgabe
  const kx = 221, kw = W - 221;
  linie(f, "Linie Kopf", kx, 56, kw, 1);
  const kapsel = (name, x, y, w, aktiv = false, h = 32) => {
    flaeche(f, name, x, y, w, h, { fill: v(aktiv ? "farbe/schwarz" : "farbe/weiss"), stroke: v(aktiv ? "farbe/schwarz" : "farbe/grau-4"), strokeWeight: 1, strokeAlign: "inside", cornerRadius: 999 });
    text(f, name, x + 14, y + (h - 20) / 2, "Tabelle", { fill: v(aktiv ? "farbe/weiss" : "farbe/schwarz"), fontStyle: "Medium" });
  };
  // zone Ansicht (left, the largest choice): view switcher; exactly one view is active
  let x = kx + 16;
  for (const [n, w, a] of [["3D", 52, false], ["Grundriss", 100, true], ["Schnitt", 84, false], ["Skizze", 78, false]]) { kapsel(n, x, 12, w, a); x += w + 6; }
  // zone Haus (middle): one line of text and a button that opens the fold-out
  text(f, "Haus", kx + 380, 12, "Label", { fill: v("farbe/grau-2") });
  text(f, "2 Geschosse · 1 Untergeschoss · Sattel 42°", kx + 380, 28, "Tabelle");
  kapsel("Haus einstellen", kx + 680, 12, 140);
  // zone Ausgabe (right)
  kapsel("Vorschau", W - 330, 12, 96); kapsel("PDF", W - 226, 12, 58); kapsel("DXF", W - 160, 12, 58); kapsel("IFC", W - 94, 12, 54);
  // quick options of the view (second line, fixed height — never wraps, nothing jumps)
  linie(f, "Linie Optionen", kx, 100, kw, 1);
  x = kx + 16;
  for (const [n, w] of [["Ebenen: Eigene", 132], ["1:100", 64], ["Darstellung: Entwurf", 172], ["Brille: Eingabe", 132], ["Planart: Entwurf", 136]]) { kapsel(n, x, 64, w, false, 28); x += w + 8; }
  // model ground
  flaeche(f, "Zeichenfläche (Modellgrund)", kx, 101, kw - 300, H - 101 - 28, { fill: v("farbe/modell") });
  // tool box: four groups, floating over the model (the only shadow in the layout)
  const wk = flaeche(f, "Werkzeugkasten", kx + 16, 117, 60, 636, { fill: v("farbe/weiss"), cornerRadius: 28, effects: [{ type: "dropShadow", color: "#00000026", offset: [0, 4], radius: 16 }] });
  void wk;
  let wy = 129;
  for (const [gruppe, anzahl] of [["Auswahl", 2], ["Planung", 6], ["Sichten", 1], ["Dokumentation", 3]]) {
    for (let i = 0; i < anzahl; i++) { kreis(f, `${gruppe} ${i + 1}`, kx + 24, wy, 44, { fill: v(gruppe === "Auswahl" && i === 0 ? "farbe/schwarz" : "farbe/grau-6") }); wy += 48; }
    wy += 4; linie(f, `Trenner ${gruppe}`, kx + 30, wy - 2, 32, 1); wy += 6;
  }
  // storey strip at the drawing (always visible)
  const gx = W - 300 - 76;
  flaeche(f, "Geschoss-Leiste", gx, 117, 60, 156, { fill: v("farbe/weiss"), cornerRadius: 28, effects: [{ type: "dropShadow", color: "#00000026", offset: [0, 4], radius: 16 }] });
  [["DG", false], ["EG", true], ["KG", false]].forEach(([n, a], i) => {
    kreis(f, `Geschoss ${n}`, gx + 8, 125 + i * 48, 44, { fill: v(a ? "farbe/schwarz" : "farbe/grau-6") });
    text(f, /** @type {string} */ (n), gx + 20, 137 + i * 48, "Tabelle", { fill: v(a ? "farbe/weiss" : "farbe/schwarz"), fontStyle: "Medium" });
  });
  // plan: walls filled, section line with triangles and a free name, grid axis with circle, dimension chain
  const px = kx + 250, py = 250;
  flaeche(f, "Wand außen", px, py, 520, 360, { fill: v("plan/wand-schnitt") });
  flaeche(f, "Raum", px + 24, py + 24, 472, 312, { fill: v("farbe/weiss") });
  flaeche(f, "Wand innen", px + 250, py + 24, 10, 200, { fill: v("plan/wand-schnitt") });
  flaeche(f, "Wand innen quer", px + 24, py + 214, 236, 10, { fill: v("plan/wand-schnitt") });
  text(f, "01", px + 48, py + 52, "Label", { fill: v("farbe/grau-1") }); text(f, "Wohnen", px + 48, py + 68, "Titel 3"); text(f, "N: 32,40 m²", px + 48, py + 94, "Klein", { fill: v("farbe/grau-1") });
  text(f, "02", px + 290, py + 52, "Label", { fill: v("farbe/grau-1") }); text(f, "Kochen / Essen", px + 290, py + 68, "Titel 3"); text(f, "N: 41,85 m²", px + 290, py + 94, "Klein", { fill: v("farbe/grau-1") });
  flaeche(f, "Schnittlinie S-01", px + 160, py - 70, 1, 500, { fill: v("farbe/schwarz") });
  schritte.push({ command: "node.create", key: neu("Pfeil"), parentKey: f, params: { type: "polygon", x: px + 164, y: py - 80, width: 22, height: 22, name: "Blickrichtung S-01 oben", props: { fill: v("farbe/schwarz"), rotation: -90 }, select: false } });
  schritte.push({ command: "node.create", key: neu("Pfeil"), parentKey: f, params: { type: "polygon", x: px + 164, y: py + 406, width: 22, height: 22, name: "Blickrichtung S-01 unten", props: { fill: v("farbe/schwarz"), rotation: -90 }, select: false } });
  text(f, "S-01", px + 112, py - 80, "Titel 3", { fontStyle: "Bold" }); text(f, "S-01", px + 112, py + 406, "Titel 3", { fontStyle: "Bold" });
  linie(f, "Achse A", px + 12, py - 90, 1, 540, { fill: v("farbe/grau-3") });
  kreis(f, "Achskreis A", px - 2, py - 120, 28, { fill: v("farbe/weiss"), stroke: v("farbe/schwarz"), strokeWeight: 1 });
  text(f, "A", px + 7, py - 116, "Tabelle", { fontStyle: "Medium" });
  flaeche(f, "Maßkette", px, py + 392, 520, 1, { fill: v("plan/mass") });
  [0, 260, 520].forEach((dx, i) => flaeche(f, `Maßbegrenzung ${i + 1}`, px + dx, py + 386, 1, 13, { fill: v("plan/mass") }));
  text(f, "5,20", px + 110, py + 372, "Label", { fill: v("plan/mass") }); text(f, "5,20", px + 370, py + 372, "Label", { fill: v("plan/mass") });
  // right: two tabs Info · Ebenen
  const rx = W - 300;
  linie(f, "Linie rechts", rx, 101, 1, H - 101);
  kapsel("Info", rx + 16, 113, 60, true, 28); kapsel("Ebenen", rx + 82, 113, 84, false, 28);
  text(f, "Wand · Außenwand", rx + 16, 160, "Titel 3");
  ["Ebene", "Geometrie", "Geschoss", "Höhen", "Maß", "Struktur", "Darstellung", "Oberfläche", "ID"].forEach((n, i) => {
    const y = 198 + i * 44;
    text(f, n, rx + 16, y, "Klein", { fill: v("farbe/grau-2") });
    text(f, ["Wände", "Referenz außen", "EG", "0,00 bis 2,41", "36,5 cm", "Ziegel + Putz", "nach Maßstab", "Putz weiß", "W-014"][i], rx + 120, y, "Tabelle");
    linie(f, "Zeilenlinie", rx + 16, y + 30, 268, 1, { fill: v("farbe/grau-5") });
  });
  // status line: the single place for what is hidden or unsaved
  linie(f, "Linie Status", kx, H - 28, kw, 1);
  text(f, "Entwurf · 3 ungespeicherte Änderungen", kx + 16, H - 22, "Label", { fill: v("status/ocker") });
  text(f, "2 Ebenen ausgeblendet · alles einblenden", kx + 320, H - 22, "Label", { fill: v("farbe/grau-2") });
  text(f, "Schritt 12 von 99", W - 420, H - 22, "Label", { fill: v("farbe/grau-2") });
}

// ---- run: learn the ids, then run again with the real parents ------------------------------------------------------------------
const tmp = join(tmpdir(), `bit-atelier-figcraft-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const ziel = join(HIER, "bit-atelier-design.figcraft");
/** @type {Map<string, number>} */
let ids = new Map();
function lauf(/** @type {string|null} */ out) {
  const script = schritte.map((s) => ({ command: s.command, params: { ...s.params, ...(s.parentKey ? { parent: ids.get(s.parentKey) ?? 0 } : {}) } }));
  // first pass: parents unknown → create everything on the page (ids only depend on the order of creation)
  for (const s of script) if (s.params.parent === 0) delete s.params.parent;
  const datei = join(tmp, "script.json");
  writeFileSync(datei, JSON.stringify(script), "utf8");
  const aus = execFileSync(CLI, ["run", datei, "--no-system-fonts", ...(out ? ["--out", out] : [])], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  /** @type {Map<string, number>} */
  const neuIds = new Map();
  for (const z of aus.split(/\r?\n/)) {
    if (!z.startsWith("{")) continue;
    const r = JSON.parse(z);
    if (!r.ok) throw new Error(`FigCraft-Schritt ${r.step} (${r.command}) fehlgeschlagen: ${JSON.stringify(r).slice(0, 400)}`);
    const key = schritte[r.step]?.key;
    if (key && typeof r.result?.id === "number") neuIds.set(key, r.result.id);
  }
  return neuIds;
}
ids = lauf(null);
const zweite = lauf(ziel);
for (const [k, id] of zweite) if (ids.get(k) !== id) throw new Error(`Kennung von ${k} hat sich zwischen den Läufen geändert (${ids.get(k)} → ${id}) — die Eltern stimmen dann nicht`);
rmSync(tmp, { recursive: true, force: true });
console.log(`geschrieben: ${ziel} (${schritte.length} Schritte)`);
const vorschau = join(HIER, "vorschau");
mkdirSync(vorschau, { recursive: true });
for (const [name, datei] of [["00 · Übersicht", "00-uebersicht"], ["01 · Farben", "01-farben"], ["02 · Weißmodell", "02-weissmodell"], ["03 · Schrift", "03-schrift"], ["04 · Maße", "04-masse"], ["10 · Zeichenfläche (Entwurf)", "10-zeichenflaeche"]]) {
  execFileSync(CLI, ["export", ziel, "--no-system-fonts", "--page", name, "--format", "png", "-o", join(vorschau, `${datei}.png`)], { encoding: "utf8" });
}
console.log(execFileSync(CLI, ["info", ziel], { encoding: "utf8" }).trim());
