// Counting rules of the colour ratchet (scripts/farb-baseline.mjs): what is a hardcoded
// colour and what is a design token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zaehlen } from "../../scripts/farb-baseline.mjs";

test("counts palette classes with variants and opacity", () => {
  const z = zaehlen(`className="text-slate-500 hover:bg-slate-700/50 dark:border-gray-700 ring-emerald-500"`);
  assert.equal(z.farben, 4);
});

test("counts arbitrary colours, black and white", () => {
  assert.equal(zaehlen(`"bg-[#0f172a] text-white border-black"`).farben, 3);
});

test("counts gradients separately", () => {
  const z = zaehlen(`"bg-gradient-to-r from-emerald-500/20 to-teal-500/20"`);
  assert.equal(z.verlaeufe, 1);
  assert.equal(z.farben, 2);
});

test("does not count design tokens or non-colour utilities", () => {
  const z = zaehlen(`"bg-card text-muted-foreground border-border text-sm bg-primary ring-ring text-2xl to-transparent"`);
  assert.deepEqual(z, { farben: 0, verlaeufe: 0 });
});

test("does not count look-alikes inside other words", () => {
  assert.equal(zaehlen(`const context-slate-500x = "my-text-slate-500"`).farben, 0);
});
