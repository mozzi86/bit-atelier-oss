import React, { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import {
  PackageOpen, Loader2, AlertTriangle, CheckCircle2, XCircle, ShieldAlert,
} from "lucide-react";
import { parseBundle, validateBundle, applyBundle, httpIo } from "@ava/lib/projectImport";

const nf = new Intl.NumberFormat("de-DE");

// Import eines vollständigen Projekt-Bundles (Phase 33 / W3).
//
// DER TROCKENLAUF IST DER SINN DIESER KOMPONENTE. Sie zeigt VOR dem ersten
// Schreibvorgang, was das Bundle enthält und was daran nicht stimmt — und schreibt erst
// nach ausdrücklicher Bestätigung. Ein Import, der mitten in ~1.550 Entitäten abbricht,
// hinterlässt sonst ein halbes Projekt, dem niemand mehr ansehen kann, was echt ist.
export default function ImportWizard({ onDone }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  const [dateiname, setDateiname] = useState("");
  const [bundle, setBundle] = useState(null);
  const [bericht, setBericht] = useState(null);
  const [fortschritt, setFortschritt] = useState("");
  const [ergebnis, setErgebnis] = useState(null);

  const zuruecksetzen = () => {
    setBundle(null); setBericht(null); setErgebnis(null); setFehler(""); setFortschritt("");
  };

  const dateiWaehlen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    zuruecksetzen();
    setDateiname(file.name);
    setBusy(true);
    try {
      const b = parseBundle(await file.text());
      setBundle(b);
      setBericht(validateBundle(b)); // TROCKENLAUF — noch kein Schreibvorgang
    } catch (err) {
      setFehler(err?.message || "Bundle konnte nicht gelesen werden.");
    } finally {
      setBusy(false);
    }
  };

  const schreiben = async () => {
    if (!bundle || !bericht?.ok) return;
    setBusy(true);
    setFehler("");
    try {
      const res = await applyBundle(
        bundle,
        httpIo("/api", { onProgress: (text) => setFortschritt(text) }),
        { bestaetigt: true },
      );
      setErgebnis(res);
      if (res.ok) onDone?.(res);
    } catch (err) {
      setFehler(err?.message || "Import fehlgeschlagen.");
    } finally {
      setBusy(false);
      setFortschritt("");
    }
  };

  const z = bericht?.zusammenfassung;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageOpen className="w-4 h-4" /> Projekt-Bundle importieren
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-500">
          Vollständiges Kostenberechnungsprojekt einlesen (Lose, LV-Positionen, Mengenregeln,
          Filter, Bauteilstand, Preisschichten, Verträge). Der Trockenlauf zeigt alle Befunde,
          <strong> bevor</strong> etwas geschrieben wird.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".json"
            disabled={busy}
            onChange={dateiWaehlen}
            className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
          />
          {bundle && !ergebnis && (
            <Button size="sm" variant="outline" onClick={zuruecksetzen} disabled={busy}>Verwerfen</Button>
          )}
        </div>

        {busy && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{fortschritt || "Lese Bundle…"}</span>
          </div>
        )}

        {fehler && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div><div className="font-medium">Fehlgeschlagen{dateiname ? ` — ${dateiname}` : ""}</div><div>{fehler}</div></div>
          </div>
        )}

        {/* --- Trockenlauf-Bericht ------------------------------------------- */}
        {bericht && !ergebnis && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {bericht.ok
                ? <><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Trockenlauf bestanden</>
                : <><ShieldAlert className="w-4 h-4 text-rose-600" /> Trockenlauf NICHT bestanden — es wird nichts geschrieben</>}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {[
                ["Projekt", z.projekt || "—"],
                ["Lose", nf.format(z.lose)],
                ["LV-Positionen", nf.format(z.positionen)],
                ["Mengenregeln", nf.format(z.regeln)],
                ["Filter", nf.format(z.filter)],
                ["Bauteile (Blob)", nf.format(z.elemente)],
                ["Preisschichten", nf.format(z.preisschichten)],
                ["Verträge", nf.format(z.vertraege)],
                ["Vertragspositionen", nf.format(z.vertragspositionen)],
                ["Modell-Lücken", nf.format(z.luecken)],
                ["Kataloge", nf.format(z.kataloge)],
                ["Schreibvorgänge", nf.format(z.schreibvorgaenge_geschaetzt)],
              ].map(([label, wert]) => (
                <div key={label} className="flex justify-between gap-2 border-b border-slate-100 py-0.5">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium text-slate-800">{wert}</span>
                </div>
              ))}
            </div>

            <div className="text-sm">
              <span className="text-slate-500">Mengen-Modi: </span>
              {Object.entries(z.modi).map(([m, n]) => (
                <span key={m} className="mr-2 font-medium text-slate-800">{m} {nf.format(n)}</span>
              ))}
            </div>

            {bericht.fehler.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
                <div className="font-medium">{bericht.fehler.length} Fehler — Import blockiert</div>
                <ul className="ml-4 list-disc">
                  {bericht.fehler.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}

            {bericht.warnungen.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
                <div className="flex items-center gap-1 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" /> {bericht.warnungen.length} Hinweise (blockieren nicht)
                </div>
                <ul className="ml-4 list-disc">
                  {bericht.warnungen.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!bericht.ok || busy}
              onClick={schreiben}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              {bericht.ok
                ? `Jetzt importieren (${nf.format(z.positionen)} Positionen)`
                : "Import blockiert — Fehler oben beheben"}
            </Button>
          </div>
        )}

        {/* --- Ergebnis ------------------------------------------------------ */}
        {ergebnis && (
          <div className={`space-y-2 rounded-lg border p-3 text-sm ${ergebnis.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
            <div className="flex items-center gap-2 font-medium">
              {ergebnis.ok
                ? <><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Import abgeschlossen</>
                : <><XCircle className="w-4 h-4 text-rose-600" /> Import abgebrochen</>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(ergebnis.geschrieben).map(([entity, n]) => (
                <span key={entity}>{entity}: <strong>{nf.format(n)}</strong></span>
              ))}
            </div>
            {ergebnis.fehler.length > 0 && (
              <ul className="ml-4 list-disc text-rose-700">
                {ergebnis.fehler.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
            {!ergebnis.ok && Object.keys(ergebnis.geschrieben).length > 0 && (
              <p className="text-rose-700">
                Es wurde ein <strong>Teilzustand</strong> geschrieben (Liste oben). Bitte diese
                Sätze entfernen, bevor der Import erneut läuft.
              </p>
            )}
            <Button size="sm" variant="outline" onClick={zuruecksetzen}>Weiteres Bundle</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
