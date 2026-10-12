// updateRouter.js — HTTP side of the self-update (plan 92-01), mounted under /api by server/index.js.
//
//   GET  /api/update                → { aktuell, neueste, verfuegbar, installierbar, sperre, notizen, aenderungen,
//                                        seite, datum, groesse, festgehalten, letztePruefung, einstellungen,
//                                        deaktiviert, letztesUpdate } (latest release cached 1 h; ?frisch=1 asks
//                                        GitHub again; letztesUpdate = daten/update-ergebnis.json of the apply
//                                        script, 92-05: { ergebnis: ok|zurueckgenommen|fehlgeschlagen, von, nach,
//                                        zeit, grund })
//   POST /api/update/installieren   → 202; downloads, verifies (SHA-256) and unpacks in the background
//   GET  /api/update/fortschritt    → { phase, geladen, gesamt, fehler, version }
//   GET  /api/update/einstellungen  → { automatisch, festhaltenBis, deaktiviert }            (92-04)
//   PUT  /api/update/einstellungen  → same; body { automatisch?, festhaltenBis? } (Origin check)
//
// 92-04 switches: BIT_KEIN_UPDATECHECK=1 (option `deaktiviert`) turns the check off for the whole
// installation — /api/update answers { deaktiviert: true } and never contacts GitHub. The settings file
// <app>/daten/update-einstellungen.json holds the office's choice: `automatisch: false` = no check unless
// the user presses "Jetzt prüfen" (?frisch=1); `festhaltenBis: "YYYY-MM-DD"` = keep this version up to
// and including that day (no banner, install refused), e.g. until a tender's submission date.
// [ASSUMED] The file lives in <app>/daten (next to update.log, kept by every update and by the
// installer), not in .env: the app writes it from the UI, and .env stays the user's own file.
//
// When the new files are ready the server copies tools/update-anwenden.mjs into .update/, starts it detached
// and exits; the apply script swaps the files and restarts the app. The browser polls /api/status until the
// version changes and reloads — the user never gets a download link.
//
// Security: the server binds to 127.0.0.1 only; POST additionally demands an Origin of this very server
// (a foreign web page in the same browser must not be able to trigger an install), the download host is
// allow-listed and the zip is only unpacked after its SHA-256 matched the release's .sha256 file.
//
// In:  { root, port, appModus, version, fetchFn?, beenden? } (beenden = process exit, injectable for tests).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express, { Router } from 'express';
import {
  neuesteVersion, versionVergleich, updateSperre, laden, sha256Hex, shaAusDatei, entpacken,
  aenderungenAusNotiz, einstellungenLesen, einstellungenSchreiben, einstellungenPruefen, istFestgehalten, heuteLokal,
} from './selbstUpdate.js';

const CACHE_MS = 60 * 60 * 1000;

/**
 * Express router of the self-update.
 * @param {{root: string, port: number|string, appModus: boolean, version: string, fetchFn?: typeof fetch,
 *   beenden?: () => void, starteAnwenden?: boolean, deaktiviert?: boolean, einstellungenDatei?: string,
 *   jetzt?: () => Date}} o root = app folder (absolute); port = this server's port (Origin check);
 *   deaktiviert = BIT_KEIN_UPDATECHECK; einstellungenDatei default <root>/daten/update-einstellungen.json;
 *   jetzt = clock (tests)
 * @returns {import('express').Router}
 */
export function updateRouter({
  root, port, appModus, version, fetchFn = fetch, beenden = () => process.exit(0), starteAnwenden = true,
  deaktiviert = false, einstellungenDatei = path.join(root, 'daten', 'update-einstellungen.json'), jetzt = () => new Date(),
}) {
  const r = Router();
  let cache = /** @type {null | {zeit: number, daten: Awaited<ReturnType<typeof neuesteVersion>>}} */ (null);
  /** @type {{phase: string, geladen: number, gesamt: number, fehler: string|null, version: string|null}} */
  let stand = { phase: 'bereit', geladen: 0, gesamt: 0, fehler: null, version: null };
  const erlaubteOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

  const neueste = async (frisch) => {
    if (!frisch && cache && Date.now() - cache.zeit < CACHE_MS) return cache.daten;
    const daten = await neuesteVersion({ fetchFn });
    cache = { zeit: Date.now(), daten };
    return daten;
  };

  const letztesUpdate = () => {
    try { return JSON.parse(fs.readFileSync(path.join(root, 'daten', 'update-ergebnis.json'), 'utf8')); } catch { return null; }
  };
  const festgehaltenText = (bis) => `Fassung festgehalten bis ${bis.split('-').reverse().join('.')} (Einstellungen › System & Info).`;

  r.get('/update', async (req, res) => {
    const sperre = updateSperre({ root, appModus });
    const einstellungen = einstellungenLesen(einstellungenDatei);
    const basis = { aktuell: version, einstellungen, deaktiviert, letztesUpdate: letztesUpdate() };
    if (deaktiviert) {
      return res.json({ ...basis, neueste: null, verfuegbar: false, installierbar: false, sperre: 'Update-Prüfung abgeschaltet (BIT_KEIN_UPDATECHECK).', letztePruefung: null });
    }
    const frisch = req.query.frisch === '1';
    // Automatic check off: never contact GitHub on our own; an earlier manual result may still be shown.
    if (!einstellungen.automatisch && !frisch && !cache) {
      return res.json({ ...basis, neueste: null, verfuegbar: false, installierbar: false, sperre, automatischAus: true, letztePruefung: null });
    }
    try {
      const n = (!einstellungen.automatisch && !frisch && cache) ? cache.daten : await neueste(frisch);
      const verfuegbar = versionVergleich(n.version, version) > 0;
      const ohnePruefsumme = verfuegbar && (!n.zip || !n.sha);
      const festgehalten = istFestgehalten(einstellungen, heuteLokal(jetzt()));
      res.json({
        ...basis, neueste: n.version, verfuegbar, datum: n.datum, notizen: n.notizen, aenderungen: aenderungenAusNotiz(n.notizen),
        seite: n.seite || null, groesse: n.zip?.groesse || 0, festgehalten,
        letztePruefung: cache ? new Date(cache.zeit).toISOString() : null,
        installierbar: verfuegbar && !sperre && !ohnePruefsumme && !festgehalten,
        sperre: sperre || (ohnePruefsumme ? 'Das neue Release hat keine Prüfsumme – automatische Installation nicht möglich.' : null)
          || (festgehalten ? festgehaltenText(/** @type {string} */ (einstellungen.festhaltenBis)) : null),
      });
    } catch (e) {
      res.json({ ...basis, neueste: null, verfuegbar: false, installierbar: false, sperre, letztePruefung: null, fehler: `Keine Verbindung zum Update-Server (${/** @type {any} */ (e).message}).` });
    }
  });

  r.get('/update/einstellungen', (_req, res) => res.json({ ...einstellungenLesen(einstellungenDatei), deaktiviert }));

  r.put('/update/einstellungen', express.json({ limit: '4kb' }), (req, res) => {
    if (!erlaubteOrigins.has(String(req.headers.origin || ''))) return res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' });
    const p = einstellungenPruefen(req.body);
    if (!p.ok) return res.status(400).json({ error: p.fehler });
    try {
      res.json({ ...einstellungenSchreiben(einstellungenDatei, p.werte), deaktiviert });
    } catch (e) {
      res.status(500).json({ error: `Einstellungen nicht gespeichert: ${/** @type {any} */ (e).message}` });
    }
  });

  r.get('/update/fortschritt', (_req, res) => res.json(stand));

  r.post('/update/installieren', async (req, res) => {
    if (!erlaubteOrigins.has(String(req.headers.origin || ''))) return res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' });
    if (deaktiviert) return res.status(409).json({ error: 'Update-Prüfung abgeschaltet (BIT_KEIN_UPDATECHECK).' });
    const sperre = updateSperre({ root, appModus });
    if (sperre) return res.status(409).json({ error: sperre });
    const einstellungen = einstellungenLesen(einstellungenDatei);
    if (istFestgehalten(einstellungen, heuteLokal(jetzt()))) return res.status(409).json({ error: festgehaltenText(/** @type {string} */ (einstellungen.festhaltenBis)) });
    if (!['bereit', 'fehler'].includes(stand.phase)) return res.status(409).json({ error: 'Update läuft bereits.' });
    let n;
    try { n = await neueste(true); } catch (e) { return res.status(502).json({ error: `Update-Server nicht erreichbar: ${/** @type {any} */ (e).message}` }); }
    if (versionVergleich(n.version, version) <= 0) return res.status(409).json({ error: 'Kein neueres Update vorhanden.' });
    if (!n.zip || !n.sha) return res.status(409).json({ error: 'Das Release hat keine Prüfsumme – automatische Installation nicht möglich.' });
    stand = { phase: 'laedt', geladen: 0, gesamt: n.zip.groesse, fehler: null, version: n.version };
    res.status(202).json(stand);

    try {
      const erwartet = shaAusDatei(new TextDecoder().decode(await laden(n.sha.url, { fetchFn, max: 4096 })));
      if (!erwartet) throw new Error('Prüfsummendatei unlesbar.');
      const zip = await laden(n.zip.url, { fetchFn, fortschritt: (g, t) => { stand = { ...stand, geladen: g, gesamt: t || stand.gesamt }; } });
      stand = { ...stand, phase: 'prueft' };
      const ist = sha256Hex(zip);
      if (ist !== erwartet) throw new Error(`Prüfsumme stimmt nicht (erwartet ${erwartet.slice(0, 12)}…, erhalten ${ist.slice(0, 12)}…) – Update verworfen.`);
      stand = { ...stand, phase: 'entpackt' };
      entpacken(zip, path.join(root, '.update', 'neu'));
      fs.copyFileSync(path.join(root, 'tools', 'update-anwenden.mjs'), path.join(root, '.update', 'update-anwenden.mjs'));
      stand = { ...stand, phase: 'neustart' };
      if (starteAnwenden) {
        fs.mkdirSync(path.join(root, 'daten'), { recursive: true });
        const out = fs.openSync(path.join(root, 'daten', 'update.log'), 'a');
        // --port: the apply script checks http://127.0.0.1:<port>/api/status after the restart (92-05).
        spawn(process.execPath, [path.join(root, '.update', 'update-anwenden.mjs'), '--root', root, '--pid', String(process.pid), '--port', String(port)],
          { cwd: root, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
      }
      // Give the browser one more poll of "neustart", then hand over to the apply script.
      setTimeout(beenden, 1500);
    } catch (e) {
      stand = { ...stand, phase: 'fehler', fehler: /** @type {any} */ (e).message };
      fs.rmSync(path.join(root, '.update', 'neu'), { recursive: true, force: true });
    }
  });

  return r;
}
