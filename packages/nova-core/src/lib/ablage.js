// Ablegen — der EINE Weg, ein erzeugtes Dokument in die Projektablage zu bringen.
//
// Prinzip der einzigen Quelle (Weisung 26.08.2026): Kein Export entscheidet selbst,
// wohin er gehört. Er nennt seinen Dokumenttyp bzw. seinen Designer-Reiter, und
// `@core/lib/ordnerBaum.js` beantwortet den Rest. Fehlende Ordnerebenen entstehen
// dabei — ein Export darf nie ins Leere laufen, nur weil ein Ordner fehlt.
//
// Vorher (bis 26.08.2026): `exportElementToPdf` rief `pdf.save()` und war fertig. Die
// Datei landete im Download-Ordner des Rechners, das Projekt erfuhr nichts davon.

import { findeOderLegeAn, zielPfadFuer, zielPfadFuerReiter } from "@core/lib/ordnerBaum";
import { inhaltAblegen, blobIdNeu } from "@core/lib/speicherOrt";

// bitApi wird DYNAMISCH geladen, nicht oben importiert: es liest `import.meta.env`
// (Vite-only) und macht dieses Modul sonst in Node unimportierbar — dieselbe Falle,
// aus der Phase 33 den getApi()-Singleton entfernt hat. So bleibt die Ablage-Logik
// testbar, ohne einen Browser zu starten.
const echterApi = async () => (await import("@core/api/bitApi")).bitApi;

/**
 * Ein erzeugtes Dokument im richtigen Projektordner registrieren.
 *
 * Der Dateiinhalt wird NICHT in die DB kopiert — das PDF liegt beim Nutzer
 * (Download). Hier entsteht der Nachweis: was wurde wann wo erzeugt und wohin
 * gehört es. Eine Kopie wäre eine zweite Wahrheit, die sofort veraltet.
 *
 * Ausnahme seit Phase 81 (81-01): Versendete bzw. bestätigte Dokumente
 * (Honorarangebot, Auftragsbestätigung) geben `daten` mit — die Bytes als
 * Data-URL in `Document.data` (bestehende Konvention, Reports.jsx) und dazu
 * `sha256`: der Nachweis, WAS versendet wurde, muss nach dem Versand
 * unverändert vorliegen. Gewöhnliche Exporte bleiben ohne Kopie.
 * `bereich` ('projekt' | 'buero' | 'personal' | 'buchhaltung', Standard
 * 'projekt') markiert büro-interne Dokumente.
 *
 * @param {object} [opt]
 * @param {string} [opt.projectId] Pflicht — ohne Projekt keine Ablage (Rückgabe ok:false); Ausnahme seit
 *   Phase 82 (82-01): Büro- und Buchhaltungsschreiben (`bereich` 'schriftverkehr' | 'buchhaltung')
 *   gehören in keine Projektablage und liegen ohne Projekt und ohne Ordner
 * @param {string} [opt.name] Dateiname, wie er beim Nutzer liegt (Pflicht, sonst ok:false)
 * @param {string} [opt.typ] `Document.type`, z. B. "Bericht", "Plan-PDF", "Brandschutz"
 * @param {string} [opt.reiter] Designer-Reiter, z. B. "brandschutz" — Alternative zu `typ`
 * @param {string} [opt.notiz] freier Vermerk (Herkunft, Fassung …)
 * @param {object} [opt.extra] 73-10: additional Document fields (e.g. a downscaled photo `data_url`,
 *   `mime`, `bytes`) — additive, never overrides the fields above
 * @param {string} [opt.daten] Phase 81: Data-URL der Bytes (nur versendete/bestätigte Dokumente) → `Document.data`
 *   bzw. über 1 MB `Document.data_blob` (Speicherregel, inhaltAblegen)
 * @param {string} [opt.bereich] Phase 81: 'projekt' (Standard) | 'buero' | 'personal' | 'buchhaltung';
 *   Phase 82: 'schriftverkehr' (Büroschreiben, DOKUMENT_BEREICH in brief/status.js)
 * @param {string} [opt.sha256] Phase 81: Prüfsumme der Bytes (hex)
 * @param {object} [api] injizierbar für Tests; sonst wird bitApi dynamisch geladen
 * @returns {Promise<{ok: boolean, grund?: string, dokument?: object, pfad?: Array<string>, angelegt?: Array<string>, hinweis?: string}>}
 *   hinweis: plain text when large bytes had to stay in the database (no object store)
 */
export async function dokumentAblegen(
  { projectId, name, typ, reiter, notiz, extra = null, daten, bereich, sha256 } = {},
  api = null,
) {
  // 82-01: office and accounting letters have no project (81 added daten/bereich/sha256,
  // but no filing without a project); every other document still needs one.
  const ohneProjekt = !projectId && (bereich === "schriftverkehr" || bereich === "buchhaltung");
  if (!projectId && !ohneProjekt) return { ok: false, grund: "kein Projekt gewählt" };
  if (!name) return { ok: false, grund: "kein Dateiname" };
  const dienst = api || (await echterApi());
  if (ohneProjekt) return bueroDokumentAblegen({ name, typ, reiter, notiz, extra, daten, bereich, sha256 }, dienst);

  // Der Reiter ist der zweite Zugang zur selben Regel; `typ` hat Vorrang, wenn beides da ist.
  const pfad = typ ? zielPfadFuer(typ) : zielPfadFuerReiter(reiter);
  const dokumentTyp = typ || reiter || "Dokument";

  try {
    // KEIN .catch(() => []) hier: Wäre die Ordnerliste bei einem Lesefehler „leer",
    // würden wir die Ordner ein zweites Mal anlegen — genau die Doppelablage, die das
    // Prinzip der einzigen Quelle verhindern soll. Lieber gar nicht ablegen und melden.
    // (Ein Projekt ohne Ordner liefert regulär [] und läuft normal weiter.)
    const vorhandeneOrdner = await dienst.entities.ProjectFolder.filter({ project_id: projectId });

    const { id: folderId, angelegt } = await findeOderLegeAn(
      Array.isArray(vorhandeneOrdner) ? vorhandeneOrdner : [],
      pfad,
      ({ parent_id, name: ordnerName }) => dienst.entities.ProjectFolder.create({
        project_id: projectId,
        parent_id,
        name: ordnerName,
        created_date: new Date().toISOString(),
      }),
    );

    // Storage rule (SPEICHERREGEL.md): the bytes go through inhaltAblegen — over 1 MB into the object
    // store (`data_blob`), readers use inhaltLaden(data, data_blob).
    const ablage = daten
      ? await inhaltAblegen(daten, { blobId: blobIdNeu("dok"), art: "dokument", ...(dienst.blobs ? { api: dienst } : {}) })
      : null;
    const dokument = await dienst.entities.Document.create({
      ...(extra && typeof extra === "object" ? extra : {}),
      project_id: projectId,
      folder_id: folderId,
      name,
      type: dokumentTyp,
      notes: notiz || null,
      bereich: bereich || "projekt",
      ...(ablage ? { data: ablage.inline, ...(ablage.blob ? { data_blob: ablage.blob } : {}) } : {}),
      ...(sha256 ? { sha256 } : {}),
      created_date: new Date().toISOString(),
    });

    return { ok: true, dokument, pfad, angelegt, ...(ablage?.hinweis ? { hinweis: ablage.hinweis } : {}) };
  } catch (fehler) {
    // Ein fehlgeschlagener Ablage-Eintrag darf den Export selbst nie kippen —
    // das PDF ist beim Nutzer, nur der Nachweis fehlt. Aufrufer entscheidet, wie laut.
    return { ok: false, grund: fehler?.message || "Ablage fehlgeschlagen" };
  }
}

/**
 * Document of the office without project and folder (82-01): same fields and
 * storage rule as dokumentAblegen, project_id and folder_id null.
 * @param {{name: string, typ?: string, reiter?: string, notiz?: string, extra?: object|null, daten?: string, bereich: string, sha256?: string}} opt
 * @param {any} dienst bitApi or a fake
 * @returns {Promise<{ok: boolean, grund?: string, dokument?: object, pfad?: Array<string>, angelegt?: Array<string>, hinweis?: string}>}
 */
async function bueroDokumentAblegen({ name, typ, reiter, notiz, extra = null, daten, bereich, sha256 }, dienst) {
  try {
    const ablage = daten
      ? await inhaltAblegen(daten, { blobId: blobIdNeu("dok"), art: "dokument", ...(dienst.blobs ? { api: dienst } : {}) })
      : null;
    const dokument = await dienst.entities.Document.create({
      ...(extra && typeof extra === "object" ? extra : {}),
      project_id: null,
      folder_id: null,
      name,
      type: typ || reiter || "Dokument",
      notes: notiz || null,
      bereich,
      ...(ablage ? { data: ablage.inline, ...(ablage.blob ? { data_blob: ablage.blob } : {}) } : {}),
      ...(sha256 ? { sha256 } : {}),
      created_date: new Date().toISOString(),
    });
    return { ok: true, dokument, pfad: [], angelegt: [], ...(ablage?.hinweis ? { hinweis: ablage.hinweis } : {}) };
  } catch (fehler) {
    return { ok: false, grund: fehler?.message || "Ablage fehlgeschlagen" };
  }
}

/** Ablageort als lesbarer Pfad — für Meldungen an den Nutzer. */
export const pfadText = (pfad) =>
  Array.isArray(pfad) && pfad.length ? pfad.join(" / ") : "Projektwurzel";
