// Settings area "Darstellung & Sprache" (key `display`, 80-03: D-P80-11/E-06). The
// SAME state as the header's quick switches (ThemeToggle, DE|EN) — useTheme()/
// useI18n() are module-level context, so this area is a second VIEW of that state,
// never a second store or a second "saved" (the header switches stay, per E-06).
//
// In:  useTheme() (browser state, @core/lib/themeWahl) and useI18n() (LANGS).
// Out: BEREIT = true, the area.

import React from "react";
import { Palette } from "lucide-react";
import { useI18n, LANGS } from "@core/lib/i18n";
import { useTheme } from "@core/components/theme/ThemeProvider";
import { THEME_WERTE } from "@core/lib/themeWahl";

/** Ready since 80-03. */
export const BEREIT = true;

/** German i18n key per theme value (order = THEME_WERTE). */
const THEME_LABEL = Object.freeze({ light: "Hell", dark: "Dunkel", system: "System" });

/**
 * @returns {React.ReactElement}
 */
export default function DarstellungBereich() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <section aria-labelledby="bereich-darstellung" data-testid="bereich-display"
      className="rounded-xl border border-slate-200 bg-white p-6 space-y-5 dark:border-slate-700 dark:bg-slate-900">
      <h2 id="bereich-darstellung" className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        <Palette className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Darstellung & Sprache")}
      </h2>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Farbschema")}</legend>
        <div className="flex flex-wrap gap-4">
          {THEME_WERTE.map((wert) => (
            <label key={wert} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="radio" name="theme" value={wert} checked={theme === wert} onChange={() => setTheme(wert)}
                className="accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              />
              {t(THEME_LABEL[wert])}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Sprache")}</legend>
        <div className="flex flex-wrap gap-4">
          {Object.keys(LANGS).map((code) => (
            <label key={code} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="radio" name="sprache" value={code} checked={lang === code} onChange={() => setLang(code)}
                className="accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              />
              {/* Language names of a language switch stay untranslated (the header's
                  DE|EN buttons already do this) — only English gets the extra
                  "preview" qualifier, since the EN dictionary is not complete yet. */}
              {code === "en" ? t("Englisch (Vorschau, unvollständig)") : LANGS[code]}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-slate-500 dark:text-slate-400">{t("Gilt für diesen Browser.")}</p>
    </section>
  );
}
