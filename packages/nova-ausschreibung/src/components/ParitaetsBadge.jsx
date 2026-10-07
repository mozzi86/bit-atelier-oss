import React, { useMemo, useState } from "react";
import { Badge } from "@core/components/ui/badge";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";

// ParitaetsBadge — der letzte `ParitaetsLauf` je Welle, sichtbar im Reiter.
//
// EINE Regel, die alles bestimmt: **ohne Lauf steht hier NICHT grün, sondern
// „nicht geprüft".**
//
// Ein grünes Abzeichen ohne Lauf wäre die billigste und teuerste Lüge des ganzen
// Programms: es behauptet eine Prüfung, die niemand gemacht hat. Genauso werden
// `skipped`-Gates NICHT als grün gezählt — ein übersprungener Test ist ein
// fehlender Nachweis, kein bestandener (z. B. der LibreOffice-Roundtrip aus W5,
// der auf diesem Rechner nur mangels Installation übersprungen wird).
//
// Erwartete Form eines `ParitaetsLauf`:
//   { welle, zeitpunkt, gates_gesamt, gates_gruen, gates_rot, gates_skipped,
//     absturzliste: [{gate, grund}], kommando }
export default function ParitaetsBadge({ laeufe = [], welle = null }) {
  const [offen, setOffen] = useState(false);

  const lauf = useMemo(() => {
    const kandidaten = (laeufe || [])
      .filter((l) => (welle ? l.welle === welle : true))
      .slice()
      .sort((a, b) => String(b.zeitpunkt || "").localeCompare(String(a.zeitpunkt || "")));
    return kandidaten[0] || null;
  }, [laeufe, welle]);

  // KEIN Lauf ⇒ „nicht geprüft". Grau, nicht grün.
  if (!lauf) {
    return (
      <Badge
        variant="outline"
        className="text-xs border-slate-300 text-slate-500"
        title="Es liegt kein ParitaetsLauf vor. Das ist kein Fehler — aber auch kein Nachweis. `npm run parity` ausführen und das Ergebnis erfassen."
      >
        <HelpCircle className="w-3 h-3 mr-1" /> Parität: nicht geprüft
      </Badge>
    );
  }

  const gesamt = Number(lauf.gates_gesamt ?? 0);
  const gruen = Number(lauf.gates_gruen ?? 0);
  const rot = Number(lauf.gates_rot ?? 0);
  const skipped = Number(lauf.gates_skipped ?? 0);
  const vollstaendig = rot === 0 && skipped === 0 && gesamt > 0 && gruen === gesamt;

  const stil = rot > 0
    ? "bg-red-100 text-red-700 border-red-300"
    : skipped > 0
      ? "bg-amber-100 text-amber-800 border-amber-300"
      : "bg-emerald-100 text-emerald-800 border-emerald-300";

  const Ikone = rot > 0 ? XCircle : skipped > 0 ? AlertTriangle : CheckCircle2;

  return (
    <div className="inline-block">
      <button type="button" onClick={() => setOffen((o) => !o)} className="align-middle">
        <Badge
          className={`text-xs border ${stil}`}
          title={
            vollstaendig
              ? "Alle Gates grün — kein übersprungener Nachweis."
              : skipped > 0
                ? "Übersprungene Gates werden NICHT als grün gezählt — ein Skip ist ein fehlender Nachweis."
                : "Rote Gates: die Welle ist nicht fertig."
          }
        >
          <Ikone className="w-3 h-3 mr-1" />
          Parität: {gruen}/{gesamt} Gates grün
          {skipped > 0 && ` · ${skipped} übersprungen`}
          {rot > 0 && ` · ${rot} rot`}
        </Badge>
      </button>

      {offen && (
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-700 space-y-1">
          <div>
            <strong>Lauf:</strong>{" "}
            {String(lauf.zeitpunkt || "").slice(0, 16).replace("T", " ") || "ohne Zeitstempel"}
            {lauf.welle ? ` · Welle ${lauf.welle}` : ""}
          </div>
          {lauf.kommando && (
            <div className="text-slate-500">
              Kommando: <code>{lauf.kommando}</code>
            </div>
          )}
          <div>
            {gesamt} Gates · {gruen} grün · {rot} rot · {skipped} übersprungen
          </div>
          {skipped > 0 && (
            <p className="text-amber-700">
              Ein übersprungenes Gate ist ein <strong>fehlender Nachweis</strong>, kein
              bestandener. Es wird deshalb getrennt ausgewiesen und nicht in „grün" gezählt.
            </p>
          )}
          {(lauf.absturzliste || []).length > 0 && (
            <>
              <div className="font-semibold text-red-700">Absturzliste</div>
              <ul className="ml-4 list-disc space-y-0.5">
                {lauf.absturzliste.map((a, i) => (
                  <li key={i}>
                    <code>{a.gate}</code>
                    {a.grund ? ` — ${a.grund}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          {(lauf.absturzliste || []).length === 0 && rot === 0 && (
            <div className="text-slate-500">Keine Abstürze protokolliert.</div>
          )}
        </div>
      )}
    </div>
  );
}
