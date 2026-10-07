# KI-Anbindung — BIT-Atelier mit jedem Modell und jedem Agenten

> **English summary.** BIT-Atelier is model-agnostic. There are three ways to bring AI in:
> (a) **AI connections inside the app** — pick a preset (Anthropic, OpenAI, Google Gemini,
> Mistral, OpenRouter, Groq, DeepSeek, Qwen/DashScope, LM Studio, Ollama or any
> OpenAI-compatible endpoint); every AI feature of the modules then uses that model.
> (b) **The AI harness** (`harness/`, Python) — a local working system with tools, project
> memory and skills, usable from the app's *AI tool* page. (c) **The MCP server**
> (`tools/mcp-server.mjs`) — lets Claude Code, Claude Desktop or any MCP client read your
> projects and, only if you allow it, write to them. Everything talks to the **local API on
> 127.0.0.1:3001**, which has **no login** — never expose that port. Details below are in German.

Stand: Plan 83-03 (07.10.2026). Alle Wege brauchen eine **laufende App**:
`start-windows.cmd` / `./start.sh` oder `npm start` (App und API auf `http://localhost:3001`),
für die Entwicklung `npm run dev` (API `:3001`, Oberfläche `:5173`).

---

## a) KI-Verbindungen in der App

**Wo:** Einstellungen → **KI-Verbindungen** (`/Settings?tab=ai`; die KI-Zentrale verlinkt dorthin).

1. **Vorlage** wählen — sie setzt Verbindungstyp und Basis-URL.
2. **Modellname** eintragen (Freitext; das Feld zeigt ein Beispiel, die gültigen Namen
   nennt die Modellliste des Anbieters).
3. **API-Schlüssel** eintragen (lokale Server brauchen keinen), **Verbindung testen**,
   **Speichern**. Die aktive Verbindung bedient alle KI-Funktionen der Module.

Unter der Basis-URL steht „Anfragen gehen an: …“ — genau die Adresse, die der Server aufruft.

| Vorlage | Verbindungstyp | Basis-URL | Endpunkt, den der Server aufruft | Quelle (Anbieter-Doku, geprüft 07.10.2026) |
|---|---|---|---|---|
| Anthropic | Anthropic | `https://api.anthropic.com` | `…/v1/messages` | platform.claude.com/docs/en/api/overview |
| OpenAI | OpenAI-kompatibel | `https://api.openai.com/v1` | `…/v1/chat/completions` | developers.openai.com/api/reference |
| Google Gemini | OpenAI-kompatibel | `https://generativelanguage.googleapis.com/v1beta/openai` | `…/v1beta/openai/chat/completions` | ai.google.dev/gemini-api/docs/openai |
| Mistral | OpenAI-kompatibel | `https://api.mistral.ai/v1` | `…/v1/chat/completions` | docs.mistral.ai/api |
| OpenRouter | OpenAI-kompatibel | `https://openrouter.ai/api/v1` | `…/api/v1/chat/completions` | openrouter.ai/docs/quickstart |
| Groq | OpenAI-kompatibel | `https://api.groq.com/openai/v1` | `…/openai/v1/chat/completions` | console.groq.com/docs/openai |
| DeepSeek | OpenAI-kompatibel | `https://api.deepseek.com` | `…/chat/completions` (ohne `/v1`, so dokumentiert) | api-docs.deepseek.com |
| Qwen (DashScope) | OpenAI-kompatibel | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `…/compatible-mode/v1/chat/completions` | alibabacloud.com/help/en/model-studio/base-url |
| LM Studio (lokal) | OpenAI-kompatibel | `http://127.0.0.1:1234/v1` | `…/v1/chat/completions` | lmstudio.ai/docs/app/api/endpoints/openai |
| Ollama (lokal) | Ollama | `http://127.0.0.1:11434` | `…/api/chat` | docs.ollama.com/api/chat |
| Eigener Endpunkt | Eigener Endpunkt | Ihre URL | Regel unten | — |

**Regel für OpenAI-kompatible Endpunkte** (`packages/nova-core/src/lib/kiVorlagen.js`, eine
Quelle für Server und Formular):

- Basis-URL endet schon auf `/chat/completions` → unverändert.
- Basis-URL enthält ein Versionssegment (`/v1`, `/v1beta`, `/api/v1`, `/compatible-mode/v1` …),
  endet auf `/openai` oder ist `api.deepseek.com` → es wird nur `/chat/completions` angehängt.
- Sonst → `/v1/chat/completions` (so wie vor 83-03 — gespeicherte Verbindungen wie
  `https://api.openai.com` funktionieren weiter).

**Lokal ohne Cloud:** LM Studio (Server starten, Modell laden) oder Ollama (`ollama serve`,
`ollama pull <modell>`). Die Vorlagen nutzen `127.0.0.1` statt `localhost`, weil Node
`localhost` zuerst als IPv6 (`::1`) auflösen kann, die lokalen Server aber auf IPv4 lauschen.

**Ohne Verbindung** gilt diese Reihenfolge (`packages/nova-core/server/llm.js`):

1. aktive KI-Verbindung aus den Einstellungen
2. `ANTHROPIC_API_KEY` — Modell aus `ANTHROPIC_MODEL`, Vorgabe `claude-sonnet-5-5`
3. `OPENAI_API_KEY` — Modell aus `OPENAI_MODEL`, Vorgabe `gpt-4o-mini`
4. sonst deutlich markierte Platzhalter-Antworten („Offline-Modus“), damit nichts bricht

`LLM_MODEL` gilt weiter als gemeinsamer Rückfall für beide Schlüssel. Die Variablen stehen in
einer Datei `.env` im App-Ordner (wird von `npm start` und den Startskripten gelesen):

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5-5
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o-mini
```

**Schlüssel:** bleiben in der lokalen Datenbank (`daten/db.json` bzw. `server/db.json`) und
gehen nur an die Basis-URL, für die sie gespeichert wurden; die Oberfläche zeigt sie maskiert.
Wer Anbieter oder Basis-URL ändert, muss den Schlüssel neu eingeben.

**Andere Fassungen:** Die serverlose Fassung (`npm run build:lokal`) hat keine KI-Aufrufe.
Die gehostete Cloud-Fassung nutzt dieselbe URL-Regel in `supabase/functions/llm/index.ts`
(Spiegel — erst nach erneutem Deploy der Edge Function wirksam).

---

## b) Der Harness (Python, optional)

Ein lokaler Dienst mit Werkzeugen (Dateien, IFC, Shell mit Freigabe), Projektgedächtnis und
Skills; in der App unter **Labor → KI Tool** (`/KiTool`). Voraussetzung: Python ≥ 3.11.

```powershell
cd harness
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -e ".[ifc]"
.venv\Scripts\python -m harness serve        # http://127.0.0.1:8765
```

macOS/Linux: `python3.11 -m venv .venv && .venv/bin/python -m pip install -e ".[ifc]" && .venv/bin/python -m harness serve`.

- **Profile** (`harness/providers.example.yaml`, eigene Kopie `providers.yaml`): anthropic,
  openai, gemini, mistral, openrouter, deepseek, groq, alibaba-token-plan,
  alibaba-coding-plan, lmstudio, ollama, mock. Schlüssel nur in `harness/.env`
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`,
  `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `DASHSCOPE_API_KEY` …).
  Neuer Anbieter = ein YAML-Block.
- **Wechseln:** `--provider <profil> --model <name>` beim Start oder `/model` im Chat.
- **Verbindung zur App:** Der Dienst erlaubt die Origins `:5173`, `:3001` und `:4173`
  (`localhost` und `127.0.0.1`). Läuft die App anders (z. B. `API_PORT=3002`), in
  `harness/.env` ergänzen: `HARNESS_ALLOWED_ORIGINS=http://localhost:3002` (kommagetrennt,
  ergänzt die Vorgaben).
- **Prüfen:** `.venv\Scripts\python -m harness doctor` — Schlüssel gesetzt? Endpunkt erreichbar?
  Welche Modelle meldet er?

Mehr: [harness/README.md](../harness/README.md).

---

## c) MCP-Server — andere KIs arbeiten mit Ihren Projekten

`tools/mcp-server.mjs` spricht das **Model Context Protocol** über stdio (JSON-RPC 2.0, eine
Nachricht pro Zeile; Protokollversionen 2025-06-18, 2025-03-26, 2024-11-05). Er hat keine
eigenen Daten, sondern ruft die lokale API der **laufenden** App auf. Läuft sie nicht, meldet
jedes Werkzeug: „BIT-Atelier läuft nicht — starten Sie die App (start-windows.cmd / npm start)“.

**Werkzeuge**

| Werkzeug | Zweck | Recht |
|---|---|---|
| `bit_status` | App erreichbar? Version, Modus, Schreibrecht des MCP-Servers | lesen |
| `list_entity_types` | Datensatz-Arten mit Anzahl (z. B. `Project`, `ChangeOrder`, Kataloge) | lesen |
| `list_projects` | Projekte in Kurzform (id, Name, Bauherr, Status, Ort), neueste zuerst | lesen |
| `get_project` | ein Projekt vollständig (`id`) | lesen |
| `list_records` | Datensätze einer Entität (`entity`, optional `filter` als exakter Feldvergleich, `sort` wie `-updated_date`, `limit` ≤ 200, Vorgabe 50) | lesen |
| `get_record` | ein Datensatz (`entity`, `id`) | lesen |
| `create_record` | Datensatz anlegen (`entity`, `data`) | **nur mit `--schreiben`** |
| `update_record` | Felder ändern, andere bleiben (`entity`, `id`, `data`) | **nur mit `--schreiben`** |

Ohne `--schreiben` (Alias `--write`) erscheinen die beiden Schreibwerkzeuge nicht in der
Werkzeugliste, und ein Aufruf wird abgelehnt. Gelöscht wird über MCP nie. Antworten über
50.000 Zeichen werden gekürzt (bei Listen: weniger Datensätze, mit Hinweis). API-Schlüssel
(`LlmConnection`) und Personaldaten sind über diesen Weg gesperrt.

**Claude Code** (im App-Ordner ausführen; ein absoluter Pfad ist robuster):

```bash
claude mcp add bit-atelier -- node tools/mcp-server.mjs
# mit Schreibrecht:
claude mcp add bit-atelier -- node tools/mcp-server.mjs --schreiben
# App auf anderem Port:
claude mcp add bit-atelier -e BIT_API_URL=http://127.0.0.1:3002/api -- node tools/mcp-server.mjs
```

**Claude Desktop** — `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\`, macOS:
`~/Library/Application Support/Claude/`), Pfad anpassen, unter Windows Backslashes doppeln:

```json
{
  "mcpServers": {
    "bit-atelier": {
      "command": "node",
      "args": ["C:\\Pfad\\zu\\BIT-Atelier\\tools\\mcp-server.mjs"]
    }
  }
}
```

Schreibrecht: `"args": ["…\\tools\\mcp-server.mjs", "--schreiben"]`; anderer Port:
`"env": { "BIT_API_URL": "http://127.0.0.1:3002/api" }`.

**Andere MCP-Clients:** Server-Typ *stdio*, Befehl `node`, Argumente
`<App-Ordner>/tools/mcp-server.mjs [--schreiben]`, optional Umgebungsvariable `BIT_API_URL`
(Vorgabe `http://127.0.0.1:3001/api`). Voraussetzung Node.js ≥ 22. Protokollmeldungen gehen nur
auf stdout, Protokolle des Servers auf stderr.

**Kurzprobe ohne Client:**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}' | node tools/mcp-server.mjs
```

---

## d) Die lokale REST-API

Basis `http://127.0.0.1:3001/api`, JSON, **ohne Anmeldung**. Quelle: `server/index.js`,
`packages/nova-core/server/routes.js`, `personalRouter.js`, `typesafe.js`,
`packages/nova-ausschreibung/server/routes.js`, `packages/nova-designer/server/routes.js`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/status` | Name, Version, Modus (`app`/`api`), Node-Version |
| GET | `/auth/me` | lokaler Nutzer (fest, keine Anmeldung) |
| GET | `/entities` | Übersicht der Entitäten mit Anzahl (ohne gesperrte) |
| GET | `/entities/:entity?sort=-feld&feld=wert` | Liste, optional sortiert und exakt gefiltert |
| GET | `/entities/:entity/:id` | ein Datensatz (404, wenn nicht vorhanden) |
| POST | `/entities/:entity` | anlegen; `id`, `created_date`, `updated_date` vergibt der Server |
| PUT | `/entities/:entity/:id` | Felder ändern (Zusammenführen, nicht Ersetzen) |
| DELETE | `/entities/:entity/:id` | löschen |
| POST / PUT | `/entities/:entity/bulk` | viele anlegen / per Schlüssel aktualisieren-oder-anlegen (`{ records, key? }`) |
| GET | `/catalogs` | alle Bürokataloge in einer Antwort |
| GET, PUT, DELETE | `/blobs`, `/blobs/:id` | große abgeleitete Nutzlasten (Bauteillisten) neben der DB |
| POST | `/integrations/invoke-llm` | KI-Aufruf `{ prompt, response_json_schema? }` über die aktive Verbindung |
| GET, POST, PUT, DELETE | `/llm/connections`, `/llm/connections/:id` | KI-Verbindungen (Schlüssel nur maskiert) |
| POST | `/llm/test` | Verbindungstest (15 s, antwortet immer 200 mit `ok`) |
| GET | `/llm/defaults` | Standard-Basis-URLs je Verbindungstyp |
| POST | `/integrations/typesafe` | TypeSafe-Urteil |
| GET, POST, PUT, DELETE | `/personal/…`, `/personal-dateien/…` | Personaldaten — eigene Datei; bei Bindung außerhalb von Loopback 403 (außer `PERSONAL_LAN=1`) |
| POST | `/prices/ted-search` | TED-Preisrecherche (Proxy, offline-tolerant) |
| GET | `/weather`, `/elevation`, `/climate`, `/osm-buildings`, `/osm-environment` | Standortdaten für den Entwurf (freie Dienste) |
| GET | `/archicad/status` | Erreichbarkeit der Archicad-Schnittstelle (Tapir) |
| GET | `/telemetry/config` | Quelle der Baustellen-Telemetrie |
| GET | `/ifc-files`, `/ifc-test-file`, `/bauteilfilter` | Entwicklungswege (nur mit `IFC_DIR` / `IFC_TEST_FILE` / `BAUTEILFILTER_DIR`) |

`LlmConnection` und die Personal-Entitäten sind über `/entities` gesperrt (403). Unbekannte
`/api`-Pfade antworten im App-Modus mit JSON-404.

---

## e) Sicherheit

- **Alles läuft nur auf diesem Rechner.** Die API bindet `127.0.0.1` und hat **keine
  Authentifizierung** — wer den Port erreicht, kann alle Projektdaten lesen und ändern.
  **Port 3001 nie freigeben**, nicht per Router weiterleiten, nicht per Tunnel veröffentlichen.
  `API_HOST` (Bindung an eine andere Adresse) ist nur für bewusste Ausnahmen da; der Server
  warnt dann beim Start.
- **Browser-Schutz:** Die API erlaubt Cross-Origin-Anfragen nur von den eigenen Adressen
  (`:5173`, `:4173`, `:3001`; weitere über `API_ORIGINS`). Der Harness prüft dasselbe für HTTP
  und WebSocket (`HARNESS_ALLOWED_ORIGINS`).
- **MCP:** Standard ist lesend. Schreibrecht (`--schreiben`) nur für Agenten, denen Sie die
  Änderung Ihrer Projektdaten zutrauen; vorher sichern (Einstellungen → Daten & Sicherung oder
  den Ordner `daten/` kopieren).
- **KI-Anbieter:** Was Sie an ein Cloud-Modell schicken, verlässt den Rechner. Für
  vertrauliche Projekte ein lokales Modell (LM Studio, Ollama) wählen.
- **Daten:** `daten/` (Startskripte) bzw. `BIT_DATA_DIR`; ohne Variable `server/`. Den Ordner
  sichern wie jeden Projektordner.
