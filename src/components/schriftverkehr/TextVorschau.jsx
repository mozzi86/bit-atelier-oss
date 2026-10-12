// Plain-text preview of a letter (phase 82, 82-05): subject and text as text
// nodes — never HTML (no dangerouslySetInnerHTML; a template text is user
// input, T-82-43). Missing required placeholders `[[fehlt: pfad]]` are
// highlighted so the user sees what blocks freezing.
//
// In:  props betreff, text. Out: the preview.

import React from "react";
import { useI18n } from "@core/lib/i18n";

/**
 * Splits a text at the missing-value marks.
 * @param {string} text
 * @returns {Array<{fehlt: boolean, text: string}>}
 */
function teile(text) {
  /** @type {Array<{fehlt: boolean, text: string}>} */
  const aus = [];
  let rest = String(text || "");
  for (;;) {
    const i = rest.indexOf("[[fehlt: ");
    const j = i >= 0 ? rest.indexOf("]]", i) : -1;
    if (i < 0 || j < 0) break;
    if (i > 0) aus.push({ fehlt: false, text: rest.slice(0, i) });
    aus.push({ fehlt: true, text: rest.slice(i, j + 2) });
    rest = rest.slice(j + 2);
  }
  if (rest) aus.push({ fehlt: false, text: rest });
  return aus;
}

/** @param {{text: string}} props */
function MitMarken({ text }) {
  return <>{teile(text).map((x, i) => (x.fehlt
    ? <mark key={i} className="rounded bg-rose-100 px-0.5 text-rose-800 dark:bg-rose-950 dark:text-rose-200" data-testid="fehlt-marke">{x.text}</mark>
    : <React.Fragment key={i}>{x.text}</React.Fragment>))}</>;
}

/**
 * @param {{betreff: string, text: string}} props
 * @returns {React.ReactElement}
 */
export default function TextVorschau({ betreff, text }) {
  const { t } = useI18n();
  return (
    <section aria-label={t("Textvorschau")} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900" data-testid="text-vorschau">
      <p className="font-semibold text-slate-900 dark:text-slate-100"><MitMarken text={betreff} /></p>
      <div className="mt-2 whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200"><MitMarken text={text} /></div>
    </section>
  );
}
