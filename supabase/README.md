# Supabase — Schema, Projekte, Betrieb (Phase 57)

Dieser Ordner enthält das versionierte Datenbankschema der BIT-Atelier-Cloud
(`app.bit-atelier.de`) und die Werkzeuge, es auf die Cloud-Projekte zu spielen
und zu prüfen. UI und Anleitungen auf Deutsch; SQL-Kommentare auf Englisch
(wie der übrige Code).

## Zweck

Die App läuft in drei Datenwegen (Weiche `DATENQUELLE` in
`packages/nova-core/src/lib/umgebung.js`, Phase 57-02):

| Weg | Daten | Wann |
|---|---|---|
| `express` | `server/db.json` + `server/blobs/` | lokale Entwicklung (heutiger Stand) |
| `serverlos` | IndexedDB im Browser | Demo und `lokal`-Build — **nie** Supabase |
| `supabase` | Postgres + Storage in der Cloud | `app.bit-atelier.de` (Stufe 1: eigenes Büro) |

## Die zwei Projekte (D-P57-08)

| Projekt | Plan | Region | Zweck |
|---|---|---|---|
| `bit-atelier-dev` | Free | `eu-central-1` (Frankfurt) | Entwicklung, RLS-Check, Import-Dry-Run |
| `bit-atelier-prod` | Pro (Spend Cap **an**) | `eu-central-1` (Frankfurt) | Echtbetrieb des eigenen Büros |

Kein lokales Supabase: Docker/WSL fehlen auf dem Rechner. Migrationen werden
als SQL-Dateien hier versioniert und per CLI gegen die Cloud gespielt.

## Migrationen einspielen

Voraussetzung: Supabase CLI (`scoop install supabase` oder `npx supabase`) und
ein Access-Token (`supabase login`). Project-Refs stehen im Dashboard
(Settings → General). **Refs und Keys gehören nur in `.env`, nie ins Repo.**

```bash
# Entwicklung
supabase link --project-ref <REF_DEV> --password <DB-PASSWORT>
supabase db push            # spielt supabase/migrations/*.sql

# Produktion
supabase link --project-ref <REF_PROD> --password <DB-PASSWORT>
supabase db push

# Stand prüfen
supabase migration list     # muss 0001–0004 auf beiden Projekten zeigen
```

Inhalt der Migrationen:

| Datei | Inhalt |
|---|---|
| `0001_orgs_records.sql` | `orgs`, `org_members`, `records` (generische jsonb-Tabelle, D-P57-03), Indizes, `updated_date`-Trigger |
| `0002_rls.sql` | `ist_mitglied()`, RLS auf allen Tabellen, Policies über Mitgliedschaft; insert erzwingt `created_by = auth.uid()` |
| `0003_storage_blobs.sql` | privater Bucket `blobs`, Pfad `<org_id>/<id>.json`, dieselbe Mitgliedschaftsregel + dieselbe ID-Whitelist wie `blobs.js` |
| `0004_llm_connections.sql` | LLM-Schlüssel **außerhalb** von `records`: RLS an, keine Policies, Grants entzogen — Zugriff nur per Service-Role aus der Edge Function (57-04) |

## RLS-Check (Beweis der Mandantentrennung)

`scripts/supabase-rls-check.mjs` legt gegen **dev** zwei Orgs und zwei Nutzer
an, meldet sich als Nutzer a an und prüft sechs Fälle (eigen lesen/schreiben
ok · fremd lesen 0 Zeilen · fremd schreiben Fehler · Blob eigen ok · Blob
fremd Fehler), räumt vollständig auf und beendet sich bei Verstoß mit Exit 1.
Das Skript verweigert den Lauf, wenn die dev-URL wie prod aussieht.

```bash
node --env-file=.env scripts/supabase-rls-check.mjs
# Erwartung: 6/6, EXIT 0
```

## Import der Bestandsdaten (57-03)

`scripts/supabase-import.mjs` überführt `server/db.json` + `server/blobs/` in
eine Org. Der Lauf gegen **prod** wird ausschließlich vom Nutzer ausgelöst.

```bash
# Zählen und messen, ohne zu schreiben (Verbindungstest + größter Blob):
node --env-file=.env scripts/supabase-import.mjs --ziel dev --org <UUID> --dry-run

# Echter Lauf:
node --env-file=.env scripts/supabase-import.mjs --ziel dev --org <UUID>
node --env-file=.env scripts/supabase-import.mjs --ziel prod --org <UUID> --ja-prod
```

### Org und Mitgliedschaft anlegen (Nutzer, SQL-Editor im Dashboard)

Der Import braucht eine Ziel-Org und (für die App) die Mitgliedschaft des
eigenen Nutzers. Vorlage für den Supabase-SQL-Editor:

```sql
-- 1. Org anlegen und UUID notieren:
insert into orgs (name) values ('Büro A') returning id;

-- 2. Sich selbst als Admin eintragen (eigene User-UUID aus
--    Authentication → Users kopieren):
insert into org_members (user_id, org_id, role)
values ('<EIGENE-USER-UUID>', '<ORG-UUID>', 'admin');
```

## Wo Schlüssel liegen — und was NIE ins Repo darf

- `.env` (git-ignoriert): `SUPABASE_URL_DEV/_PROD`, `SUPABASE_ANON_DEV/_PROD`,
  `SUPABASE_SERVICE_DEV/_PROD`, für den Client-Build `VITE_SUPABASE_URL` und
  `VITE_SUPABASE_ANON_KEY`. Nur **Variablennamen** stehen in `.env.example`.
- Der **anon key** ist per Design öffentlich (RLS schützt die Daten).
- Der **service_role key** umgeht RLS vollständig: nur in `.env`, nur von
  Skripten und Edge Functions benutzt. Er darf in keiner Client-Datei, keinem
  Commit, keinem Chat und keinem Build-Output auftauchen.
- LLM-API-Schlüssel (Anthropic/OpenAI) liegen in der Tabelle
  `llm_connections` und in Edge-Function-Secrets (57-04) — nie im Repo.

## Edge Functions (57-04)

Drei Funktionen ersetzen die Server-only-Routen des Express-Wegs (D-P57-07);
danach braucht die Cloud-App keinen eigenen Server mehr:

| Function | Ersetzt | Aufruf |
|---|---|---|
| `llm` | `routes.js` llmRouter + `llm.js` | POST, Body `{ aktion: 'invoke' \| 'connections.list' \| 'connections.create' \| 'connections.update' \| 'connections.delete' \| 'test' \| 'defaults', … }` |
| `geo` | `nova-designer/server/routes.js` (ohne archicad) | GET `?dienst=weather\|elevation\|climate\|osm-buildings\|osm-environment&lat=&lng=&radius=` |
| `preise` | `nova-ausschreibung/server/routes.js` | POST, Body `{ aktion: 'ted-search', … }` |

Alle drei: `_shared/auth.ts` verlangt ein gültiges Nutzer-JWT **und**
Org-Mitgliedschaft (anonym → 401); `_shared/cors.ts` trägt dieselbe
Origin-Whitelist-Idee wie `server/index.js`. `archicad/status` bleibt
ausdrücklich lokal (spricht 127.0.0.1 des Nutzers an) — die Cloud-UI zeigt
dafür „Nur lokal verfügbar".

Client-Verdrahtung: `funktionAusPfad` in
`packages/nova-core/src/api/supabaseDb.js` ist die EINE Pfad→Function-Tabelle;
`bitApi.apiFetch` nutzt sie (unbekannter Pfad → Klartext-Fehler).

### Deploy (Nutzer-Checkpoint, braucht Login + Projekt)

```
supabase functions deploy llm    --project-ref <dev-ref>
supabase functions deploy geo    --project-ref <dev-ref>
supabase functions deploy preise --project-ref <dev-ref>
```

### Secrets (Nutzer tippt die Werte — Namen nur hier)

```
supabase secrets set ANTHROPIC_API_KEY=… --project-ref <dev-ref>   # optional (Fallback)
supabase secrets set OPENAI_API_KEY=…      --project-ref <dev-ref>  # optional (Fallback)
supabase secrets set LLM_MODEL=…           --project-ref <dev-ref>  # optional
supabase secrets set EXTRA_ORIGINS=…       --project-ref <dev-ref>  # optional (CORS)
```

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` injiziert die Edge-Runtime
automatisch — nicht selbst setzen. Ohne LLM-Schlüssel/Verbindung antwortet
`llm` mit demselben Offline-Mock wie `server/llm.js` (1:1 portiert).

### Lokales Gate ohne Docker: `deno check`

`supabase functions serve` braucht Docker (D-P57-08: kein Docker/WSL hier) —
deshalb ist das lokale Gate der Typ-Check (Deno per Scoop: `scoop install deno`):

```
deno check supabase/functions/**/index.ts    # Erwartung: EXIT 0
```

`deno.json` (Repo-Wurzel) setzt `nodeModulesDir: manual` — der
`npm:@supabase/supabase-js`-Import wird aus dem vorhandenen `node_modules`
aufgelöst, der Check läuft ohne Registry/Zugriff. Deploy-Verifikation
(401 ohne JWT, Maskierung, Mock-Parität) steht in der 57-04-SUMMARY als
Nutzer-/Review-Checkpoint.
