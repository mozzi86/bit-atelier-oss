// 92-07: Settings › "KI-Verbindungen" › "Mit einem KI-Assistenten verbinden" (local express build only).
// BIT-Atelier is an MCP server (tools/mcp-server.mjs, docs/KI-ANBINDUNG.md c); this card shows the ready
// entry for Claude Code (command line) and Claude Desktop (claude_desktop_config.json) with the REAL paths of
// this installation — the Node binary that runs the app and the absolute script path, both from
// GET /api/system/ki-anbindung — plus copy buttons. "Schreibrecht erlauben" adds --schreiben (create/change
// records; MCP never deletes).
//
// In:  nothing. Out: the card or null (other builds, or the server does not offer the route); data-testids
//      ki-mcp, ki-mcp-schreiben, ki-mcp-code, ki-mcp-code-kopieren, ki-mcp-desktop, ki-mcp-desktop-kopieren,
//      ki-mcp-status, ki-mcp-fehler.
import React from "react";
import { Bot, Copy } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { claudeCodeBefehl, claudeDesktopJson } from "@/lib/kiAnbindung";

/**
 * Copy text; when the clipboard API is refused (http origin, permissions), select the shown block instead so
 * Ctrl+C works.
 * @param {string} text
 * @param {HTMLElement|null} block the <pre> showing the text
 * @returns {Promise<boolean>} true when copied
 */
async function kopieren(text, block) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (block) {
      const bereich = document.createRange();
      bereich.selectNodeContents(block);
      const auswahl = window.getSelection();
      auswahl?.removeAllRanges();
      auswahl?.addRange(bereich);
    }
    return false;
  }
}

/**
 * @returns {React.ReactElement|null}
 */
export default function KiAssistentVerbinden() {
  const { t } = useI18n();
  const [info, setInfo] = React.useState(/** @type {any} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [schreiben, setSchreiben] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const codeRef = React.useRef(/** @type {HTMLPreElement|null} */ (null));
  const desktopRef = React.useRef(/** @type {HTMLPreElement|null} */ (null));

  React.useEffect(() => {
    if (DATENQUELLE !== "express") return undefined;
    let aktiv = true;
    fetch("/api/system/ki-anbindung", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (aktiv) setInfo(j);
      })
      .catch((e) => { if (aktiv) setFehler(e instanceof Error ? e.message : String(e)); });
    return () => { aktiv = false; };
  }, []);

  if (DATENQUELLE !== "express") return null;
  const befehl = info ? claudeCodeBefehl(info, schreiben) : "";
  const json = info ? claudeDesktopJson(info, schreiben) : "";
  const knopf = "inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";
  const pre = "mt-1 overflow-x-auto whitespace-pre rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100";

  const kopiere = async (text, block) => {
    setStatus((await kopieren(text, block)) ? t("Kopiert.") : t("Kopieren nicht möglich – der Text ist markiert, mit Strg+C kopieren."));
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900" data-testid="ki-mcp" aria-labelledby="ki-mcp-titel">
      <h3 id="ki-mcp-titel" className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Bot className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Mit einem KI-Assistenten verbinden")}
      </h3>
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {t("BIT-Atelier ist ein MCP-Server: Claude Code, Claude Desktop und andere MCP-Clients können Ihre Projekte lesen – mit Schreibrecht auch Einträge anlegen und ändern, nie löschen. Die App muss dafür laufen.")}
      </p>
      {fehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300" data-testid="ki-mcp-fehler">{t("Pfade nicht abrufbar:")} {fehler}</p>}
      {info && (
        <>
          {!info.vorhanden && <p className="text-xs text-amber-800 dark:text-amber-200">{t("tools/mcp-server.mjs fehlt in diesem App-Ordner.")}</p>}
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={schreiben} onChange={(e) => setSchreiben(e.target.checked)} data-testid="ki-mcp-schreiben" />
            {t("Schreibrecht erlauben (--schreiben)")}
          </label>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("Claude Code – in einem Terminal ausführen:")}</span>
              <button type="button" className={knopf} onClick={() => kopiere(befehl, codeRef.current)} data-testid="ki-mcp-code-kopieren">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t("Kopieren")}
              </button>
            </div>
            <pre ref={codeRef} className={pre} data-testid="ki-mcp-code">{befehl}</pre>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("Claude Desktop – in claude_desktop_config.json eintragen:")}</span>
              <button type="button" className={knopf} onClick={() => kopiere(json, desktopRef.current)} data-testid="ki-mcp-desktop-kopieren">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t("Kopieren")}
              </button>
            </div>
            <pre ref={desktopRef} className={pre} data-testid="ki-mcp-desktop">{json}</pre>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {t("Speicherort der Datei:")} Windows <code>%APPDATA%\Claude\claude_desktop_config.json</code>, macOS{" "}
              <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>.{" "}
              {t("Gibt es dort schon andere Server, nur den Block „bit-atelier“ in „mcpServers“ ergänzen; danach Claude Desktop neu starten.")}
            </p>
          </div>
        </>
      )}
      <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="ki-mcp-status">{status}</p>
    </section>
  );
}
