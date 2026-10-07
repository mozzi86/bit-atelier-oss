// ReportDocument — print-ready report (preview and PDF) of the Berichte page.
// 72-15 (N-15): the cost section and the final report's conclusion come from
// kostenUebersicht (change orders, contract sum incl. change orders); plans only
// with a real building (no phantom); no built-in letterhead subtitle; energy
// target and climate zone through the label maps of @core/lib/labels.
import React from "react";
import { Building2 } from "lucide-react";
import { gp, eur0 } from "@ava/components/avaUtils";
import { statusInfo, hoaiProgress, hoaiPhaseShort, fmtDate, fmtCity, projectArea } from "@core/lib/projectModel";
import { labelFor, ENERGY_TARGET_LABELS, CLIMATE_ZONE_LABELS, normalisiereKlimazone } from "@core/lib/labels";
import { useI18n } from "@core/lib/i18n";
import { FloorPlan, Elevation, Section } from "./Drawings";
import { kostenUebersicht, prozentText } from "./berichtKosten";

const REPORT_TITLES = {
  steckbrief: "Projektsteckbrief",
  detail: "Detaillierter Projektbericht",
  status: "Zwischenbericht / Statusbericht",
  final: "Abschlussbericht",
  bautagebuch: "Bautagebuch",
  protokoll: "Besprechungsprotokoll",
};

const Row = ({ k, v }) => (
  <div className="flex justify-between py-1.5 border-b border-slate-100 text-[13px]">
    <span className="text-slate-500">{k}</span>
    <span className="font-medium text-slate-800 text-right">{v ?? "—"}</span>
  </div>
);

const Section_ = ({ title, children }) => (
  <div className="mt-6">
    <h2 className="text-[15px] font-bold text-slate-800 border-b-2 border-emerald-500 pb-1 mb-3">{title}</h2>
    {children}
  </div>
);

// Renders a print-ready report. `data` is gathered by the Reports page.
export default function ReportDocument({ docRef, project, data, type, options = {} }) {
  const { t } = useI18n();
  if (!project) return null;
  const st = statusInfo(project.status);
  // data.orders: change orders of this project, scoped by the page (nachtraegeDesProjekts).
  const kosten = kostenUebersicht({ lv: data.lv, tenders: data.tenders, bids: data.bids, orders: data.orders });
  const estimate = kosten.anschlag;
  const awardSum = kosten.vergabe;
  // Award minus the estimate of the awarded positions in euros; negative = below.
  const deltaVergabe = awardSum - kosten.anschlagVergeben;
  const openIssues = (data.issues || []).filter((i) => i.status !== "resolved" && i.status !== "closed");
  const now = new Date();
  const overdue = (data.tasks || []).filter((t) => t.end_date && new Date(t.end_date) < now && (t.progress || 0) < 100);
  const avgTaskProgress = data.tasks?.length ? Math.round(data.tasks.reduce((s, t) => s + (t.progress || 0), 0) / data.tasks.length) : 0;

  // Eigenständige Vorlagen ohne Standard-Sektionen
  const isCustomType = type === "bautagebuch" || type === "protokoll";
  const showCosts = type !== "steckbrief" && !isCustomType;
  const showSchedule = type === "detail" || type === "status";
  const showIssues = type !== "steckbrief" && !isCustomType;
  // Without a building record there is nothing to draw — the drawings would fall
  // back to modelDims' default block and show a building that does not exist.
  const showDrawings = options.includeDrawings && (type === "detail" || type === "steckbrief") && !!data.building;
  const showEnergy = type === "detail" || type === "steckbrief";

  // Letterhead (configurable). No built-in subtitle: an empty subtitle stays empty.
  const bk = options.briefkopf || {};
  const office = bk.office || "Architekturbüro";
  const tagline = bk.tagline || "";

  // Daten für Bautagebuch
  const companies = [...new Set((data.tasks || []).map((t) => t.company_name).filter(Boolean))];
  const activeTasks = (data.tasks || []).filter((t) => (t.progress || 0) > 0 && (t.progress || 0) < 100);
  const incidents = openIssues.filter((i) => i.priority === "high" || i.priority === "critical");
  const participantList = (options.participants || "").split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <div ref={docRef} className="bg-white mx-auto shadow-sm" style={{ width: 794, padding: 48, color: "#0f172a" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-slate-800 leading-tight max-w-[360px]">{office}</div>
            {tagline && <div className="text-[10px] text-slate-400">{tagline}</div>}
            {(bk.address || bk.contact) && (
              <div className="text-[10px] text-slate-500">
                {[bk.address, bk.contact].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div className="font-semibold text-slate-700 text-[13px]">{REPORT_TITLES[type]}</div>
          <div>Erstellt: {fmtDate(options.date || new Date().toISOString())}</div>
          {type === "status" && options.period && <div>Berichtszeitraum: {options.period}</div>}
        </div>
      </div>

      {/* Title block */}
      <div className="mt-6">
        <div className="flex items-center gap-2">
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: st.ring + "22", color: st.ring }}>{st.label}</span>
          <span className="text-[11px] text-slate-400">{hoaiPhaseShort(project)} · {hoaiProgress(project)}% Planung</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{project.name}</h1>
        <p className="text-slate-500">{project.client} · {fmtCity(project)}</p>
      </div>

      {/* Key data */}
      <Section_ title="Projektdaten">
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            <Row k="Auftraggeber" v={project.client} />
            <Row k="Standort" v={fmtCity(project)} />
            <Row k="Status" v={st.label} />
            <Row k="HOAI-Phase" v={project.hoai_phase} />
          </div>
          <div>
            <Row k="BGF / Fläche" v={`${Math.round(projectArea(project)).toLocaleString("de-DE")} m²`} />
            <Row k="Energieziel" v={labelFor(ENERGY_TARGET_LABELS, project.energy_target)} />
            <Row k={t("Klimazone")} v={labelFor(CLIMATE_ZONE_LABELS, normalisiereKlimazone(project.climate_zone))} />
            <Row k="Nachhaltigkeit" v={project.sustainability_rating} />
            <Row k="Fertigstellung" v={fmtDate(project.completion_date)} />
          </div>
        </div>
      </Section_>

      {/* KPI cards */}
      {!isCustomType && <div className="grid grid-cols-4 gap-3 mt-5">
        {[
          ["Planungsfortschritt", `${hoaiProgress(project)} %`],
          ["Kostenanschlag", eur0(estimate)],
          ["Offene Punkte", openIssues.length],
          ["Vorgänge fällig/überf.", overdue.length],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 p-3 text-center">
            <div className="text-lg font-bold text-slate-800">{v}</div>
            <div className="text-[10px] text-slate-500">{k}</div>
          </div>
        ))}
      </div>}

      {type === "bautagebuch" && (
        <>
          <Section_ title="Wetter">
            <div className="grid grid-cols-2 gap-x-8">
              <div>
                <Row k="Bedingungen" v={options.weather?.condition ?? "—"} />
                <Row k="Temperatur" v={options.weather?.temperature != null ? `${options.weather.temperature} °C` : "—"} />
              </div>
              <div>
                <Row k="Wind" v={options.weather?.wind_speed != null ? `${options.weather.wind_speed} km/h` : "—"} />
                <Row k="Niederschlag" v={options.weather?.precipitation != null ? `${options.weather.precipitation} mm` : "—"} />
              </div>
            </div>
          </Section_>

          <Section_ title="Anwesende Firmen">
            {companies.length === 0 ? <p className="text-[12px] text-slate-400">Keine Firmen erfasst.</p> : (
              <ul className="text-[13px] text-slate-700 list-disc pl-5 space-y-0.5">
                {companies.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
          </Section_>

          <Section_ title="Ausgeführte Leistungen">
            {activeTasks.length === 0 ? <p className="text-[12px] text-slate-400">Keine laufenden Leistungen.</p> : (
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-slate-400 border-b"><th className="py-1">Leistung</th><th className="text-right">Fortschritt</th></tr></thead>
                <tbody>
                  {activeTasks.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100">
                      <td className="py-1">{t.name}</td>
                      <td className="text-right">{t.progress} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section_>

          <Section_ title="Besondere Vorkommnisse">
            {incidents.length === 0 ? <p className="text-[12px] text-slate-400">Keine.</p> : (
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-slate-400 border-b"><th className="py-1">Priorität</th><th>Thema</th><th>Zuständig</th></tr></thead>
                <tbody>
                  {incidents.map((i) => (
                    <tr key={i.id} className="border-b border-slate-100">
                      <td className="py-1 capitalize">{i.priority}</td>
                      <td>{i.title}</td>
                      <td className="text-slate-500">{i.assignee}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section_>
        </>
      )}

      {type === "protokoll" && (
        <>
          <Section_ title="Teilnehmer">
            {participantList.length === 0 ? <p className="text-[12px] text-slate-400">Keine Teilnehmer angegeben.</p> : (
              <ul className="text-[13px] text-slate-700 list-disc pl-5 space-y-0.5">
                {participantList.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </Section_>

          <Section_ title="Anlass/Ort">
            <p className="text-[13px] text-slate-700">{options.occasion || "—"}</p>
          </Section_>

          <Section_ title={`Themen (TOPs) — ${openIssues.length}`}>
            {openIssues.length === 0 ? <p className="text-[12px] text-slate-400">Keine offenen Themen.</p> : (
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-slate-400 border-b"><th className="py-1">Nr.</th><th>Thema</th><th>Zuständig</th><th>Priorität</th></tr></thead>
                <tbody>
                  {openIssues.map((i, idx) => (
                    <tr key={i.id} className="border-b border-slate-100">
                      <td className="py-1 font-mono text-[10px] text-slate-400">{idx + 1}</td>
                      <td>{i.title}</td>
                      <td className="text-slate-500">{i.assignee}</td>
                      <td className="capitalize">{i.priority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section_>

          <Section_ title="Festlegungen">
            <p className="text-[13px] text-slate-700 mb-4">Nächster Termin: ___________________________</p>
            <div className="space-y-7">
              <div className="border-b border-slate-300" />
              <div className="border-b border-slate-300" />
              <div className="border-b border-slate-300" />
            </div>
          </Section_>
        </>
      )}

      {showCosts && (
        <Section_ title="Kosten (AVA)">
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div className="rounded bg-slate-50 p-2 text-center"><div className="font-bold text-slate-800">{eur0(estimate)}</div><div className="text-[10px] text-slate-500">Kostenanschlag (LV)</div></div>
            <div className="rounded bg-slate-50 p-2 text-center"><div className="font-bold text-blue-700">{eur0(awardSum)}</div><div className="text-[10px] text-slate-500">Vergabesumme</div></div>
            <div className="rounded bg-slate-50 p-2 text-center"><div className={`font-bold ${deltaVergabe > 0 ? "text-amber-700" : "text-emerald-700"}`}>{awardSum > 0 ? eur0(deltaVergabe) : "—"}</div><div className="text-[10px] text-slate-500">{t("Δ Vergabe ggü. Anschlag der vergebenen Positionen")}</div></div>
            <div className="rounded bg-slate-50 p-2 text-center" data-kennzahl="nachtraege-genehmigt"><div className="font-bold text-slate-800">{eur0(kosten.nachtraegeGenehmigt.summe)}</div><div className="text-[10px] text-slate-500">{t("Nachträge genehmigt ({n})").replace("{n}", String(kosten.nachtraegeGenehmigt.anzahl))}</div></div>
            <div className="rounded bg-slate-50 p-2 text-center" data-kennzahl="nachtraege-offen"><div className="font-bold text-amber-700">{eur0(kosten.nachtraegeOffen.summe)}</div><div className="text-[10px] text-slate-500">{t("Nachträge offen ({n})").replace("{n}", String(kosten.nachtraegeOffen.anzahl))}</div></div>
            <div className="rounded bg-slate-50 p-2 text-center" data-kennzahl="auftragssumme"><div className="font-bold text-blue-800">{kosten.auftragssummeInklNachtraege != null ? eur0(kosten.auftragssummeInklNachtraege) : "—"}</div><div className="text-[10px] text-slate-500">{t("Auftragssumme inkl. Nachträge")}</div></div>
          </div>
          <p className="text-[10px] text-slate-400 mb-3">
            {t("Auftragssumme = Vergabesumme + genehmigte Nachträge; offene Nachträge sind nicht enthalten.")}
          </p>
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-slate-400 border-b"><th className="py-1">OZ</th><th>Position</th><th className="text-right">Menge</th><th className="text-right">EP</th><th className="text-right">GP</th></tr></thead>
            <tbody>
              {(data.lv || []).slice(0, type === "detail" ? 99 : 6).map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-1 font-mono text-[10px] text-slate-400">{p.oz}</td>
                  <td>{p.title}</td>
                  <td className="text-right">{(p.quantity || 0).toLocaleString("de-DE")} {p.unit}</td>
                  <td className="text-right">{eur0(p.unit_price)}</td>
                  <td className="text-right font-medium">{eur0(gp(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section_>
      )}

      {showEnergy && data.energy && (
        <Section_ title="Energie & GEG">
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Row k="Primärenergie p.a." v={`${Math.round((data.energy.results?.pe_annual || 0) / 1000).toLocaleString("de-DE")} MWh`} />
              <Row k="CO₂ p.a." v={`${Math.round((data.energy.results?.co2_annual || 0) / 1000).toLocaleString("de-DE")} t`} />
            </div>
            <div>
              <Row k="GEG-Nachweis" v={data.energy.geg_compliance?.passes_geg ? "bestanden ✓" : "nicht bestanden ✗"} />
              <Row k="Kompaktheits-/Compliance-Faktor" v={data.energy.geg_compliance?.compliance_factor} />
            </div>
          </div>
        </Section_>
      )}

      {showSchedule && (
        <Section_ title="Termine & Bauablauf">
          <Row k="Ø Vorgangsfortschritt" v={`${avgTaskProgress} %`} />
          <table className="w-full text-[12px] mt-2">
            <thead><tr className="text-left text-slate-400 border-b"><th className="py-1">Vorgang</th><th>Firma</th><th>Ende</th><th className="text-right">Fortschritt</th></tr></thead>
            <tbody>
              {(data.tasks || []).slice(0, 8).map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-1">{t.name}</td>
                  <td className="text-slate-500">{t.company_name}</td>
                  <td className="text-slate-500">{fmtDate(t.end_date)}</td>
                  <td className="text-right">{t.progress || 0} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section_>
      )}

      {showIssues && (
        <Section_ title={`Offene Punkte / BIM-Themen (${openIssues.length})`}>
          {openIssues.length === 0 ? <p className="text-[12px] text-slate-400">Keine offenen Punkte.</p> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-slate-400 border-b"><th className="py-1">Priorität</th><th>Thema</th><th>Zuständig</th></tr></thead>
              <tbody>
                {openIssues.slice(0, type === "detail" ? 99 : 6).map((i) => (
                  <tr key={i.id} className="border-b border-slate-100">
                    <td className="py-1 capitalize">{i.priority}</td>
                    <td>{i.title}</td>
                    <td className="text-slate-500">{i.assignee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section_>
      )}

      {type === "final" && (
        <Section_ title="Abschluss & Fazit">
          <p className="text-[13px] text-slate-600">
            Das Projekt {project.name} befindet sich im Status „{st.label}". Der Kostenanschlag belief sich auf {eur0(estimate)};
            die Vergabesumme betrug {eur0(awardSum)}{kosten.abweichungProzent != null
              ? ` (${t("{prozent} % ggü. Anschlag der vergebenen Positionen").replace("{prozent}", prozentText(kosten.abweichungProzent))})`
              : ""}.
            {" "}{t("Genehmigte Nachträge ({n}): {summe}.")
              .replace("{n}", String(kosten.nachtraegeGenehmigt.anzahl))
              .replace("{summe}", eur0(kosten.nachtraegeGenehmigt.summe))}
            {kosten.auftragssummeInklNachtraege != null && <>{" "}{t("Die Auftragssumme inkl. Nachträge beträgt {summe}.")
              .replace("{summe}", eur0(kosten.auftragssummeInklNachtraege))}</>}
            {kosten.nachtraegeOffen.anzahl > 0 && <>{" "}{t("Noch nicht entschiedene Nachträge ({n}): {summe}.")
              .replace("{n}", String(kosten.nachtraegeOffen.anzahl))
              .replace("{summe}", eur0(kosten.nachtraegeOffen.summe))}</>}
            {" "}Offene Punkte zum Berichtszeitpunkt: {openIssues.length}.
          </p>
        </Section_>
      )}

      {showDrawings && (
        <Section_ title="Pläne (schematisch)">
          <div className="space-y-4">
            <div className="border rounded p-2"><FloorPlan building={data.building} project={project} /></div>
            <div className="border rounded p-2"><Elevation building={data.building} project={project} /></div>
            <div className="border rounded p-2"><Section building={data.building} project={project} /></div>
          </div>
        </Section_>
      )}

      {/* Footer */}
      <div className="mt-8 pt-3 border-t border-slate-200 flex justify-between text-[10px] text-slate-400">
        <span>{office} · {REPORT_TITLES[type]}</span>
        <span>{project.name} · {fmtDate(options.date || new Date().toISOString())}</span>
      </div>
    </div>
  );
}
