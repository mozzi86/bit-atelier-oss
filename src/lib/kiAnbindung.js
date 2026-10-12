// kiAnbindung.js — ready-to-paste MCP entries for Claude Code and Claude Desktop (plan 92-07), built from the
// facts the local server reports (GET /api/system/ki-anbindung): the absolute path of THIS Node binary and of
// tools/mcp-server.mjs. Replaces the placeholder "C:\\Pfad\\zu\\BIT-Atelier\\…" of docs/KI-ANBINDUNG.md, which
// users had to fill in by hand with a hidden %LOCALAPPDATA% path and doubled backslashes.
//
// Shapes follow docs/KI-ANBINDUNG.md section c): Claude Code `claude mcp add bit-atelier [-e BIT_API_URL=…] --
// <node> <script> [--schreiben]`; Claude Desktop `claude_desktop_config.json` with mcpServers.bit-atelier
// {command, args, env?}. BIT_API_URL is only added when the app does not run on the default port 3001.
//
// In:  {node, mcpServer, apiUrl, standardPort} from the server + the write switch. Out: strings.

/**
 * @typedef {object} KiAnbindung
 * @property {string} node absolute path of the Node binary that runs the app (process.execPath)
 * @property {string} mcpServer absolute path of tools/mcp-server.mjs
 * @property {string} apiUrl base URL of the local API, e.g. "http://127.0.0.1:3001/api"
 * @property {boolean} standardPort true when the app runs on port 3001 (then no BIT_API_URL is needed)
 */

/** MCP server name used in both clients. */
export const MCP_NAME = "bit-atelier";

/**
 * Quote one shell argument with double quotes when it contains blanks or quotes (cmd, PowerShell, sh and
 * zsh all accept a double-quoted path; a path has no `$` or backtick worth expanding).
 * @param {string} s
 * @returns {string}
 */
function arg(s) {
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/**
 * Command line for Claude Code.
 * @param {KiAnbindung} a
 * @param {boolean} [schreiben] allow creating/changing records (--schreiben)
 * @returns {string}
 */
export function claudeCodeBefehl(a, schreiben = false) {
  const teile = ["claude", "mcp", "add", MCP_NAME];
  if (!a.standardPort) teile.push("-e", `BIT_API_URL=${a.apiUrl}`);
  teile.push("--", arg(a.node), arg(a.mcpServer));
  if (schreiben) teile.push("--schreiben");
  return teile.join(" ");
}

/**
 * claude_desktop_config.json content (the whole file for a first entry; with existing servers the
 * "bit-atelier" block goes into the existing "mcpServers" object).
 * @param {KiAnbindung} a
 * @param {boolean} [schreiben] allow creating/changing records (--schreiben)
 * @returns {string} pretty-printed JSON (backslashes of Windows paths escaped by JSON itself)
 */
export function claudeDesktopJson(a, schreiben = false) {
  /** @type {{command: string, args: string[], env?: Record<string, string>}} */
  const eintrag = { command: a.node, args: [a.mcpServer, ...(schreiben ? ["--schreiben"] : [])] };
  if (!a.standardPort) eintrag.env = { BIT_API_URL: a.apiUrl };
  return JSON.stringify({ mcpServers: { [MCP_NAME]: eintrag } }, null, 2);
}
