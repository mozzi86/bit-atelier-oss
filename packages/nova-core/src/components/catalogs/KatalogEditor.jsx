import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { AlertTriangle, Building2, Info, Plus, Save, X } from "lucide-react";
import {
  KATALOG_ENTITAETEN, SCHLUESSELFELD, validiereKatalogZeile, wirksameZeilen,
} from "@core/lib/rules/catalogs";

// KatalogEditor — GENERISCHE Pflege über alle 14 büroweiten Kataloge.
//
// Warum generisch und nicht 14 Formulare: die Kataloge sind DATEN. Ein Formular je
// Katalog wäre 14-mal dieselbe Mechanik und 14 Gelegenheiten, sie unterschiedlich
// zu machen. Der Server ist es auch schon (`/entities/:entity`).
//
// Warum das trotzdem kein „JSON-Editor" ist: **Referenzvalidierung**. Eine
// Katalogzeile, die auf eine unbekannte Mengenbasis, Einheit oder Kostengruppe
// zeigt, verschiebt Mengen und Preise über ALLE Projekte — und zwar lautlos.
// Kataloge sind Daten ohne Compiler; die Typprüfung entsteht hier oder nirgends
// (T-33-19). Speichern wird deshalb ABGEWIESEN, nicht nur kommentiert.
//
// Und: `projekt_override_id`. Ein Projekt darf eine Zeile ersetzen, ohne den
// Bürostandard anzufassen. Die Liste zeigt sichtbar, welche Zeile büroweit gilt
// und welche nur hier — sonst „reparieren" Leute den Bürostandard für ein Projekt
// und wundern sich Monate später über andere Projekte.

const ANZEIGE_FELDER = {
  Din276Katalog: ["fassung", "code", "name", "gruppe"],
  KgRegel: ["name", "ifc_klasse", "status", "kg2018", "kg2008", "prio", "confidence"],
  MengenMuster: ["nr", "name", "ifc_klasse", "mengenbasis", "faktor", "einheit"],
  AusschlussGrund: ["code", "name", "text_pflicht"],
  MengenbasisKatalog: ["key", "einheit", "dimension", "quelle"],
  EinheitenKatalog: ["code", "name", "dimension", "vorhaltung"],
  StatusKonvention: ["intern", "pipeline", "ifc_enum", "anzeige"],
  BaustoffKonvention: ["intern", "anzeige"],
  Preisindexreihe: ["reihe", "basis", "quelle", "assumed"],
  PreisRangfolge: ["rang", "art", "name", "belastbarkeit", "ep_berechnet", "eingefroren"],
  AmpelSchwelle: ["kontext", "gruen_bis", "gelb_bis", "hinweis"],
  StlbKatalog: ["lb", "name", "kurztext", "einheit"],
  ReferenzpreisPool: ["kurztext", "einheit", "ep", "stand", "projekt_nr", "gewerk", "kg"],
  PreisUebernahmeRegel: ["name", "prio", "min_similarity", "review_von", "ratio_min", "ratio_max"],
};

const zellwert = (v) => {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export default function KatalogEditor({
  kataloge = {},
  projektId = null,
  onSave,
  onDelete,
  startKatalog = "MengenMuster",
}) {
  const [entity, setEntity] = useState(startKatalog);
  const [entwurf, setEntwurf] = useState(null);
  const [fehler, setFehler] = useState([]);
  const [busy, setBusy] = useState(false);

  const felder = useMemo(
    () => ANZEIGE_FELDER[entity] || [SCHLUESSELFELD[entity] || "code"],
    [entity],
  );
  const zeilen = useMemo(
    () => wirksameZeilen(kataloge, entity, projektId),
    [kataloge, entity, projektId],
  );
  const alleZeilen = kataloge[entity] || [];

  const beginnen = (zeile) => {
    setFehler([]);
    setEntwurf(
      zeile
        ? { ...zeile }
        : {
            scope: projektId ? "projekt" : "buero",
            projekt_override_id: projektId ?? null,
            ...Object.fromEntries(felder.map((f) => [f, null])),
          },
    );
  };

  const setFeld = (feld, wert) => setEntwurf((d) => ({ ...d, [feld]: wert }));

  const speichern = async () => {
    // HIER wird abgewiesen. Nicht gewarnt, nicht toleriert.
    const pruefung = validiereKatalogZeile(entity, entwurf, kataloge);
    setFehler(pruefung.fehler);
    if (!pruefung.ok) return;
    setBusy(true);
    try {
      await onSave?.(entity, entwurf);
      setEntwurf(null);
    } finally {
      setBusy(false);
    }
  };

  const feldFehler = (feld) => fehler.find((f) => f.feld === feld) || null;

  // Kataloge, die auf andere Kataloge zeigen — nur dort ist Validierung möglich.
  const referenzHinweis = useMemo(() => {
    const bezug = [];
    if (felder.includes("mengenbasis")) bezug.push("MengenbasisKatalog");
    if (felder.includes("einheit")) bezug.push("EinheitenKatalog");
    if (felder.some((f) => f.startsWith("kg"))) bezug.push("Din276Katalog");
    return bezug;
  }, [felder]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>Kataloge — büroweite Standards</span>
          <div className="flex items-center gap-2">
            <Select value={entity} onValueChange={(v) => { setEntity(v); setEntwurf(null); setFehler([]); }}>
              <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                {KATALOG_ENTITAETEN.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e} ({(kataloge[e] || []).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => beginnen(null)}>
              <Plus className="w-3 h-3 mr-1" /> Zeile
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-xs text-slate-600 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Diese {KATALOG_ENTITAETEN.length} Kataloge gelten <strong>büroweit</strong> und
            wirken über alle Projekte. Eine Zeile mit <code>projekt_override_id</code> ersetzt
            den Bürostandard <strong>nur in diesem Projekt</strong>.
            {referenzHinweis.length > 0 && (
              <> Referenzen werden gegen {referenzHinweis.join(", ")} geprüft — eine unbekannte
              Referenz wird beim Speichern <strong>abgewiesen</strong>, nicht als 0 verbucht.</>
            )}
          </span>
        </p>

        {/* --- Formular ---------------------------------------------------- */}
        {entwurf && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                {entwurf.id ? "Zeile ändern" : "Neue Zeile"} · {entity}
              </span>
              <button type="button" onClick={() => setEntwurf(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {felder.map((feld) => {
                const fe = feldFehler(feld);
                const wert = entwurf[feld];
                // Auswahlfelder aus dem Katalog — KEIN Freitext, wo eine Liste existiert.
                const optionen =
                  feld === "mengenbasis"
                    ? (kataloge.MengenbasisKatalog || []).map((r) => r.key)
                    : feld === "einheit" || feld === "me"
                      ? (kataloge.EinheitenKatalog || []).map((r) => r.code)
                      : feld === "kg2018" || feld === "kg2008" || feld === "kg"
                        ? [...new Set((kataloge.Din276Katalog || []).map((r) => String(r.code)))]
                        : null;
                return (
                  <div key={feld} className="space-y-1">
                    <Label className="text-xs text-slate-500">{feld}</Label>
                    {optionen ? (
                      <Select value={wert ?? ""} onValueChange={(v) => setFeld(feld, v)}>
                        <SelectTrigger className={`h-8 text-xs ${fe ? "border-red-400" : ""}`}>
                          <SelectValue placeholder="wählen" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {optionen.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : typeof wert === "boolean" ? (
                      <Select value={wert ? "ja" : "nein"} onValueChange={(v) => setFeld(feld, v === "ja")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ja">ja</SelectItem>
                          <SelectItem value="nein">nein</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className={`h-8 text-xs ${fe ? "border-red-400" : ""}`}
                        value={wert ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const numerisch = ["faktor", "prio", "rang", "nr", "ep", "gruen_bis", "gelb_bis",
                            "min_similarity", "review_von", "ratio_min", "ratio_max"].includes(feld);
                          setFeld(feld, raw === "" ? null : numerisch ? Number(raw) : raw);
                        }}
                      />
                    )}
                    {fe && (
                      <p className="text-[11px] text-red-600 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {fe.text}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {fehler.some((f) => !felder.includes(f.feld)) && (
              <ul className="space-y-0.5 text-[11px] text-red-600">
                {fehler.filter((f) => !felder.includes(f.feld)).map((f, i) => (
                  <li key={i}>{f.feld}: {f.text}</li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={speichern} disabled={busy}>
                <Save className="w-3 h-3 mr-1" /> Speichern
              </Button>
              {projektId && (
                <label className="flex items-center gap-1 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={!!entwurf.projekt_override_id}
                    onChange={(e) =>
                      setEntwurf((d) => ({
                        ...d,
                        projekt_override_id: e.target.checked ? projektId : null,
                        scope: e.target.checked ? "projekt" : "buero",
                      }))
                    }
                  />
                  nur in diesem Projekt (Override)
                </label>
              )}
            </div>
          </div>
        )}

        {/* --- Liste ------------------------------------------------------- */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="px-2 py-1">Geltung</th>
                {felder.map((f) => <th key={f} className="px-2 py-1">{f}</th>)}
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {zeilen.length === 0 && (
                <tr>
                  <td colSpan={felder.length + 2} className="px-2 py-3 text-slate-400">
                    Dieser Katalog ist leer. Das ist kein Fehler — z. B. der
                    Referenzpreis-Pool startet bewusst leer (ein erfundener Referenzpreis wäre
                    schlimmer als keiner).
                  </td>
                </tr>
              )}
              {zeilen.map((z, i) => (
                <tr key={z.id ?? i} className="border-b border-slate-100">
                  <td className="px-2 py-1">
                    {z.projekt_override_id ? (
                      <Badge className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300">
                        nur dieses Projekt
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-500">
                        <Building2 className="w-2.5 h-2.5 mr-0.5" /> büroweit
                      </Badge>
                    )}
                  </td>
                  {felder.map((f) => (
                    <td key={f} className="px-2 py-1 max-w-xs truncate" title={zellwert(z[f])}>
                      {zellwert(z[f])}
                    </td>
                  ))}
                  <td className="px-2 py-1 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-emerald-700 hover:underline"
                      onClick={() => beginnen(z)}
                    >
                      ändern
                    </button>
                    {onDelete && z.projekt_override_id && (
                      <button
                        type="button"
                        className="ml-2 text-slate-400 hover:text-red-600"
                        onClick={() => onDelete(entity, z)}
                      >
                        Override löschen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {alleZeilen.length !== zeilen.length && (
          <p className="text-[10px] text-slate-400">
            {alleZeilen.length - zeilen.length} Zeile(n) sind durch Projekt-Overrides verdeckt
            oder gehören zu anderen Projekten.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
