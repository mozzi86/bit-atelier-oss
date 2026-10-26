# KI-Anbindung — BIT-Atelier mit jedem Modell und jedem Agenten

> **English summary.** BIT-Atelier is model-agnostic. There are three ways to bring AI in:
> (a) **AI connections inside the app** — pick a preset (Anthropic, OpenAI, Google Gemini,
> Mistral, OpenRouter, Groq, DeepSeek, Qwen/DashScope, LM Studio, Ollama or any
> OpenAI-compatible endpoint); every AI feature of the modules then uses that model.
> (b) **The AI harness** (`harness/`, Python) — a local working system with tools, project
> memory and skills, usable from the app's *AI tool* page. (c) **The MCP server**
> (`tools/mcp-server.mjs`) — lets Claude Code, Claude Desktop or any MCP client read your
> projects and, only if you allow it, write to them. Since plan 106-04 it also gives a model the
> tools of the open viewer (selection, property, move, split, check, view image) — changes are only
> *proposals* that a person confirms in the app (the Massing studio has no proposals: its drawing commands run at once).
> `ansicht_bild` hands an image to the client's model (treated as a cloud model) only for a project without the NDA marker, after the
> person's one-time consent for that project, and not while "local AI only" is on (plan 106-06).
> Everything talks to the **local API on
> 127.0.0.1:3001**, which has **no login** — never expose that port. Details below are in German.

Stand: Plan 106-04 (25.10.2026). Alle Wege brauchen eine **laufende App**:
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

### Sprache am Modell (Plan 106-05)

Im IFC-Viewer und im BIM-Studio steht unten rechts das **Sprechfeld**: Knopf halten (oder
Leertaste + V) und sprechen, loslassen — oder denselben Satz tippen. Was gehört wurde, steht
zuerst als Text da; erst dann läuft der Satz:

1. **Grammatik ohne Sprachmodell** — „Setze Brandschutz auf F90", „Verschiebe dieses
   50 Zentimeter nach links" (Richtung wie im Bild), „Teile in der Mitte", „Ja", „Nein",
   „Mach das rückgängig" (fragt erst zurück). Die vollständige Liste zeigt das **?** im Feld.
   „dieses/diese/dort/hier" = die aktuelle Auswahl; ohne Auswahl wird abgelehnt, nicht geraten.
2. **Nur ein unbekannter Satz** geht an den Harness-Agenten (Profil `sprechen`). Er bekommt
   den Satz und die Auswahl als Text mit GUIDs — ein Bild nur, wenn „mit Bild“ an ist (unten) —
   und nur die Vorschlags-Werkzeuge des MCP-Servers der App. Sein Ergebnis ist immer ein **Vorschlag**.
3. **Übernommen wird nur durch die Person:** gesprochenes oder getipptes „ja", Alt+J,
   Strg+Enter oder der Knopf Übernehmen. Ein Agent kann nicht bestätigen (Entscheidung D-IM-04).

Voraussetzungen und Regeln:

- Spracherkennung: Harness mit `.[voice]` (faster-whisper, lokal). Ohne Harness sagt der
  Knopf „Spracheingabe braucht den KI-Harness (Einstellungen › KI)".
- Freie Sätze: Node.js ≥ 22 für den MCP-Server der App, den der Harness selbst startet
  (`config.yaml` › `mcp`).
- **„Nur lokale KI"** an: freie Sätze gehen nur an ein lokales Profil des Harness, sonst wird
  nichts gesendet. Aus, aber Profil außerhalb dieses Rechners: das Feld fragt je Satz
  („Trotzdem senden" / „Nicht senden").
- Getestet im Browser mit Attrappen für Mikrofon, Erkennung und Agent; **nicht am Gerät
  abgenommen** (echtes Mikrofon, echtes Sprachmodell).

### Bild als Kontext (Plan 106-06)

Der Knopf **„mit Bild“** im Sprechfeld schickt bei einem freien Satz **ein Bild der aktuellen Ansicht**
(gewähltes Bauteil hervorgehoben, höchstens 1280 px Kante) mit — für räumliche Bezüge wie „links davon“.
Die Zeile darunter sagt, wohin das Bild geht (Profil und Ziel-Host, „verlässt diesen Rechner“ mit ↗).
Regeln (Entscheidung D-IM-02), geprüft in der App, im Harness und im MCP-Server, jeweils vor dem Senden:

- **NDA-Merker am Projekt** (Projektformular, „Vertraulich (NDA)“): **nie ein Bild**, an kein Modell,
  auch nicht an ein lokales — nur Text und Bauteil-Kennungen. Der Knopf zeigt „Bild: nie (NDA)“.
- **Bild verlässt den Rechner:** vor dem ersten Bild eines Projekts fragt das Feld **einmal je Projekt**
  („Für dieses Projekt zustimmen und senden“). Danach folgt wie bei jedem Satz an ein Modell außerhalb
  dieses Rechners die Rückfrage aus 106-05, die alles nennt, was hinausgeht (Satz, Auswahl, Bild; das Modell
  kann offene Vorschläge, frühere Sätze und Prüfergebnisse als Text lesen). Die Zustimmung steht am Projekt
  (`bild_freigabe`) und lässt sich im Feld zurücknehmen. Sie kommt nur von der Seite der App selbst
  (`Sec-Fetch-Site: same-origin`, im Büro über HTTP: `Origin` = eigene Adresse, dazu das Sitzungs-Token):
  ein MCP-Werkzeug, eine fremde Webseite oder ein Programm mit einem gewöhnlichen HTTP-Client (z. B.
  `update_record`) kann weder zustimmen noch den NDA-Merker löschen (verworfene Felder nennt die Antwort
  im Kopf `X-Bit-Feld-Geschuetzt`). **Grenze:** ein Programm auf diesem Rechner mit Shell-Zugriff kann
  die Browser-Köpfe nachbauen und das Sitzungs-Token holen — oder gleich `db.json` ändern. Davor schützt
  keine Regel in BIT-Atelier; wer Agenten mit Shell-Zugriff laufen lässt, vertraut ihnen insoweit.
- **„Nur lokale KI“** an: ein Bild geht nur an ein Modell auf diesem Rechner. Büroweit lassen sich Bilder an
  KI außerhalb dieses Rechners unter Einstellungen › KI ausschalten (Standard: an).
- **Nur an Modelle, die Bilder verstehen** (Katalog der lokalen Modelle, sonst eine Liste bekannter
  Modellkennungen; unbekannt = nein). Sonst kommt ein Satz, das Bild wird nie still weggelassen.
- Das Bild ist **nur Kontext**: welches Bauteil sich ändert, bestimmt die GUID der Auswahl; jede Änderung
  bleibt ein Vorschlag, den die Person übernimmt (D-IM-04).

Ein Bild, das über den lokalen Steuerkanal (`/api/steuerung`, Befehl `ansicht-bild`) zu einem Agenten
geht, prüft der Server selbst noch einmal (Agent = Ziel außerhalb dieses Rechners), gleich welcher Weg es
verlangt hat; über `zeichenflaeche_ausfuehren` gibt es das Bild gar nicht, nur über `ansicht_bild`.

Derselbe Bild-Eingang steht in der App-API zur Verfügung (`POST /api/integrations/invoke-llm` mit
`bilder: [{png_base64}]` und `bild_projekt_id`); die Freigabe liest `GET /api/llm/bild-freigabe`.

Mehr: [harness/README.md](../harness/README.md).

---

## c) MCP-Server — andere KIs arbeiten mit Ihren Projekten

`tools/mcp-server.mjs` spricht das **Model Context Protocol** über stdio (JSON-RPC 2.0, eine
Nachricht pro Zeile; Protokollversionen 2025-06-18, 2025-03-26, 2024-11-05). Er hat keine
eigenen Daten, sondern ruft die lokale API der **laufenden** App auf. Läuft sie nicht, meldet
jedes Werkzeug: „BIT-Atelier läuft nicht — starten Sie die App (start-windows.cmd / npm start)“.

**Werkzeuge**

Zwei Stufen: ohne Flag nur **lesen**, mit `--schreiben` zusätzlich Datensätze und **Vorschläge** für das
Modell. **Bestätigen kann ein Agent nie** — es gibt kein Werkzeug dafür (Entscheidung D-IM-04); die Person
übernimmt den Vorschlag in der App. Die Spalte „Recht“ ist maßgeblich; ein Test
(`tests/unit/mcp-server-10604.test.js`) liest diese Tabelle und vergleicht sie mit der echten Werkzeugliste je Flag.

| Werkzeug | Zweck | Recht |
|---|---|---|
| `bit_status` | App erreichbar? Version, Modus, Schreibrecht des MCP-Servers | lesen |
| `list_entity_types` | Datensatz-Arten mit Anzahl (z. B. `Project`, `ChangeOrder`, Kataloge) | lesen |
| `list_projects` | Projekte in Kurzform (id, Name, Bauherr, Status, Ort), neueste zuerst | lesen |
| `get_project` | ein Projekt vollständig (`id`) | lesen |
| `list_records` | Datensätze einer Entität (`entity`, optional `filter` als exakter Feldvergleich, `sort` wie `-updated_date`, `limit` ≤ 200, Vorgabe 50) | lesen |
| `get_record` | ein Datensatz (`entity`, `id`) | lesen |
| `zeichenflaeche_befehle` | Befehle der geöffneten Fläche (Massing-Studio, IFC-Viewer oder BIM-Studio) mit Kürzel und „gerade möglich“ | lesen |
| `zeichenflaeche_ausfuehren` | beliebigen Befehl dieser Fläche ausführen (`befehl`, `params`). Im IFC-Viewer und BIM-Studio liefern Änderungsbefehle nur Vorschläge; das **Massing-Studio führt Zeichen- und Bearbeitungsbefehle sofort aus** (Linie, Wand, `loeschen`, `rueckgaengig` …), ohne Vorschlag und ohne Bestätigung | **nur mit `--schreiben`** |
| `auswahl_abfragen` | was die Person gerade ausgewählt hat: GUID, Klasse, Name, Geschoss, Steckbrief — das ist „dieses Bauteil“ (Suchwort in der Beschreibung: `get_selection`) | lesen |
| `bauteil_waehlen` | Bauteil per `guid` auswählen, wie ein Klick (Suchwort `select_element_by_guid`); ändert nur die Auswahl in der Oberfläche, nichts wird gespeichert, **überschreibt aber die Auswahl der Person** („dieses Bauteil“ meint danach das gewählte) | lesen |
| `modell_bauteile` | Übersicht des Modells: Zahl je Klasse, Geschosse, bis 200 Bauteile mit GUID; optional `klasse` (z. B. `IfcWall`) | lesen |
| `vorschlaege_lesen` | offene Vorschläge und Verlauf der übernommenen Schritte mit Herkunft | lesen |
| `pruefen` | offene Vorschläge gegen den aktuellen Stand prüfen (optional `guid` oder `id`); ändert nichts am Modell, erneuert aber die gespeicherte Prüfung der Vorschläge; ohne offenen Vorschlag Klartext-Fehler, keine Bauteil- oder Bereichsprüfung | lesen |
| `ansicht_bild` | aktuelle 3D-Ansicht als PNG-Bild (`breite` 64 bis 1600, Vorgabe 800; Suchwort `render_view`); **geht an das Modell des Clients und gilt als Bild an ein Cloud-Modell**: nur ohne NDA-Merker, nach der einmaligen Zustimmung je Projekt, nicht bei „Nur lokale KI“ (106-06) | lesen |
| `eigenschaft_setzen` | **Vorschlag**: Eigenschaft setzen (`name`, `wert`, optional `guid`, `pset`; Suchwörter `modify_ifc_property`, `set_property`) | **nur mit `--schreiben`** |
| `transformieren` | **Vorschlag**: verschieben (`verschiebung_m`), drehen (`drehung_grad`), skalieren (`faktor`) (Suchwörter `transform_geometry`, `move_element`) | **nur mit `--schreiben`** |
| `teilen` | **Vorschlag**: Bauteil teilen (`punkt`, `anteil` oder `linie`; Suchwort `split_element`) | **nur mit `--schreiben`** |
| `vorschlag_verwerfen` | eigenen offenen Vorschlag zurücknehmen (`id`); ändert nichts am Modell | **nur mit `--schreiben`** |
| `create_record` | Datensatz anlegen (`entity`, `data`) | **nur mit `--schreiben`** |
| `update_record` | Felder ändern, andere bleiben (`entity`, `id`, `data`) | **nur mit `--schreiben`** |

Ohne `--schreiben` (Alias `--write`) erscheinen die Schreibwerkzeuge nicht in der Werkzeugliste, und ein
Aufruf wird abgelehnt. Das frühere Flag `--bestaetigen-erlaubt` gibt es nicht mehr (wird ignoriert, mit
Hinweis im Protokoll); auch der Umweg über `zeichenflaeche_ausfuehren` mit dem Befehl `bestaetigen` wird
abgelehnt, und die App verweigert die Bestätigung über den Agentenkanal zusätzlich selbst. Datensätze löscht
der MCP-Server nie; im Massing-Studio kann `zeichenflaeche_ausfuehren` aber Zeichenelemente sofort löschen
(`loeschen`) und zurücknehmen (siehe Grenzen). Antworten über 50.000 Zeichen werden gekürzt (bei Listen:
weniger Einträge, mit Hinweis; Antworten des Viewers sind kompaktes JSON, die längste Liste verliert Einträge
vom Ende); das Bild von `ansicht_bild` ist davon ausgenommen. API-Schlüssel (`LlmConnection`) und
Personaldaten sind über diesen Weg gesperrt.

**Wie ein Agent das Modell anfasst (Zeigen und Sprechen)**

Die Werkzeuge zum Modell (`auswahl_abfragen` bis `vorschlag_verwerfen`) sprechen mit dem **geöffneten Viewer**, nicht mit der Datenbank: dem
IFC-Viewer oder dem BIM-Studio, in dem die Person zuletzt gearbeitet hat (das Massing-Studio hat sie nicht, dort
gibt es nur `zeichenflaeche_*`) (Token aus
`steuerung.token` im Datenordner, nur auf diesem Rechner). Ist kein Viewer offen, antwortet die App nach
etwa 10 Sekunden `"status": "not-run"` — das darf wiederholt werden. Die Regeln dahinter:

1. **Erst in Worten, dann nach Bestätigung.** `eigenschaft_setzen`, `transformieren` und `teilen`
   ändern nichts. Sie liefern einen Vorschlag mit `id`, einem Satz in Worten, der Prüfung (Brandschutz,
   Tragwerk, Öffnungen, „veraltet“) und der Herkunft `agent`. Die Person sieht die Vorschau im Modell und
   übernimmt oder verwirft in der App. Das gilt immer, auch für einfache Attribute.
2. **Herkunft und Einzelrückweg.** Jeder übernommene Schritt trägt seine Herkunft (hand, text, sprache,
   agent, bild) und lässt sich einzeln zurücknehmen; über den Agentenkanal ist die Herkunft immer
   `agent`, egal was der Aufruf behauptet. Seit D-IM-07 (25.10.2026) trägt ein Vorschlag, den der Agent
   aus einem **gesprochenen** Satz macht, beide Herkünfte („Spracheingabe + Agent“, Feld `herkunft_quellen`;
   mit Bild der Ansicht zusätzlich „Bildkontext“) — erkannt an der `satz_marke`, die nur die Sprachsteuerung
   der App ausgibt und der KI-Harness einsetzt; eine fremde Marke ändert nichts, bestätigen kann der Agent so nie.
3. **Die GUID ist die Wahrheit, nie ein Bild.** Ohne `guid` gilt das ausgewählte Bauteil; gibt es keins,
   antwortet die App „Keine Auswahl …“ und es läuft nichts. Es wird nichts geraten. `ansicht_bild` zeigt
   dem Modell, was die Person sieht; gewählt und geändert wird trotzdem nur über die GUID.
4. **Ein Bild geht an das Modell des Clients.** Ein MCP-Client reicht `ansicht_bild` an sein Modell weiter,
   meist ein **Cloud-Modell**; BIT-Atelier behandelt den Client deshalb immer als Ziel außerhalb dieses Rechners.
   Seit 106-06 kommt ein Bild nur, wenn das im Viewer geöffnete Projekt **keinen NDA-Merker** trägt, die Person
   für dieses Projekt **einmal zugestimmt** hat (Knopf „mit Bild“ im Viewer) und weder „Nur lokale KI“ noch die
   Büro-Einstellung es verbieten; sonst antwortet das Werkzeug mit dem Grund im Klartext.

Bekannte Grenzen: In IFC-Dateien lässt sich nur `eigenschaft_setzen` vorschlagen (als Eintrag im
Änderungsjournal, die Datei bleibt unverändert); Verschieben und Teilen gehen nur bei gezeichneten
Bauteilen des BIM-Studios. Mehrere Bauteile auf einmal wählt kein Werkzeug. Fenster und Türen lassen sich
im BIM-Studio nicht anklicken, aber per `guid` wählen. `ansicht_bild` gibt es nur in der 3D-Ansicht. Der Harness
(`harness/`) hat noch keinen MCP-Client und damit diese Werkzeuge nicht. Die Prüfung `pruefen` kennt keinen
Bereich und kein einzelnes Bauteil, nur offene Vorschläge. Bestätigen und Zurücknehmen
kann ein Agent nie: die App verweigert beides über den Agentenkanal („Ein Agent kann nicht bestätigen …“), der
MCP-Server bietet kein Werkzeug dafür an. Die Bildbreite wird in der App auf 64 bis
1600 px gesetzt (kleinere Werte werden angehoben).

**Beispielaufrufe** (Name und Argumente als JSON; die GUID ist ein Platzhalter)

```text
bit_status {}
list_entity_types {}
list_projects {"limit": 10}
get_project {"id": "p1"}
list_records {"entity": "ChangeOrder", "filter": {"status": "approved"}, "sort": "-updated_date", "limit": 20}
get_record {"entity": "Project", "id": "p1"}
zeichenflaeche_befehle {}
zeichenflaeche_ausfuehren {"befehl": "eingabe", "params": {"text": "@8;0"}}
auswahl_abfragen {}
bauteil_waehlen {"guid": "0xS3rfBXz1EwBvL5K3Hn2a"}
modell_bauteile {"klasse": "IfcWall"}
vorschlaege_lesen {}
pruefen {"guid": "0xS3rfBXz1EwBvL5K3Hn2a"}
ansicht_bild {"breite": 800}
eigenschaft_setzen {"name": "Feuerwiderstand", "wert": "F90"}
transformieren {"guid": "0xS3rfBXz1EwBvL5K3Hn2a", "verschiebung_m": [0.5, 0]}
teilen {"guid": "0xS3rfBXz1EwBvL5K3Hn2a", "anteil": 0.5}
vorschlag_verwerfen {"id": "a3f9c10b"}
create_record {"entity": "Notiz", "data": {"text": "Besprechung verschoben"}}
update_record {"entity": "Notiz", "id": "n1", "data": {"text": "Besprechung entfällt"}}
```

**Beispiel-Dialog: zeigen, ändern, bestätigen**

Die Person hat im BIM-Studio eine Wand angeklickt und sagt zum Agenten: „Diese Wand soll F90 sein.“

1. Der Agent liest, was „diese“ ist: `auswahl_abfragen {}` — Antwort: eine Wand mit GUID, Klasse
   `IfcWall`, Steckbrief mit Feuerwiderstand „offen“. Hätte die Person nichts gewählt, wäre `anzahl` 0
   gewesen; der Agent fragt dann nach, statt ein Bauteil zu raten.
2. Er schlägt die Änderung vor: `eigenschaft_setzen {"name": "Feuerwiderstand", "wert": "F90"}` — Antwort:
   ein Vorschlag mit `id` `a3f9c10b`, dem Satz „Wand EG-01: Feuerwiderstand offen → F90“, der Prüfung
   (Stufe `ok`, keine Auffälligkeit) und `bestaetigung: "erforderlich"`. Im Modell erscheint die Vorschau
   (gestrichelter Umriss), im Modell selbst ist noch nichts geändert.
3. Er kontrolliert, wenn er will, mit `pruefen {}` und zeigt der Person das Ergebnis:
   `ansicht_bild {}` liefert das Bild der Ansicht samt Vorschau.
4. Die Person liest den Satz und drückt in der App **Übernehmen** (oder verwirft). Erst jetzt
   wird die Wand geändert; im Verlauf steht „agent“ als Urheber, und der Schritt lässt sich
   einzeln zurücknehmen.
5. Der Agent sieht das Ergebnis mit `vorschlaege_lesen {}` (Verlauf) oder `auswahl_abfragen {}`
   (Feuerwiderstand jetzt „F90“). Wollte die Person es sich anders überlegen, nimmt der Agent den
   offenen Vorschlag mit `vorschlag_verwerfen {"id": "a3f9c10b"}` zurück.

**Am einfachsten aus der App (seit 92-07):** Einstellungen → **KI-Verbindungen** → „Mit einem
KI-Assistenten verbinden“ zeigt beide Einträge unten fertig ausgefüllt — mit dem echten Pfad dieser
Installation und dem Node.js, mit dem die App läuft — samt Kopierknopf und Schalter für das Schreibrecht.

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
  warnt dann beim Start. Andere Geräte brauchen seit 93-03 trotzdem den Büro-Modus und eine
  Kopplung (siehe `SECURITY.md`); der MCP-Server auf diesem Rechner (Loopback) ist davon nicht
  betroffen.
- **Browser-Schutz:** Die API erlaubt Cross-Origin-Anfragen nur von den eigenen Adressen
  (`:5173`, `:4173`, `:3001`; weitere über `API_ORIGINS`). Der Harness prüft dasselbe für HTTP
  und WebSocket (`HARNESS_ALLOWED_ORIGINS`).
- **MCP:** Standard ist lesend. Schreibrecht (`--schreiben`) nur für Agenten, denen Sie die
  Änderung Ihrer Projektdaten zutrauen; vorher sichern (Einstellungen → Daten & Sicherung oder
  den Ordner `daten/` kopieren). Änderungen am Modell sind im IFC-Viewer und BIM-Studio auch mit Schreibrecht nur Vorschläge, die
  Sie in der App übernehmen; ein Agent bestätigt nie selbst. Das Massing-Studio
  kennt keine Vorschläge: `zeichenflaeche_ausfuehren` zeichnet und löscht dort mit Schreibrecht sofort.
- **Bild an die Cloud:** `ansicht_bild` braucht kein Schreibrecht. Der Client gibt das Bild an sein Modell weiter,
  meist ein Cloud-Modell; es kommt nur ohne NDA-Merker, nach der Zustimmung je Projekt und nicht bei „Nur lokale KI“.
- **KI-Anbieter:** Was Sie an ein Cloud-Modell schicken, verlässt den Rechner. Für
  vertrauliche Projekte ein lokales Modell (LM Studio, Ollama) wählen.
- **Daten:** `daten/` (Startskripte) bzw. `BIT_DATA_DIR`; ohne Variable `server/`. Den Ordner
  sichern wie jeden Projektordner.
