// 78-12 caller list: every module that calls InvokeLLM is classified here, and the test fails for a new caller
// that is not. Three classes:
//   daten  — pastes text that may come from outside the office (tender texts, mails, IFC properties, web
//            content) → must send it as `daten: [{ quelle, text }]` (llmSchutz.js wraps it as data blocks);
//   server — needs project records → sends `projekt_id` + `kontext` and the server builds the context from
//            exactly that project (llmKontext.js recipes);
//   nutzer — sends only what the user typed on that screen (own instruction) or values computed on the page
//            that are not stored records; nothing external, nothing to fetch.
// The prompt builder llmAuftrag (kgVerdichtung.js, class daten) is covered by kgVerdichtung.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KONTEXT_REZEPTE } from "../../packages/nova-core/server/llmKontext.js";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

/** @type {Record<string, { art: "daten"|"server"|"nutzer", kontext?: string, grund: string }>} */
const AUFRUFER = {
  "packages/nova-ausschreibung/src/components/LVPositionForm.jsx": {
    art: "daten", grund: "Positions-/Kurztext und Gewerk können aus einer fremden GAEB-Datei stammen",
  },
  "src/components/ai/ProjectAudit.jsx": {
    art: "server", kontext: "projektAudit", grund: "Projekt, LV, Tickets, Termine, Energie-Screening eines Projekts",
  },
  "packages/nova-designer/src/components/GenerativeLayout.jsx": {
    art: "server", kontext: "projektStamm", grund: "Projektstamm; die Varianten rechnet die Seite (keine Datensätze)",
  },
  "src/components/ai/AgentChat.jsx": { art: "nutzer", grund: "nur die eigene Frage im Chat, keine Dateien" },
  "src/components/ai/WorkflowBuilder.jsx": { art: "nutzer", grund: "Workflow-Name und feste Agentenliste" },
  "src/components/ai/DataAnalysis.jsx": { art: "nutzer", grund: "eigener Freitext; Komponente ist nirgends eingebunden" },
  "src/components/feasibility/AIAssistant.jsx": {
    art: "nutzer", grund: "eigene Frage + ungespeicherte Machbarkeitswerte der Seite (Formularstand, kein Datensatz)",
  },
};

/** All js/jsx files under src/ and packages/<pkg>/src/ that call InvokeLLM( (the definition excluded). */
function aufruferImCode() {
  const wurzeln = [path.join(WURZEL, "src")];
  for (const paket of fs.readdirSync(path.join(WURZEL, "packages"))) {
    const src = path.join(WURZEL, "packages", paket, "src");
    if (fs.existsSync(src)) wurzeln.push(src);
  }
  const treffer = [];
  const laufe = (ordner) => {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const voll = path.join(ordner, e.name);
      if (e.isDirectory()) laufe(voll);
      else if (/\.(jsx?|mjs)$/.test(e.name)) {
        const text = fs.readFileSync(voll, "utf8");
        if (/\bInvokeLLM\(/.test(text.replace(/export async function InvokeLLM\(/g, ""))) treffer.push(voll);
      }
    }
  };
  wurzeln.forEach(laufe);
  return treffer.map((d) => path.relative(WURZEL, d).replace(/\\/g, "/")).sort();
}

/** The argument object of every InvokeLLM({ … }) call in a file (balanced braces). */
function aufrufArgumente(text) {
  const args = [];
  let i = text.indexOf("InvokeLLM({");
  while (i >= 0) {
    let tiefe = 0;
    let j = i + "InvokeLLM(".length;
    for (; j < text.length; j++) {
      if (text[j] === "{") tiefe++;
      else if (text[j] === "}" && --tiefe === 0) break;
    }
    args.push(text.slice(i, j + 1));
    i = text.indexOf("InvokeLLM({", j);
  }
  return args;
}

test("78-12: every InvokeLLM caller is classified (new callers must be added here)", () => {
  assert.deepEqual(aufruferImCode(), Object.keys(AUFRUFER).sort());
  for (const [datei, eintrag] of Object.entries(AUFRUFER)) assert.ok(eintrag.grund.length > 10, `${datei}: reason missing`);
});

test("78-12: callers with external text send it as daten", () => {
  for (const [datei, e] of Object.entries(AUFRUFER).filter(([, x]) => x.art === "daten")) {
    const args = aufrufArgumente(fs.readFileSync(path.join(WURZEL, datei), "utf8"));
    assert.ok(args.length > 0, `${datei}: no InvokeLLM({ … }) call found`);
    for (const a of args) assert.match(a, /\bdaten\b/, `${datei}: InvokeLLM without daten (${e.grund})`);
  }
});

test("78-12: callers with project records ask the server for the context of exactly one project", () => {
  for (const [datei, e] of Object.entries(AUFRUFER).filter(([, x]) => x.art === "server")) {
    assert.ok(Object.prototype.hasOwnProperty.call(KONTEXT_REZEPTE, e.kontext), `${datei}: unknown recipe ${e.kontext}`);
    const args = aufrufArgumente(fs.readFileSync(path.join(WURZEL, datei), "utf8"));
    assert.ok(args.length > 0, `${datei}: no InvokeLLM({ … }) call found`);
    for (const a of args) {
      assert.match(a, /projekt_id:\s*projectId/, `${datei}: projekt_id missing`);
      assert.match(a, new RegExp(`kontext:\\s*"${e.kontext}"`), `${datei}: kontext "${e.kontext}" missing`);
    }
  }
  // The former client-side context of the audit is gone from the prompt.
  const audit = fs.readFileSync(path.join(WURZEL, "src/components/ai/ProjectAudit.jsx"), "utf8");
  assert.doesNotMatch(audit, /Projektdaten:\\n\$\{JSON\.stringify/);
});
