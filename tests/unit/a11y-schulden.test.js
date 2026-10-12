// Guard test for the accessibility debts of the UI (Plan 72-03).
//
// Same construction as the registry guard of 72-02 (designer-navigation.test.js): the
// test reads the source as TEXT (through scripts/a11y-schulden.mjs) and holds a reached
// level instead of maintaining a list. Four kinds of debt are counted:
//   select — <SelectTrigger> without aria-label / aria-labelledby / id
//   icon   — icon-only buttons without a name (title is no substitute)
//   label  — a label that visually names a field but is not linked to it
//   fokus  — outline-none without a visible focus replacement
//
// THE CEILINGS MAY ONLY FALL, NEVER RISE. Goal: 0 for every kind. A new field without a
// name fails here; lower the ceiling in the same commit that removes debt.
//
// In:  every .jsx under src/ and packages/*/src/. Out: assertions, no side effects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { alleSchulden, nurIcon, schuldenInQuelle, zaehlen } from "../../scripts/a11y-schulden.mjs";

/**
 * Ceilings per debt kind. Start (12.10.2026, measured fresh after phase 82 / 88):
 * select 126 · icon 41 · label 69 · fokus 9.
 * After the codemod (task 2): select 25 · label 6; after the hand rests: select 0 · label 0.
 * After naming the icon buttons (task 3): icon 0.
 * After task 4 (visible focus, ring on the command palette container): fokus 0. Goal reached.
 * @type {Record<"select"|"icon"|"label"|"fokus", number>}
 */
const OBERGRENZE = { select: 0, icon: 0, label: 0, fokus: 0 };

test("a11y-Schulden steigen nicht über die Obergrenzen (Ziel 0)", () => {
  const liste = alleSchulden();
  const ist = zaehlen(liste);
  for (const art of /** @type {const} */ (["select", "icon", "label", "fokus"])) {
    const neu = liste.filter((s) => s.art === art).map((s) => `${s.datei}:${s.zeile}`);
    assert.ok(
      ist[art] <= OBERGRENZE[art],
      `${art}: ${ist[art]} > Obergrenze ${OBERGRENZE[art]} — neue Stelle ohne Namen/Fokus? Liste:\n${neu.join("\n")}`
    );
  }
});

test("Zähler erkennt Auswahlfelder mit und ohne Namen", () => {
  const q = [
    '<label className="x">Bauweise</label>',
    "<Select value={a}><SelectTrigger><SelectValue /></SelectTrigger></Select>",
    '<Select><SelectTrigger aria-label={t("Art")}><SelectValue /></SelectTrigger></Select>',
    '<Select><SelectTrigger id="art"><SelectValue /></SelectTrigger></Select>',
  ].join("\n");
  assert.deepEqual(zaehlen(schuldenInQuelle(q, "probe.jsx")), { select: 1, icon: 0, label: 0, fokus: 0 });
});

test("Zähler erkennt Icon-Knöpfe — title zählt nicht als Name", () => {
  const q = [
    '<Button size="icon" title="Löschen"><Trash2 className="h-4 w-4" /></Button>',
    '<Button variant="ghost" onClick={x}><X className="h-4 w-4" /></Button>',
    '<Button size="icon" aria-label={t("Position löschen")}><Trash2 /></Button>',
    "<Button><Plus /> Neu</Button>",
    '<button onClick={x}>{busy ? <Loader2 /> : <Send />}</button>',
    "<button>{label}</button>",
  ].join("\n");
  assert.equal(zaehlen(schuldenInQuelle(q, "probe.jsx")).icon, 3);
  assert.equal(nurIcon(' {t("Senden")} <Send /> '), false);
});

test("Zähler erkennt unverknüpfte Labels, aber keine umschließenden", () => {
  const q = [
    "<div><Label>Menge</Label>",
    "<Input value={m} /></div>",
    '<div><Label>Faktor</Label><Input aria-label={t("Faktor")} /></div>',
    '<div><Label htmlFor="b">Beleg</Label><Input id="b" /></div>',
    "<Label><Checkbox checked={a} /> Aktiv</Label>",
    "<div><Label>Abschnitt</Label></div><div><Input /></div>",
  ].join("\n");
  assert.equal(zaehlen(schuldenInQuelle(q, "probe.jsx")).label, 1);
});

test("Zähler erkennt outline-none ohne Ersatz, nicht bei Ring oder programmatischem Fokus", () => {
  const q = [
    '<div tabIndex={0} className="outline-none" />',
    '<div tabIndex={0} className="outline-none focus-visible:ring-2" />',
    '<main tabIndex={-1} className="focus:outline-none" />',
    '<DialogPrimitive.Content className="outline-none" />',
    '<div className="px-3 focus-within:ring-2"><Search /><input className="flex-1 outline-none" /></div>',
    '<div className="px-3"><input className="flex-1 outline-none" /></div>',
  ].join("\n");
  assert.equal(zaehlen(schuldenInQuelle(q, "probe.jsx")).fokus, 2);
});
