// Feedback button + dialog for every build (Plan 83-02). Replaces the demo-only
// DemoFeedback/DemoKopfzeile mail buttons: the open-source app collects
// feedback from all its users, in the header next to the theme toggle.
//
// Two ways out, both plain links the user clicks — the app sends nothing by
// itself (no fetch, no telemetry):
//   "Per E-Mail senden"   → mailto: FEEDBACK_EMAIL, subject "BIT-Atelier Feedback (<version>)"
//   "Auf GitHub melden"   → ISSUES_URL/new with title and body as URL parameters
// The optional technical block (version, page, browser, operating system) is
// shown in the dialog exactly as it will be attached.
//
// In:  props { seite } — the route path of the current page (no query string,
//      so no project ids travel along). Other modules open the dialog with a
//      pre-filled text through oeffneFeedback() (@core/lib/feedback).
// Out: the header button and the dialog.

import React from "react";
import { MessageSquarePlus, Mail, Github } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@core/components/ui/dialog";
import { useI18n } from "@core/lib/i18n";
import { APP_VERSION, FEEDBACK_EMAIL } from "@core/lib/projektInfo";
import {
  FEEDBACK_EREIGNIS, erkenneUmgebung, feedbackIssueUrl, feedbackMailto, technischeZeilen,
} from "@core/lib/feedback";
import { DATENQUELLE } from "@core/lib/umgebung";

/** Build label appended to the version, so a report names the build it came from. */
const FASSUNG = { serverlos: "lokal", supabase: "cloud", express: "server" }[DATENQUELLE] || DATENQUELLE;

const KNOPF = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500";

/**
 * Header button that opens the feedback dialog, plus the dialog itself.
 * @param {{ seite: string }} props seite = route path of the current page, e.g. "/Dashboard"
 * @returns {React.ReactElement}
 */
export default function FeedbackDialog({ seite }) {
  const { t } = useI18n();
  const [offen, setOffen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [technikAnhaengen, setTechnikAnhaengen] = React.useState(true);

  // Other modules (check suite "Befund besprechen") open the dialog with a text.
  React.useEffect(() => {
    /** @param {Event} ev */
    const oeffnen = (ev) => {
      const vorbelegt = /** @type {CustomEvent<{text?: string}>} */ (ev).detail?.text || "";
      if (vorbelegt) setText(vorbelegt);
      setOffen(true);
    };
    window.addEventListener(FEEDBACK_EREIGNIS, oeffnen);
    return () => window.removeEventListener(FEEDBACK_EREIGNIS, oeffnen);
  }, []);

  const umgebung = React.useMemo(
    () => erkenneUmgebung(typeof navigator === "undefined" ? "" : navigator.userAgent),
    [],
  );
  const version = `${APP_VERSION} (${FASSUNG})`;
  const technik = technikAnhaengen
    ? technischeZeilen({ version, seite, browser: umgebung.browser, betriebssystem: umgebung.betriebssystem })
    : null;
  const mailHref = feedbackMailto({ text, technik, version });
  const githubHref = feedbackIssueUrl({ text, technik, version });

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        title={t("Feedback geben")}
        aria-label={t("Feedback geben")}
        data-testid="feedback-knopf"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
        <span className="hidden text-xs font-medium 2xl:inline">{t("Feedback")}</span>
      </button>

      <Dialog open={offen} onOpenChange={setOffen}>
        <DialogContent className="max-w-lg space-y-4 p-6" data-testid="feedback-dialog">
          <DialogTitle>{t("Feedback geben")}</DialogTitle>
          <DialogDescription>
            {t("Was fehlt, was stört, was gefällt? Es wird nichts automatisch gesendet: Sie schicken die Nachricht selbst aus Ihrem E-Mail-Programm oder auf GitHub ab.")}
          </DialogDescription>

          <div className="space-y-1">
            <label htmlFor="feedback-text" className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("Ihre Nachricht")}
            </label>
            <textarea
              id="feedback-text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="feedback-text"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={technikAnhaengen}
                onChange={(e) => setTechnikAnhaengen(e.target.checked)}
                data-testid="feedback-technik"
                className="mt-0.5 h-4 w-4 accent-emerald-600"
              />
              <span>{t("Technische Angaben anhängen: Version, Seite, Browser, Betriebssystem")}</span>
            </label>
            {technik && (
              <pre className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300" data-testid="feedback-technik-vorschau">
                {technik.join("\n")}
              </pre>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <a href={mailHref} data-testid="feedback-mail" className={`${KNOPF} bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90`}>
              <Mail className="h-4 w-4" aria-hidden="true" /> {t("Per E-Mail senden")}
            </a>
            <a
              href={githubHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="feedback-github"
              className={`${KNOPF} border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800`}
            >
              <Github className="h-4 w-4" aria-hidden="true" /> {t("Auf GitHub melden")}
            </a>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("E-Mail an")} <span className="font-mono">{FEEDBACK_EMAIL}</span>
            {" · "}
            {t("Meldungen auf GitHub sind öffentlich sichtbar.")}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
