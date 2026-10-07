import React, { useEffect, useRef, useState } from "react";

// Global button help: hovering ANY button/link for 3 seconds shows a small
// info popup describing what it does. Uses event delegation so no button needs
// to be touched. Description priority: data-help → curated map → visible text.

const DELAY_MS = 3000;

// Curated descriptions (matched as lowercase substrings of the button label).
// Order matters — more specific entries first.
const MAP = [
  ["menge in position übernehmen", "Übernimmt die im 3D-Modell ermittelte Menge in die gewählte LV-Position."],
  ["plan als pdf", "Erzeugt aus der aktuellen Zeichnung ein PDF und lädt es herunter."],
  ["als pdf exportieren", "Erstellt aus der aktuellen Ansicht ein PDF und lädt es herunter."],
  ["csv / gaeb", "Exportiert das Leistungsverzeichnis als CSV-Datei (Excel/GAEB)."],
  ["export", "Exportiert die aktuellen Daten als Datei."],
  ["ki-langtext", "Erzeugt per KI eine ausschreibungsreife VOB-Leistungsbeschreibung."],
  ["varianten generieren", "Erzeugt per KI mehrere Entwurfsvarianten."],
  ["projekt analysieren", "Startet die ganzheitliche KI-Analyse des aktuellen Projekts."],
  ["standort übernehmen", "Übernimmt den gewählten Standort und generiert das Gelände."],
  ["plausibel ausfüllen", "Füllt die Angebotspreise mit plausiblen Schätzwerten vor."],
  ["angebot erfassen", "Erfasst ein neues Bieterangebot zur Ausschreibung."],
  ["angebot speichern", "Speichert das eingegebene Angebot."],
  ["ausschreibung", "Erstellt eine neue Ausschreibung aus den Positionen eines Gewerks."],
  ["preisspiegel", "Öffnet den Preisspiegel mit dem Angebotsvergleich dieser Ausschreibung."],
  ["veröffentlichen", "Veröffentlicht die Ausschreibung für die eingeladenen Bieter."],
  ["submission schließen", "Beendet die Angebotsfrist der Ausschreibung."],
  ["zuschlag", "Erteilt diesem Bieter den Zuschlag (Vergabe)."],
  ["aufmaß erfassen", "Erfasst ein Aufmaß für die Abrechnung."],
  ["roboter beauftragen", "Wandelt dieses BIM-Ticket in einen autonomen Roboterauftrag um."],
  ["not-aus", "Stoppt sofort alle autonomen Einheiten (Not-Aus)."],
  ["freigeben", "Gibt den Betrieb nach dem Not-Aus wieder frei."],
  ["neues projekt", "Legt ein neues Projekt an."],
  ["position", "Legt eine neue LV-Position an."],
  ["datei wählen", "Wählt eine Datei (z. B. PDF) zum Import aus."],
  ["datei", "Wählt eine Datei zum Import aus."],
  ["speichern", "Speichert die aktuellen Eingaben."],
  ["abbrechen", "Bricht den Vorgang ab, ohne zu speichern."],
  ["löschen", "Löscht diesen Eintrag dauerhaft."],
  ["bearbeiten", "Öffnet diesen Eintrag zum Bearbeiten."],
  ["details", "Zeigt die Details zu diesem Eintrag."],
  ["öffnen", "Öffnet dieses Element."],
  ["sidebar ausklappen", "Klappt die Seitenleiste wieder aus."],
  ["sidebar einklappen", "Klappt die Seitenleiste zur schmalen Icon-Leiste ein."],
  ["ticket im modell setzen", "Setzt ein BIM-Ticket an die angeklickte Stelle im 3D-Modell."],
  ["bim viewer", "Öffnet den BIM-Viewer mit dem 3D-Modell."],
];

function describe(el) {
  if (el.dataset.help) return el.dataset.help;
  const stashed = el.dataset._helpTitle || "";
  const aria = el.getAttribute("aria-label") || "";
  const text = (el.textContent || "").trim().replace(/\s+/g, " ");
  const key = (text || aria || stashed).toLowerCase();
  if (key) {
    for (const [k, v] of MAP) if (key.includes(k)) return v;
  }
  const isLink = el.tagName === "A";
  if (text) return isLink ? `Öffnet „${text}".` : `Aktion: „${text}".`;
  if (aria) return aria;
  if (stashed) return stashed;
  return "Schaltfläche";
}

export default function ButtonHelp() {
  const [tip, setTip] = useState(null); // { text, x, y, below }
  const timer = useRef(null);
  const current = useRef(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
    const restore = (el) => {
      if (el && el.dataset._helpTitle != null) {
        el.setAttribute("title", el.dataset._helpTitle);
        delete el.dataset._helpTitle;
      }
    };
    const hide = () => {
      clear();
      if (current.current) restore(current.current);
      current.current = null;
      setTip(null);
    };

    const target = (node) =>
      node && node.closest ? node.closest('button, [role="button"], a[href]') : null;

    const onOver = (e) => {
      const el = target(e.target);
      if (!el || el === current.current) return;
      // moved to a new control
      clear();
      if (current.current) restore(current.current);
      current.current = el;
      // suppress the native title tooltip so only ours shows
      const t = el.getAttribute("title");
      if (t) { el.dataset._helpTitle = t; el.removeAttribute("title"); }
      timer.current = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.top < 70;
        setTip({
          text: describe(el),
          x: Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120),
          y: below ? r.bottom + 8 : r.top - 8,
          below,
        });
      }, DELAY_MS);
    };

    const onOut = (e) => {
      const el = current.current;
      if (!el) return;
      if (e.relatedTarget && el.contains(e.relatedTarget)) return; // still inside
      hide();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousedown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);

    return () => {
      clear();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousedown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className="fixed z-[100] pointer-events-none max-w-xs rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-xl"
      style={{
        left: tip.x,
        top: tip.y,
        transform: tip.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
      role="tooltip"
    >
      {tip.text}
      <span
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent"
        style={
          tip.below
            ? { top: -4, borderBottom: "4px solid #0f172a" }
            : { bottom: -4, borderTop: "4px solid #0f172a" }
        }
      />
    </div>
  );
}
