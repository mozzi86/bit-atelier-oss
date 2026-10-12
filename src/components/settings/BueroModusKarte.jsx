// Card "Büro-Modus (Mehrplatz)" in Settings › System & Info (plan 93-03, lever 158) — local express build only.
//
// On the host (this computer, loopback):
//   off → what it does, the risk (no encryption in the LAN), a confirmation box, "Büro-Modus einschalten"
//   on  → the LAN address(es) as plain URLs for the tablet, "Gerät koppeln" (name → 6-digit code, 10 minutes),
//         the paired devices with "Widerrufen", "Büro-Modus ausschalten"
// On a paired device: which device this is, until when, and "Dieses Gerät abmelden".
//
// No QR code: a QR encoder would be a new dependency or an unchecked own implementation (93-03-PLAN).
//
// In:  useBuero() (BueroTor), /api/buero/* through @/lib/bueroModus.js. Out: the card or null;
//      data-testids buero-karte, buero-zustand, buero-verstanden, buero-einschalten, buero-ausschalten,
//      buero-urls, buero-geraetename, buero-code-erzeugen, buero-code-anzeige, buero-geraete, buero-widerrufen,
//      buero-fehler, buero-abmelden.
import React from "react";
import { Network, ShieldAlert } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useBuero } from "@/components/buero/BueroTor.jsx";
import { abmelden, bueroGeaendert, codeErzeugen, ladeStatus, setzeAktiv, widerrufen, zeitpunkt } from "@/lib/bueroModus.js";

const KNOPF = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 disabled:opacity-50";
const KNOPF_HAUPT = `${KNOPF} bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500`;
const KNOPF_RAND = `${KNOPF} border border-slate-300 text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 focus-visible:ring-slate-400`;

/**
 * The card as seen from a paired device.
 * @param {{name: string, laeuftAb: string}} props
 * @returns {React.ReactElement}
 */
function DiesesGeraet({ name, laeuftAb }) {
  const { t, lang } = useI18n();
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const raus = async () => {
    if (!window.confirm(t("Dieses Gerät abmelden? Für einen neuen Zugang braucht es einen neuen Koppel-Code vom Büro-Rechner."))) return;
    try { await abmelden(); window.location.reload(); } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <>
      <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="buero-zustand">
        {t("Dieses Gerät ist gekoppelt als „{name}“, gültig bis {datum}.").replace("{name}", name).replace("{datum}", zeitpunkt(laeuftAb, lang))}
      </p>
      <button type="button" className={KNOPF_RAND} onClick={raus} data-testid="buero-abmelden">{t("Dieses Gerät abmelden")}</button>
      {fehler && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="buero-fehler">{fehler}</p>}
    </>
  );
}

/**
 * The card on the host.
 * @returns {React.ReactElement}
 */
function AmHost() {
  const { t, lang } = useI18n();
  const [status, setStatus] = React.useState(/** @type {import('@/lib/bueroModus.js').BueroStatus|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [verstanden, setVerstanden] = React.useState(false);
  const [laeuft, setLaeuft] = React.useState(false);
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState(/** @type {{code: string, name: string, laeuftAb: string}|null} */ (null));

  const laden = React.useCallback(() => {
    ladeStatus().then(setStatus).catch((e) => setFehler(e instanceof Error ? e.message : String(e)));
  }, []);
  React.useEffect(() => { laden(); }, [laden]);

  /** @param {() => Promise<any>} aktion */
  const ausfuehren = async (aktion) => {
    setFehler(null); setLaeuft(true);
    try { await aktion(); } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); } finally { setLaeuft(false); }
  };

  const schalten = (/** @type {boolean} */ an) => ausfuehren(async () => {
    if (!an && !window.confirm(t("Büro-Modus ausschalten? Gekoppelte Geräte verlieren sofort den Zugang, bleiben aber gespeichert."))) return;
    setStatus(await setzeAktiv(an));
    setCode(null); setVerstanden(false);
    bueroGeaendert();
  });

  const neuerCode = (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    return ausfuehren(async () => { setCode(await codeErzeugen(name)); setName(""); laden(); });
  };

  const entziehen = (/** @type {{id: string, name: string}} */ g) => ausfuehren(async () => {
    if (!window.confirm(t("„{name}“ widerrufen? Das Gerät verliert sofort den Zugang.").replace("{name}", g.name))) return;
    await widerrufen(g.id);
    laden();
  });

  if (!status) {
    return fehler
      ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="buero-fehler">{fehler}</p>
      : <p className="text-sm text-slate-600 dark:text-slate-300">{t("Wird geladen …")}</p>;
  }

  return (
    <>
      <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="buero-zustand" data-aktiv={status.aktiv ? "ja" : "nein"}>
        {status.aktiv
          ? t("Der Büro-Modus ist an. Gekoppelte Geräte im Büro-Netz können diese Installation nutzen.")
          : t("Der Büro-Modus ist aus. Die App ist nur auf diesem Rechner erreichbar.")}
      </p>

      {!status.aktiv && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {t("Eingeschaltet erreichen ein zweiter Arbeitsplatz oder ein Tablet im selben Büro-Netz diese Installation — nur nach Kopplung mit einem Code von diesem Rechner. Personaldaten, Einstellungen des Systems, KI-Zugänge und Updates bleiben diesem Rechner vorbehalten.")}
          </p>
          <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("Die Verbindung im Netz ist nicht verschlüsselt (kein HTTPS). Wer im selben Netz mitliest, kann Projektdaten sehen. Nur in einem vertrauenswürdigen Büro-Netz einschalten, nie im Gäste- oder öffentlichen WLAN.")}</span>
          </p>
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={verstanden} onChange={(e) => setVerstanden(e.target.checked)} data-testid="buero-verstanden" className="mt-1" />
            <span>{t("Ich habe verstanden: nur im vertrauenswürdigen Büro-Netz.")}</span>
          </label>
          <button type="button" className={KNOPF_HAUPT} disabled={!verstanden || laeuft} onClick={() => schalten(true)} data-testid="buero-einschalten">
            <Network className="h-4 w-4" aria-hidden="true" /> {t("Büro-Modus einschalten")}
          </button>
        </div>
      )}

      {status.aktiv && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("Adresse für das andere Gerät")}</p>
            {status.urls.length > 0 ? (
              <ul className="space-y-0.5" data-testid="buero-urls">
                {status.urls.map((u) => <li key={u}><code className="select-all rounded bg-slate-100 px-1.5 py-0.5 text-sm dark:bg-slate-800">{u}</code></li>)}
              </ul>
            ) : <p className="text-sm text-rose-700 dark:text-rose-300">{t("Keine Netzwerkadresse gebunden.")}</p>}
            {status.fehler.map((f) => <p key={f} className="text-xs text-rose-700 dark:text-rose-300">{f}</p>)}
            {!status.appModus && (
              <p className="text-xs text-slate-600 dark:text-slate-300">{t("Entwicklungsmodus: dieser Port liefert nur die Schnittstelle. Die Oberfläche für das Tablet gibt es nur in der installierten App (ein Port für App und Schnittstelle).")}</p>
            )}
            <p className="text-xs text-slate-600 dark:text-slate-300">{t("Die Windows-Firewall fragt beim ersten Mal, ob Node.js im privaten Netz erreichbar sein darf — nur „Private Netzwerke“ erlauben.")}</p>
          </div>

          <form onSubmit={neuerCode} className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-slate-700 dark:text-slate-200">
              <span className="block font-medium">{t("Gerät koppeln")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("z. B. Tablet Baustelle")} data-testid="buero-geraetename"
                className="mt-1 w-56 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800" />
            </label>
            <button type="submit" className={KNOPF_RAND} disabled={!name.trim() || laeuft} data-testid="buero-code-erzeugen">{t("Code erzeugen")}</button>
          </form>
          {code && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-700 dark:bg-emerald-950/40" data-testid="buero-code-anzeige">
              <p className="font-mono text-3xl tracking-[0.3em] text-emerald-900 dark:text-emerald-200">{code.code}</p>
              <p className="text-xs text-slate-700 dark:text-slate-200">
                {t("Für „{name}“, gültig bis {zeit}, einmal verwendbar. Auf dem Gerät die Adresse oben öffnen und den Code eingeben.")
                  .replace("{name}", code.name).replace("{zeit}", zeitpunkt(code.laeuftAb, lang))}
              </p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("Gekoppelte Geräte")}</p>
            {status.geraete.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("noch keine")}</p> : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-700" data-testid="buero-geraete">
                {status.geraete.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{g.name}</span>
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      {t("zuletzt {zuletzt} · gültig bis {bis}").replace("{zuletzt}", zeitpunkt(g.zuletzt, lang)).replace("{bis}", zeitpunkt(g.laeuftAb, lang))}
                    </span>
                    <button type="button" className={`${KNOPF_RAND} ml-auto py-0.5 text-xs`} onClick={() => entziehen(g)} disabled={laeuft} data-testid="buero-widerrufen">{t("Widerrufen")}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" className={KNOPF_RAND} disabled={laeuft} onClick={() => schalten(false)} data-testid="buero-ausschalten">{t("Büro-Modus ausschalten")}</button>
        </div>
      )}
      {fehler && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="buero-fehler">{fehler}</p>}
    </>
  );
}

/**
 * @returns {React.ReactElement|null}
 */
export default function BueroModusKarte() {
  const { t } = useI18n();
  const { ich } = useBuero();
  if (DATENQUELLE !== "express" || !ich) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-800/60" data-testid="buero-karte">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Network className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Büro-Modus (Mehrplatz)")}
      </h3>
      {ich.lokal ? <AmHost /> : ich.geraet ? <DiesesGeraet name={ich.geraet.name} laeuftAb={ich.geraet.laeuftAb} /> : null}
    </div>
  );
}
