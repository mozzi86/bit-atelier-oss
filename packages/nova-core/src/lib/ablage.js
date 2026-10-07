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
 * @param {object} opt
 * @param {string} opt.projectId Pflicht — ohne Projekt keine Ablage
 * @param {string} opt.name Dateiname, wie er beim Nutzer liegt
 * @param {string} [opt.typ] `Document.type`, z. B. "Bericht", "Plan-PDF", "Brandschutz"
 * @param {string} [opt.reiter] Designer-Reiter, z. B. "brandschutz" — Alternative zu `typ`
 * @param {string} [opt.notiz] freier Vermerk (Herkunft, Fassung …)
 * @param {object} [api] injizierbar für Tests; sonst wird bitApi dynamisch geladen
 * @returns {Promise<{ok: boolean, grund?: string, dokument?: object, pfad?: Array<string>, angelegt?: Array<string>}>}
 */
export async function dokumentAblegen(
  { projectId, name, typ, reiter, notiz } = {},
  api = null,
) {
  if (!projectId) return { ok: false, grund: "kein Projekt gewählt" };
  if (!name) return { ok: false, grund: "kein Dateiname" };
  const dienst = api || (await echterApi());

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

    const dokument = await dienst.entities.Document.create({
      project_id: projectId,
      folder_id: folderId,
      name,
      type: dokumentTyp,
      notes: notiz || null,
      created_date: new Date().toISOString(),
    });

    return { ok: true, dokument, pfad, angelegt };
  } catch (fehler) {
    // Ein fehlgeschlagener Ablage-Eintrag darf den Export selbst nie kippen —
    // das PDF ist beim Nutzer, nur der Nachweis fehlt. Aufrufer entscheidet, wie laut.
    return { ok: false, grund: fehler?.message || "Ablage fehlgeschlagen" };
  }
}

/** Ablageort als lesbarer Pfad — für Meldungen an den Nutzer. */
export const pfadText = (pfad) =>
  Array.isArray(pfad) && pfad.length ? pfad.join(" / ") : "Projektwurzel";
