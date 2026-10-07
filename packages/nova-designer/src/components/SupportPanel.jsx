import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Textarea } from "@core/components/ui/textarea";
import { Label } from "@core/components/ui/label";
import { toast } from "sonner";
import { useProject } from "@core/lib/ProjectContext";
import { LifeBuoy, ChevronDown, BookOpen, Mail, Copy } from "lucide-react";
import { ANBIETER } from "@core/lib/anbieter";

// Echte Support-Adresse — es gibt keinen Server, der Anfragen annimmt, also
// geht die Anfrage über das E-Mail-Programm der Nutzer:in raus (KD-22).
// Provider address from the single source anbieter.js (phase 78 hotfix: the
// former hard-coded address belonged to a third party and shipped publicly).
const SUPPORT_MAIL = ANBIETER.email;

const FAQ = [
  { q: "Wie generiere ich automatisch ein Grundstück?", a: 'Im Tab „Site & Map" einen Standort wählen und „Standort übernehmen" klicken — Grundstück, Topografie und Umgebung werden erzeugt (Topografie und Nachbargebäude sind dabei synthetisch und als solche gekennzeichnet).' },
  { q: "Wie setze ich Baukörper?", a: 'Im Tab „Massing" in den Lageplan klicken. Jeder Klick platziert einen Baukörper, den du im Tab „Buildings" konfigurierst.' },
  { q: "Woher kommen die Kostenkennwerte?", a: "Der Kostenrechner nutzt editierbare €/m²- und €/kW-Sätze nach DIN 276 und rechnet live aus BGF und Energiesystemen." },
  { q: "Brauche ich einen KI-Schlüssel?", a: "Nein. Ohne Schlüssel laufen die KI-Module im Offline-Modus. Mit ANTHROPIC_API_KEY/OPENAI_API_KEY gibt es echte Antworten." },
];

export default function SupportPanel() {
  const { project } = useProject();
  const [open, setOpen] = useState(0);
  const [msg, setMsg] = useState("");

  const betreff = `BIT-Atelier-Support${project?.name ? `: ${project.name}` : ""}`;
  const body = [
    msg.trim(),
    "",
    "—",
    `Projekt: ${project?.name || "kein Projekt gewählt"}`,
    `Modul: Komplex-Designer · gesendet am ${new Date().toLocaleString("de-DE")}`,
  ].join("\n");
  const mailto = `mailto:${SUPPORT_MAIL}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`;

  // Kein „gesendet" — die Anwendung öffnet nur einen Entwurf; ob ein
  // E-Mail-Programm hochkommt, weiß sie nicht. Der Toast behauptet daher
  // keinen Versand.
  const entwurfOeffnen = () => {
    toast(`E-Mail-Entwurf an ${SUPPORT_MAIL} wird geöffnet — dort noch abschicken`);
  };

  const adresseKopieren = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_MAIL);
      toast.success("Support-Adresse kopiert");
    } catch {
      toast.error(`Kopieren nicht möglich — Adresse: ${SUPPORT_MAIL}`);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="w-4 h-4" /> Häufige Fragen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {FAQ.map((f, i) => (
            <div key={i} className="border rounded-lg">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium"
                onClick={() => setOpen(open === i ? -1 : i)}
              >
                {f.q}
                <ChevronDown className={`w-4 h-4 transition-transform ${open === i ? "rotate-180" : ""}`} />
              </button>
              {open === i && <p className="px-4 pb-3 text-sm text-slate-600">{f.a}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="w-4 h-4" /> Support kontaktieren
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sm">Deine Frage</Label>
            <Textarea id="sm" rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Beschreibe dein Anliegen..." />
          </div>
          <div className="flex flex-wrap gap-2">
            {msg.trim() ? (
              <Button asChild onClick={entwurfOeffnen}>
                <a href={mailto}>
                  <Mail className="w-4 h-4 mr-2" /> E-Mail-Entwurf öffnen
                </a>
              </Button>
            ) : (
              <Button disabled>
                <Mail className="w-4 h-4 mr-2" /> E-Mail-Entwurf öffnen
              </Button>
            )}
            <Button variant="outline" onClick={adresseKopieren}>
              <Copy className="w-4 h-4 mr-2" /> Adresse kopieren
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            BIT-Atelier läuft lokal und hat kein Support-Postfach: Der Text wird
            als Entwurf im E-Mail-Programm an{" "}
            <a href={`mailto:${SUPPORT_MAIL}`} className="underline">{SUPPORT_MAIL}</a>{" "}
            geöffnet — abgeschickt wird dort. Projektname und Zeitpunkt hängt die
            Anwendung an.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
