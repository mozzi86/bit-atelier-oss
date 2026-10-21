// 73-10 (BEST-12): findings on existing elements, inside the survey tab. Pick an element of the latest
// model state, method (visual / opening / measurement / lab), category, text and a photo — the phone photo is
// the most used survey document, so it goes into the project storage (Document via ablage.js, folder
// 01_Grundlagen/Bestandsunterlagen) as a downscaled JPEG instead of a link that dies with the next computer.
// The finding is stored additively in befunde_layer.bestand (BCF part untouched). Raising the element's
// Erfassungsgrad is a separate, explicit click and only upwards.
//
// Data path: entities + Fachlayer through bitApi — works in every data source (local server, cloud, browser
// build on site); only the raise into a blob-stored model state needs the local blob store.
//
// In:  snapshot (latest model state) + its elements, onAngehoben() to reload. Writes befunde_layer
//      (useFachlayer; the other writer, BcfIssues in ModelCheck, is never mounted at the same time — same
//      rule as sketch_layer), Document, BimSnapshot/blob.
// Out: card; data-testids bb-karte, bb-element, bb-methode, bb-kategorie, bb-text, bb-foto, bb-speichern,
//      bb-eintrag-<id>, bb-anheben-<id>.
import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Camera } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { dokumentAblegen } from "@core/lib/ablage";
import { inhaltAblegen, inhaltLaden, blobIdNeu } from "@core/lib/speicherOrt";
import { inhaltPruefen } from "@core/lib/pfadRichtlinie.js";
import { erfassungAnzeige } from "@core/lib/bimClassification";
import { BEFUND_METHODEN, BEFUND_KATEGORIEN, befundAnlegen, befundEinfuegen, darfAnheben } from "@core/lib/bestandsBefund";
import { elementErfassungSetzen } from "@core/lib/snapshotElemente";
import { useFachlayer } from "@designer/lib/useFachlayer";

const inCls = "h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs";
/** Longest side of the stored photo in px [ASSUMED: enough to read a crack, ~150 kB as JPEG 0.8]. */
const FOTO_MAX_PX = 1280;

/** Downscale an image file to a JPEG data URL (browser canvas). */
async function fotoVerkleinern(datei) {
  const url = URL.createObjectURL(datei);
  try {
    const img = await new Promise((ok, fehler) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fehler(new Error("Bild nicht lesbar")); i.src = url; });
    const f = Math.min(1, FOTO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } finally { URL.revokeObjectURL(url); }
}

/**
 * @param {{snapshot: any, elemente: object[], onAngehoben?: () => void}} props
 */
export default function BestandsBefundKarte({ snapshot, elemente = [], onAngehoben }) {
  const { t } = useI18n();
  const { project } = useProject();
  const [layer, setLayer] = useFachlayer(project?.id, "befunde_layer", null);
  const [form, setForm] = useState({ guid: "", methode: "oeffnung", kategorie: "aufbau", text: "" });
  const [foto, setFoto] = useState(null);
  const [status, setStatus] = useState({ text: "", fehler: false, laeuft: false });
  const [fotos, setFotos] = useState({});
  const nachGuid = useMemo(() => new Map(elemente.map((e) => [e.guid ?? e.id, e])), [elemente]);
  const befunde = Array.isArray(layer?.bestand) ? layer.bestand : [];

  const speichern = async () => {
    setStatus({ text: "", fehler: false, laeuft: true });
    try {
      let fotoId = null;
      if (foto) {
        const data = await fotoVerkleinern(foto);
        const el = nachGuid.get(form.guid);
        // Storage rule (speicherOrt.js): the downscaled JPEG stays in the record when small, else object store.
        const ablage = await inhaltAblegen(data, { blobId: blobIdNeu("foto"), art: "foto" });
        const r = await dokumentAblegen({ projectId: project.id, name: foto.name || "befund.jpg", typ: "Bestandsfoto",
          notiz: `Bestandsbefund ${el?.name || el?.ifc_klasse || ""} ${form.guid}`.trim(), extra: { data_url: ablage.inline, data_blob: ablage.blob, mime: "image/jpeg" } });
        if (!r.ok) throw new Error(`${t("Foto nicht abgelegt")}: ${r.grund}`);
        fotoId = r.dokument?.id || null;
      }
      const b = befundAnlegen({ ...form, fotoDokumentId: fotoId });
      setLayer(befundEinfuegen(layer, b));
      setForm((f) => ({ ...f, text: "" })); setFoto(null);
      setStatus({ text: t("Befund gespeichert."), fehler: false, laeuft: false });
    } catch (e) {
      setStatus({ text: String(e?.message || e), fehler: true, laeuft: false });
    }
  };

  const anheben = async (b) => {
    const r = await elementErfassungSetzen(snapshot, b.guid, b.erfassung_vorschlag);
    if (!r.ok) { setStatus({ text: r.grund, fehler: true, laeuft: false }); return; }
    setLayer({ ...layer, bestand: befunde.map((x) => (x.id === b.id ? { ...x, angehoben: true } : x)) });
    setStatus({ text: `${t("Erfassungsgrad angehoben")}: ${b.guid} → ${t(erfassungAnzeige(b.erfassung_vorschlag))}`, fehler: false, laeuft: false });
    onAngehoben?.();
  };

  const fotoLaden = async (id) => {
    const d = await bitApi.entities.Document.filter({ id }).catch(() => []);
    const url = d?.[0] ? await inhaltLaden(d[0].data_url, d[0].data_blob).catch(() => null) : null;
    // 104-10: only an embedded raster image becomes <img src> — never a web address, a path or SVG.
    const bild = url ? inhaltPruefen(url, { typen: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"] }) : null;
    setFotos((m) => ({ ...m, [id]: bild?.ok ? bild.url : "" }));
  };

  return (
    <Card data-testid="bb-karte">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Camera className="h-4 w-4" /> {t("Bestandsbefunde am Bauteil")}</CardTitle>
        <p className="text-xs text-slate-500">{t("Öffnung, Schaden, Feuchte, Schadstoffverdacht — mit Foto in der Projektablage. Der Erfassungsgrad steigt nur auf Klick.")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!elemente.length ? <p className="text-xs text-slate-400">{t("Ohne Modellstand keine Bauteile zum Zuordnen.")}</p> : (
          <div className="grid gap-2 md:grid-cols-6">
            <select className={`${inCls} md:col-span-2`} data-testid="bb-element" value={form.guid} onChange={(e) => setForm({ ...form, guid: e.target.value })} aria-label={t("Bauteil")}>
              <option value="">{t("Bauteil wählen …")}</option>
              {elemente.filter((e) => e.ifc_klasse !== "IfcSpace").map((e) => (
                <option key={e.guid ?? e.id} value={e.guid ?? e.id}>{`${e.ifc_klasse || e.kind || ""} ${e.geschoss || ""} · ${e.guid ?? e.id} · ${t(erfassungAnzeige(e.erfassung))}`}</option>
              ))}
            </select>
            <select className={inCls} data-testid="bb-methode" value={form.methode} onChange={(e) => setForm({ ...form, methode: e.target.value })} aria-label={t("Methode")}>
              {Object.entries(BEFUND_METHODEN).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
            <select className={inCls} data-testid="bb-kategorie" value={form.kategorie} onChange={(e) => setForm({ ...form, kategorie: e.target.value })} aria-label={t("Kategorie")}>
              {Object.entries(BEFUND_KATEGORIEN).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
            <input type="file" accept="image/*" capture="environment" className="text-xs md:col-span-2" data-testid="bb-foto" onChange={(e) => setFoto(e.target.files?.[0] || null)} aria-label={t("Foto")} />
            <input className={`${inCls} md:col-span-5`} data-testid="bb-text" placeholder={t("Beschreibung (z. B. Mauerwerk 36,5 cm, keine Dämmung)")} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
            <Button size="sm" data-testid="bb-speichern" disabled={!form.guid || status.laeuft} onClick={speichern}>{t("Befund speichern")}</Button>
          </div>
        )}
        {status.text && <p className={`text-xs ${status.fehler ? "text-rose-600" : "text-emerald-700"}`} data-testid="bb-status">{status.text}</p>}
        {befunde.length > 0 && (
          <ul className="divide-y rounded border text-xs">
            {befunde.map((b) => {
              const el = nachGuid.get(b.guid);
              const kannAnheben = !b.angehoben && el && darfAnheben(el.erfassung, b.erfassung_vorschlag);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2 p-2" data-testid={`bb-eintrag-${b.id}`}>
                  <span className="font-medium">{b.datum}</span>
                  <span>{t(BEFUND_METHODEN[b.methode])} · {t(BEFUND_KATEGORIEN[b.kategorie])}</span>
                  <span className="font-mono text-slate-500">{b.guid}</span>
                  <span className="text-slate-600">{b.text}</span>
                  {b.foto_dokument_id && (fotos[b.foto_dokument_id]
                    ? <img src={fotos[b.foto_dokument_id]} alt={t("Befundfoto")} className="h-12 rounded border" />
                    : <button type="button" className="text-sky-700 underline" onClick={() => fotoLaden(b.foto_dokument_id)}>{t("Foto zeigen")}</button>)}
                  {b.angehoben && <span className="rounded bg-emerald-50 px-1 text-emerald-700">{t("angehoben")}</span>}
                  {kannAnheben && (
                    <Button size="sm" variant="outline" className="ml-auto" data-testid={`bb-anheben-${b.id}`} onClick={() => anheben(b)}>
                      {t("Erfassungsgrad anheben")}: {t(erfassungAnzeige(el.erfassung))} → {t(erfassungAnzeige(b.erfassung_vorschlag))}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
