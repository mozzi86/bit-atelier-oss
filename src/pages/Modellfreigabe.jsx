// 106-10: "Modellfreigabe" - the review workplace of the BIM data manager. Every change a person confirmed in the BIM studio or the
// IFC viewer stands here with its origin ("Spracheingabe + Agent + Bildkontext", D-IM-07), its sentence, before / after, the check
// result, who confirmed it and when. A person releases steps or reverses them, one by one or as a batch; the release is noted with
// name and time. Second tab: the office's command library (sentences with placeholders and allowed values) that the speech grammar
// and the model's task text read.
//
// Guard rails: releasing and reversing are human actions (D-IM-04) - always a confirmation with the sentences in words before anything
// is written, the server refuses these writes from a program (routes.js NUR_PERSON_SCHREIBT), the MCP tools have no release tool.
// A reversal runs through the same function as the viewer's undo (aenderungUmkehren) and refuses instead of overwriting newer work.
// The export never carries an image (D-IM-02). Status in word + sign + border form, colour only from the app tokens (guard rail 5).
//
// The page is a lazy route chunk (App.jsx), so the size budget of the entry chunk is untouched.
//
// In:  the active project (ProjectContext), the signed-in person (AuthContext), the role (rechte.js "modell"/"voll").
// Out: DOM; data-testids freigabe-seite, freigabe-zeile (data-status, data-herkunft), freigabe-* buttons, bibliothek-*.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { NICHT_GESCHRIEBEN_TEXT, bimModelNeuLesen, loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";
import { EIGENSCHAFTEN, herkunftQuellen, herkunftText } from "@core/lib/zeigen/aenderungen.js";
import {
  STATUS_DARSTELLUNG, OHNE_NAME_TEXT, VERMERK_FEHLT_TEXT, freigabeAusfuehren, kiAenderung, personName, protokollCsv, protokollFiltern,
  ruecknahmeAusfuehren, schrittStatus, statusZaehlen, vorherNachher,
} from "@core/lib/zeigen/aenderungsProtokoll.js";
import { schritteLaden, schrittAktualisieren } from "@core/lib/zeigen/aenderungsProtokollSpeicher.js";
import { KEIN_AENDERUNGSRECHT_TEXT } from "@core/lib/zeigen/aenderungsBefehle.js";
import { STANDARD_VORLAGEN, VORLAGE_ENTITY, vorlagePruefen } from "@core/lib/zeigen/befehlsBibliothek.js";
import { bibliothekLaden } from "@core/lib/zeigen/befehlsBibliothekLaden.js";
import { sprachbefehl } from "@core/lib/zeigen/sprachbefehl.js";

/** Border form and token classes per review state (the word and the sign carry the meaning, colour only adds to it). */
const STATUS_KLASSE = {
  ungeprueft: "border border-dashed border-warnung-rand bg-warnung-flaeche text-warnung",
  freigegeben: "border border-solid border-erfolg-rand bg-erfolg-flaeche text-erfolg",
  zurueckgenommen: "border border-dotted border-border text-muted-foreground",
};

/** Sign per check level of the stored check result (same signs as the preview card of 106-03). */
const PRUEF_ZEICHEN = { fehler: "✕", warn: "▲", hinweis: "ℹ", ok: "✓" };

/** Byte order mark in front of the CSV, so a spreadsheet reads the umlauts as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** Labels of the confirming channels. */
const KANAL = { hand: "Knopf", sprache: "Sprache", tastatur: "Tastatur" };

/** @param {string|null|undefined} iso @returns {string} "26.10.2026, 14:05" local, "" when not readable */
const zeitText = (iso) => {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * Where the element of a step is shown: BIM studio tab with the GUID to select, or the IFC viewer with ?sel (106-02 selection).
 * @param {any} s @returns {string}
 */
function sprungZiel(s) {
  const guid = encodeURIComponent(String(s?.nachher?.teile?.[0]?.guid ?? s?.ziel?.guid ?? ""));
  return s?.quelle === "ifc" ? `/IfcViewer?sel=${guid}` : `/ComplexDesigner?tab=bim&auswahl=${guid}`;
}

/** Texts of the core with a part that is filled in at run time: template (i18n key) and placeholder. */
const KERN_VORLAGEN = [["Schon freigegeben durch {name}", "{name}"], [NICHT_GESCHRIEBEN_TEXT, "{felder}"], [`${VERMERK_FEHLT_TEXT} ({grund})`, "{grund}"]];

/**
 * A refusal or error text of the core in the UI language (review 106-10): fixed texts are keys themselves; a text with a run-time part
 * is matched against its template, the template is translated and the part put back.
 * @param {string} text  German text as the core threw it. @param {(s: string) => string} t
 * @returns {string}
 */
function kernText(text, t) {
  for (const [vorlage, platz] of KERN_VORLAGEN) {
    const [vor, nach] = vorlage.split(platz);
    if (text.startsWith(vor) && text.endsWith(nach) && text.length >= vor.length + nach.length) {
      return t(vorlage).replace(platz, text.slice(vor.length, text.length - nach.length));
    }
  }
  return t(text);
}

/**
 * The review state as a badge: sign, word, border form, token colour.
 * @param {{status: "ungeprueft"|"freigegeben"|"zurueckgenommen", t: (s: string) => string}} props
 */
function StatusMarke({ status, t }) {
  const d = STATUS_DARSTELLUNG[status];
  return (
    <span data-testid="freigabe-status" data-status={status} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_KLASSE[status]}`}>
      <span aria-hidden="true">{d.zeichen}</span>{t(d.wort)}
    </span>
  );
}

/**
 * The review page.
 */
export default function Modellfreigabe() {
  const { t } = useI18n();
  const { projectId, project } = useProject();
  const { user } = useAuth();
  const zugriff = useZugriff();
  const darf = zugriff.darf("modell", "voll");
  // review 106-10: the active office person, never the local sign-in stand-in "Lokaler Nutzer" (personName)
  const name = personName(zugriff, user);
  const [reiter, setReiter] = useState(/** @type {"aenderungen"|"bibliothek"} */ ("aenderungen"));
  const [schritte, setSchritte] = useState(/** @type {any[]} */ ([]));
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState("");
  const [meldung, setMeldung] = useState(/** @type {{text: string, stufe: "ok"|"fehler"}|null} */ (null));
  const [filter, setFilter] = useState(/** @type {{status: any, umfang: "ki"|"alle", quelle: "alle"|"bim"|"ifc", suche: string}} */ ({ status: "ungeprueft", umfang: "ki", quelle: "alle", suche: "" }));
  const [auswahl, setAuswahl] = useState(/** @type {Set<string>} */ (new Set()));
  const [frage, setFrage] = useState(/** @type {{art: "freigeben"|"zuruecknehmen", liste: any[]}|null} */ (null));
  const [arbeitet, setArbeitet] = useState(false);

  const laden = useCallback(async () => {
    if (!projectId) { setSchritte([]); return; }
    setLaedt(true); setFehler("");
    try { setSchritte(await schritteLaden(projectId)); }
    catch (e) { setFehler(`${t("Änderungsprotokoll nicht geladen")}: ${/** @type {any} */ (e)?.message || e}`); }
    finally { setLaedt(false); }
  }, [projectId, t]);
  useEffect(() => { setAuswahl(new Set()); setFrage(null); void laden(); }, [laden]);

  const liste = useMemo(() => protokollFiltern(schritte, filter), [schritte, filter]);
  const zahlen = useMemo(() => statusZaehlen(schritte, filter.umfang), [schritte, filter.umfang]);
  const gewaehlt = liste.filter((s) => auswahl.has(s.id));
  // a batch release takes only the unreviewed ones of the selection (review 106-10: "select all" under "Alle" also picks released steps)
  const freizugeben = gewaehlt.filter((s) => schrittStatus(s) === "ungeprueft");
  const sperrText = !darf ? t(KEIN_AENDERUNGSRECHT_TEXT) : !name ? t(OHNE_NAME_TEXT) : "";

  const umschalten = (/** @type {string} */ id) => setAuswahl((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /** Runs the confirmed question. */
  const ausfuehren = async () => {
    if (!frage || !projectId) return;
    setArbeitet(true); setMeldung(null);
    try {
      const r = frage.art === "freigeben"
        ? await freigabeAusfuehren(frage.liste, { durch: name, speichern: schrittAktualisieren })
        : await ruecknahmeAusfuehren(frage.liste, schritte, {
          projektId: projectId, durch: name || null,
          // build on the STORED model, not on a version cached before another tab or device saved
          bimLaden: async () => { await bimModelNeuLesen(projectId); return loadBimModel(projectId); },
          // all or nothing (review 106-10): a field held back by a conflict or changed meanwhile rejects - no note on an unchanged model
          bimSpeichern: (felder) => saveBimModel(projectId, felder, { streng: true }),
          journalLaden: async (modell) => (await bitApi.entities.IfcAenderung.filter({ project_id: projectId, modell })) || [],
          journalLoeschen: (e) => bitApi.entities.IfcAenderung.delete(e.id),
          vermerken: schrittAktualisieren,
        });
      const vorlage = frage.art === "freigeben" ? "{n} freigegeben" : "{n} zurückgenommen";
      const text = [t(vorlage).replace("{n}", String(r.erledigt.length)), ...r.fehler.map((f) => `${f.schritt.satz}: ${kernText(f.text, t)}`)].join(" — ");
      setMeldung({ text, stufe: r.fehler.length ? "fehler" : "ok" });
      setFrage(null);
      setAuswahl(new Set());
      await laden();
    } finally { setArbeitet(false); }
  };

  const exportieren = () => {
    const csv = protokollCsv(liste, { projekt: project ? { name: project.name, nda: project.nda === true } : null, t });
    const url = URL.createObjectURL(new Blob([BOM + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `aenderungsprotokoll-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!projectId) {
    return (
      <div data-testid="freigabe-seite" className="space-y-4 p-4">
        <h1 className="text-3xl font-bold text-foreground">{t("Modellfreigabe")}</h1>
        <p className="text-muted-foreground">{t("Erst ein Projekt wählen — die Freigabe gilt je Projekt.")}</p>
      </div>
    );
  }

  return (
    <div data-testid="freigabe-seite" className="space-y-4 p-4">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t("Modellfreigabe")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("Änderungen von Agenten und Spracheingabe prüfen: freigeben oder zurücknehmen. Jede Freigabe wird mit Name und Zeit vermerkt.")}
        </p>
      </div>
      <div role="tablist" className="flex gap-2 border-b border-border">
        {[["aenderungen", "Änderungen"], ["bibliothek", "Befehlsbibliothek"]].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={reiter === id} data-testid={`freigabe-reiter-${id}`} onClick={() => setReiter(/** @type {any} */ (id))}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${reiter === id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground"}`}>{t(label)}</button>
        ))}
      </div>

      {reiter === "bibliothek" ? <Bibliothek t={t} darf={darf} /> : (
        <div className="space-y-3">
          {/* filters: status, scope, source, words */}
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("Status")}</span>
              <select data-testid="freigabe-filter-status" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
                className="rounded border border-border bg-background px-2 py-1">
                <option value="ungeprueft">{t("Ungeprüft")} ({zahlen.ungeprueft})</option>
                <option value="freigegeben">{t("Freigegeben")} ({zahlen.freigegeben})</option>
                <option value="zurueckgenommen">{t("Zurückgenommen")} ({zahlen.zurueckgenommen})</option>
                <option value="alle">{t("Alle")} ({zahlen.alle})</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("Umfang")}</span>
              <select data-testid="freigabe-filter-umfang" value={filter.umfang} onChange={(e) => setFilter((f) => ({ ...f, umfang: /** @type {any} */ (e.target.value) }))}
                className="rounded border border-border bg-background px-2 py-1">
                <option value="ki">{t("Agent, Sprache, Bild")}</option>
                <option value="alle">{t("Alle Schritte")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("Quelle")}</span>
              <select data-testid="freigabe-filter-quelle" value={filter.quelle} onChange={(e) => setFilter((f) => ({ ...f, quelle: /** @type {any} */ (e.target.value) }))}
                className="rounded border border-border bg-background px-2 py-1">
                <option value="alle">{t("Alle")}</option>
                <option value="bim">{t("BIM-Studio")}</option>
                <option value="ifc">{t("IFC-Viewer")}</option>
              </select>
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("Suche")}</span>
              <input data-testid="freigabe-suche" value={filter.suche} onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
                className="rounded border border-border bg-background px-2 py-1" placeholder={t("Satz, Bauteil, GUID, Person")} />
            </label>
            <button type="button" onClick={() => void laden()} className="rounded border border-border px-3 py-1">{t("Neu laden")}</button>
            <button type="button" data-testid="freigabe-export" onClick={exportieren} disabled={!liste.length} className="rounded border border-border px-3 py-1 disabled:opacity-50">{t("Als CSV exportieren")}</button>
          </div>

          {sperrText ? <p data-testid="freigabe-recht" className="rounded border border-dotted border-border px-2 py-1 text-sm text-muted-foreground"><span aria-hidden="true">ℹ </span>{sperrText}</p> : null}
          {fehler ? <p role="alert" className="rounded border border-solid border-fehler-rand bg-fehler-flaeche px-2 py-1 text-sm text-fehler"><span aria-hidden="true">✕ </span>{fehler}</p> : null}
          {meldung ? (
            <p role="status" data-testid="freigabe-meldung" data-stufe={meldung.stufe}
              className={`rounded px-2 py-1 text-sm ${meldung.stufe === "fehler" ? "border border-solid border-fehler-rand bg-fehler-flaeche text-fehler" : "border border-solid border-erfolg-rand bg-erfolg-flaeche text-erfolg"}`}>
              <span aria-hidden="true">{meldung.stufe === "fehler" ? "✕ " : "✓ "}</span>{meldung.text}
            </p>
          ) : null}

          {/* batch actions */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" data-testid="freigabe-alle-waehlen" onClick={() => setAuswahl(new Set(liste.filter((s) => schrittStatus(s) !== "zurueckgenommen").map((s) => s.id)))}
              disabled={!liste.length} className="rounded border border-border px-3 py-1 disabled:opacity-50">{t("Alle sichtbaren wählen")}</button>
            <button type="button" data-testid="freigabe-sammel-freigeben" disabled={!freizugeben.length || !!sperrText}
              onClick={() => setFrage({ art: "freigeben", liste: freizugeben })} className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50">
              {t("Ausgewählte freigeben")} ({freizugeben.length})</button>
            <button type="button" data-testid="freigabe-sammel-zuruecknehmen" disabled={!gewaehlt.length || !!sperrText}
              onClick={() => setFrage({ art: "zuruecknehmen", liste: gewaehlt })} className="rounded border border-border px-3 py-1 disabled:opacity-50">
              {t("Ausgewählte zurücknehmen")} ({gewaehlt.length})</button>
          </div>

          {/* the question before anything is written: the sentences in words, then the person confirms (D-IM-04) */}
          {frage ? (
            <div data-testid="freigabe-frage" data-art={frage.art} role="dialog" aria-label={t("Bestätigen")}
              className="rounded border border-dashed border-warnung-rand bg-warnung-flaeche p-3 text-sm text-foreground">
              <div className="font-semibold">
                {frage.art === "freigeben"
                  ? t("Diese {n} Änderungen freigeben (Ihr Name und die Zeit werden vermerkt):").replace("{n}", String(frage.liste.length))
                  : t("Diese {n} Änderungen zurücknehmen — das Modell wird geändert, die neueste zuerst:").replace("{n}", String(frage.liste.length))}
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {frage.liste.map((s) => <li key={s.id} data-testid="freigabe-frage-satz">{s.satz}</li>)}
              </ul>
              <div className="mt-3 flex gap-2">
                <button type="button" data-testid="freigabe-bestaetigen" disabled={arbeitet} onClick={() => void ausfuehren()}
                  className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50">{t("Bestätigen")}</button>
                <button type="button" data-testid="freigabe-abbrechen" disabled={arbeitet} onClick={() => setFrage(null)} className="rounded border border-border px-3 py-1">{t("Abbrechen")}</button>
              </div>
            </div>
          ) : null}

          {laedt ? <p className="text-sm text-muted-foreground">{t("Wird geladen …")}</p> : null}
          {!laedt && !liste.length ? <p data-testid="freigabe-leer" className="text-sm text-muted-foreground">{t("Keine Änderungen in dieser Auswahl.")}</p> : null}
          <ul className="space-y-2" data-testid="freigabe-liste">
            {liste.map((s) => {
              const st = schrittStatus(s);
              const vn = vorherNachher(s, t);
              const p = s.pruefung;
              return (
                <li key={s.id} data-testid="freigabe-zeile" data-status={st} data-herkunft={herkunftQuellen(s).join("+")} data-vorschlag-id={s.vorschlag_id}
                  className="rounded border border-border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-start gap-3">
                    <input type="checkbox" aria-label={t("Auswählen")} data-testid="freigabe-waehlen" checked={auswahl.has(s.id)} disabled={st === "zurueckgenommen"}
                      onChange={() => umschalten(s.id)} className="mt-1" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusMarke status={st} t={t} />
                        <span data-testid="freigabe-herkunft" className={`rounded px-1.5 py-0.5 text-xs ${kiAenderung(s) ? "border border-dashed border-border" : "border border-solid border-border"}`}>
                          {t("Herkunft")}: {herkunftText(s, t)}</span>
                        <span className="text-xs text-muted-foreground">{zeitText(s.zeit)}</span>
                      </div>
                      <div data-testid="freigabe-satz" className="font-medium text-foreground">{s.satz}</div>
                      {s.befehl_text ? <div className="text-xs text-muted-foreground">„{s.befehl_text}“</div> : null}
                      <div className="text-xs text-foreground">
                        <span className="text-muted-foreground">{t("Vorher")}:</span> {vn.vorher || "—"} <span aria-hidden="true">→</span> <span className="text-muted-foreground">{t("Nachher")}:</span> {vn.nachher || "—"}
                      </div>
                      <div data-testid="freigabe-pruefung" className="text-xs">
                        {p ? <><span aria-hidden="true">{PRUEF_ZEICHEN[/** @type {keyof typeof PRUEF_ZEICHEN} */ (p.stufe)] ?? "✓"} </span>{t("Prüfung")}: {p.saetze?.length ? p.saetze.join(" · ") : t("keine Auffälligkeit")}</>
                          : <span className="italic text-muted-foreground"><span aria-hidden="true">○ </span>{t("nicht geprüft")}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("Bestätigt von")} {s.autor || t("unbekannt")}{s.bestaetigt_durch ? ` (${t(KANAL[/** @type {keyof typeof KANAL} */ (s.bestaetigt_durch)] ?? s.bestaetigt_durch)})` : ""}
                        {s.freigabe ? <span data-testid="freigabe-vermerk"> · {t("Freigegeben durch")} {s.freigabe.durch}, {zeitText(s.freigabe.zeit)}</span> : null}
                        {s.zurueckgenommen ? <span data-testid="freigabe-ruecknahme"> · {t("Zurückgenommen")} {zeitText(s.zurueckgenommen.zeit)}{s.zurueckgenommen.durch ? ` (${s.zurueckgenommen.durch})` : ""}</span> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <a data-testid="freigabe-sprung" href={sprungZiel(s)}
                        title={s.quelle === "ifc" && s.modell ? t("Im IFC-Viewer das Modell {datei} laden").replace("{datei}", String(s.modell)) : undefined} className="rounded border border-border px-2 py-1 text-center text-xs">{t("Zum Bauteil")}</a>
                      {st === "ungeprueft" ? (
                        <button type="button" data-testid="freigabe-einzeln-freigeben" disabled={!!sperrText} onClick={() => setFrage({ art: "freigeben", liste: [s] })}
                          className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">{t("Freigeben")}</button>
                      ) : null}
                      {st !== "zurueckgenommen" ? (
                        <button type="button" data-testid="freigabe-einzeln-zuruecknehmen" disabled={!!sperrText} onClick={() => setFrage({ art: "zuruecknehmen", liste: [s] })}
                          className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">{t("Zurücknehmen")}</button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Tab "Befehlsbibliothek": the office's templates (entity Befehlsvorlage) - list with validity, add / edit / switch off / delete, the
 * starting set, and a test field that runs a sentence through the grammar with these templates (nothing is changed by the test).
 * @param {{t: (s: string) => string, darf: boolean}} props  darf: the role may edit (same right as changing the model).
 */
function Bibliothek({ t, darf }) {
  const [roh, setRoh] = useState(/** @type {any[]} */ ([]));
  const [fehler, setFehler] = useState("");
  const leer = { id: "", satz: "Setze {eigenschaft} auf {wert}", eigenschaft: "feuerwiderstand", werte: "", beschreibung: "", aktiv: true };
  const [form, setForm] = useState(leer);
  const [probe, setProbe] = useState("");
  const [vorlagen, setVorlagen] = useState(/** @type {any[]} */ ([]));
  // a template is deleted only after a question in words (review 106-10: the library steers what speech and agents may set)
  const [loeschFrage, setLoeschFrage] = useState(/** @type {any|null} */ (null));
  const api = /** @type {any} */ (bitApi.entities)[VORLAGE_ENTITY];

  const laden = useCallback(async () => {
    const r = await bibliothekLaden({ neu: true });
    setRoh(r.roh); setVorlagen(r.vorlagen); setFehler(r.fehler ? t(r.fehler.split(":")[0]) + r.fehler.slice(r.fehler.indexOf(":")) : "");
  }, [t]);
  useEffect(() => { void laden(); }, [laden]);

  const speichern = async () => {
    setFehler("");
    try {
      const n = vorlagePruefen({ ...form, werte: form.werte });
      const daten = { satz: n.satz, eigenschaft: n.eigenschaft, werte: n.werte, beschreibung: n.beschreibung, aktiv: n.aktiv };
      if (form.id) await api.update(form.id, daten); else await api.create(daten);
      setForm(leer);
      await laden();
    } catch (e) { setFehler(t(String(/** @type {any} */ (e)?.message || e))); }
  };
  const standardAnlegen = async () => {
    setFehler("");
    try { for (const v of STANDARD_VORLAGEN) await api.create({ ...v, aktiv: true }); await laden(); }
    catch (e) { setFehler(String(/** @type {any} */ (e)?.message || e)); }
  };
  const loeschen = async (/** @type {any} */ v) => {
    setLoeschFrage(null);
    try { await api.delete(v.id); await laden(); } catch (e) { setFehler(String(/** @type {any} */ (e)?.message || e)); }
  };
  // the test runs the grammar with a stand-in selection: it shows what the sentence becomes, nothing is proposed or changed
  const probeErgebnis = probe.trim() ? sprachbefehl(probe, { auswahl: { anzahl: 1, bauteile: [{ guid: "probe", klasse: null }] }, bibliothek: vorlagen }) : null;

  return (
    <div className="space-y-4 text-sm" data-testid="bibliothek">
      <p className="max-w-3xl text-muted-foreground">
        {t("Häufige Sätze des Büros mit Platzhaltern. Die Spracheingabe versteht sie ohne Sprachmodell und nimmt bei diesen Eigenschaften nur die erlaubten Werte an. Das Sprachmodell bekommt die Werte genannt; schlägt ein Agent einen anderen Wert vor, zeigt die Prüfung auf der Vorschlagskarte eine Warnung — verhindert wird der Vorschlag nicht.")}
      </p>
      {fehler ? <p role="alert" data-testid="bibliothek-fehler" className="rounded border border-solid border-fehler-rand bg-fehler-flaeche px-2 py-1 text-fehler"><span aria-hidden="true">✕ </span>{fehler}</p> : null}
      {!darf ? <p className="rounded border border-dotted border-border px-2 py-1 text-muted-foreground"><span aria-hidden="true">ℹ </span>{t(KEIN_AENDERUNGSRECHT_TEXT)}</p> : null}
      {!roh.length ? (
        <button type="button" data-testid="bibliothek-standard" disabled={!darf} onClick={() => void standardAnlegen()} className="rounded border border-border px-3 py-1 disabled:opacity-50">
          {t("Standardvorlagen anlegen")}</button>
      ) : null}
      <ul className="space-y-2">
        {roh.map((v) => {
          let gueltig = "";
          try { vorlagePruefen(v); } catch (e) { gueltig = String(/** @type {any} */ (e)?.message || e); }
          return (
            <li key={v.id} data-testid="bibliothek-vorlage" className={`rounded p-2 ${gueltig ? "border border-solid border-fehler-rand" : v.aktiv === false ? "border border-dotted border-border" : "border border-solid border-border"} bg-card`}>
              <div className="font-medium text-foreground">{v.satz}</div>
              <div className="text-xs text-muted-foreground">
                {t(EIGENSCHAFTEN.find((e) => e.feld === v.eigenschaft)?.label ?? v.eigenschaft)}: {(v.werte || []).join(", ")}{v.beschreibung ? ` — ${v.beschreibung}` : ""}
                {v.aktiv === false ? ` · ${t("ausgeschaltet")}` : ""}
              </div>
              {gueltig ? <div className="text-xs text-fehler"><span aria-hidden="true">✕ </span>{t(gueltig)}</div> : null}
              <div className="mt-1 flex gap-2">
                <button type="button" disabled={!darf} onClick={() => setForm({ id: v.id, satz: v.satz, eigenschaft: v.eigenschaft, werte: (v.werte || []).join(", "), beschreibung: v.beschreibung || "", aktiv: v.aktiv !== false })}
                  className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50">{t("Bearbeiten")}</button>
                <button type="button" data-testid="bibliothek-loeschen" disabled={!darf} onClick={() => setLoeschFrage(v)} className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50">{t("Löschen")}</button>
              </div>
              {loeschFrage?.id === v.id ? (
                <div data-testid="bibliothek-loeschen-frage" role="dialog" aria-label={t("Löschen")} className="mt-2 rounded border border-dashed border-warnung-rand bg-warnung-flaeche p-2 text-xs text-foreground">
                  {t("Vorlage „{satz}“ löschen? Danach gelten ihre Werte für {eigenschaft} nicht mehr.").replace("{satz}", String(v.satz)).replace("{eigenschaft}", t(EIGENSCHAFTEN.find((e) => e.feld === v.eigenschaft)?.label ?? v.eigenschaft))}
                  <div className="mt-2 flex gap-2">
                    <button type="button" data-testid="bibliothek-loeschen-bestaetigen" onClick={() => void loeschen(v)} className="rounded bg-primary px-2 py-0.5 text-primary-foreground">{t("Bestätigen")}</button>
                    <button type="button" onClick={() => setLoeschFrage(null)} className="rounded border border-border px-2 py-0.5">{t("Abbrechen")}</button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <fieldset disabled={!darf} className="max-w-3xl space-y-2 rounded border border-border p-3">
        <legend className="px-1 font-semibold">{form.id ? t("Vorlage bearbeiten") : t("Neue Vorlage")}</legend>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("Satz mit {eigenschaft} und {wert} am Ende")}</span>
          <input data-testid="bibliothek-satz" value={form.satz} onChange={(e) => setForm((f) => ({ ...f, satz: e.target.value }))} className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("Eigenschaft")}</span>
          <select data-testid="bibliothek-eigenschaft" value={form.eigenschaft} onChange={(e) => setForm((f) => ({ ...f, eigenschaft: e.target.value }))} className="rounded border border-border bg-background px-2 py-1">
            {EIGENSCHAFTEN.map((e) => <option key={e.feld} value={e.feld}>{t(e.label)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("Erlaubte Werte, mit Komma getrennt")}</span>
          <input data-testid="bibliothek-werte" value={form.werte} onChange={(e) => setForm((f) => ({ ...f, werte: e.target.value }))} className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("Beschreibung")}</span>
          <input value={form.beschreibung} onChange={(e) => setForm((f) => ({ ...f, beschreibung: e.target.value }))} className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.aktiv} onChange={(e) => setForm((f) => ({ ...f, aktiv: e.target.checked }))} />{t("Aktiv")}
        </label>
        <div className="flex gap-2">
          <button type="button" data-testid="bibliothek-speichern" onClick={() => void speichern()} className="rounded bg-primary px-3 py-1 text-primary-foreground">{t("Speichern")}</button>
          {form.id ? <button type="button" onClick={() => setForm(leer)} className="rounded border border-border px-3 py-1">{t("Abbrechen")}</button> : null}
        </div>
      </fieldset>
      <label className="flex max-w-3xl flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("Satz ausprobieren (ändert nichts)")}</span>
        <input data-testid="bibliothek-probe" value={probe} onChange={(e) => setProbe(e.target.value)} className="rounded border border-border bg-background px-2 py-1" placeholder={t("z. B. Setze Brandschutz auf F90")} />
      </label>
      {probeErgebnis ? (
        <p data-testid="bibliothek-probe-ergebnis" data-art={probeErgebnis.art}
          className={`max-w-3xl rounded px-2 py-1 ${probeErgebnis.art === "abgelehnt" ? "border border-solid border-fehler-rand text-fehler" : "border border-dashed border-border text-foreground"}`}>
          {probeErgebnis.art === "befehl" ? `${t("Verstanden")}: ${probeErgebnis.verstanden}` : probeErgebnis.art === "abgelehnt" ? t(probeErgebnis.grund) : `${t("Verstanden")}: ${t("Rückgängig")}`}
        </p>
      ) : probe.trim() ? <p data-testid="bibliothek-probe-ergebnis" data-art="unbekannt" className="text-muted-foreground">{t("Nicht in Grammatik und Bibliothek — ginge an das Sprachmodell")}</p> : null}
    </div>
  );
}
