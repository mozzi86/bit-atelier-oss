// B-81-09: since 81-06 `useProject().projects` hides archived projects. The
// accounting hook must read `alleProjekte`, otherwise invoices, expenses and
// trips of an archived project lose their project name (and an edit form its
// selected project). Source guard — the hook needs React and the context.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DATEI = fileURLToPath(new URL("../../src/components/accounting/useBuchhaltung.js", import.meta.url));

test("useBuchhaltung liest alle Projekte einschließlich archivierter (B-81-09)", () => {
  const quelle = fs.readFileSync(DATEI, "utf8");
  assert.match(quelle, /alleProjekte\s*\?\?/, "the hook falls back to `projects` only without `alleProjekte`");
  assert.doesNotMatch(quelle, /const \{ projects, projectId/, "the filtered list must not be the accounting list");
});
