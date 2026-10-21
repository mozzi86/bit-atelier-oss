// dokumentAnzeige.js — shows a stored document (Document.data, Beleg.data) in a window the caller opened
// synchronously (popup blocker), under the 104-10 rule for document references.
//
// Why: Reports (openDoc) and the receipt preview wrote `<iframe src="${data}" title="${name}">` into the new
// window with document.write. The new window is about:blank and shares the app's origin, and data/name come
// from records an imported .bitproj, a paired office device or an agent can write — a stored value like
// `javascript:…` or a name with `"><script>` ran with full access to the app. Now the content passes
// inhaltPruefen (only data: URLs of an allowed media type, or blob:) and the page is built with DOM calls;
// name and messages only ever become text. Callers may let embedded content of another media type (SVG,
// TIFF …) be saved through an <a download> link instead (sonstHerunterladen) — the browser never renders it.
//
// In:  the opened window, the stored content, its file name, t() for the messages. Out: the filled window.

import { inhaltPruefen, INHALT_TYPEN_STANDARD, PFAD_GRUND } from "@core/lib/pfadRichtlinie.js";

/** Media types the receipt preview may open: the defaults plus the XML of XRechnung/ZUGFeRD (download only). */
export const BELEG_TYPEN = Object.freeze([...INHALT_TYPEN_STANDARD, "application/xml", "text/xml"]);

/**
 * Fills a freshly opened window with one document: an iframe for a PDF (or a blob: URL), an image for an
 * image, a download link for anything else the caller allowed (XML). A refused value shows the plain-text
 * reason instead — with `sonstHerunterladen`, embedded content of another media type (SVG, TIFF, HEIC …)
 * shows the reason as a note plus a download link, so a stored file never becomes unreachable.
 * Side effect: replaces the window's title and body content.
 * @param {Window} fenster the window from window.open() (about:blank, same origin)
 * @param {unknown} inhalt the stored content (data: URL, blob: URL) — untrusted
 * @param {{name?: string, t: (k: string) => string, typen?: readonly string[], sonstHerunterladen?: boolean}} o
 *   name = file name shown as title and link text; t = translation; typen = media types shown in the window
 *   (default INHALT_TYPEN_STANDARD); sonstHerunterladen = a data: URL of any other media type is offered as an
 *   <a download> link (saved, never rendered here); paths, web addresses and javascript: stay refused
 * @returns {boolean} true when the content is shown or offered for download, false when it was refused
 */
export function inhaltImFensterZeigen(fenster, inhalt, { name = "", t, typen = INHALT_TYPEN_STANDARD, sonstHerunterladen = false }) {
  const doc = fenster.document;
  doc.title = String(name || "");
  const body = doc.body;
  body.replaceChildren();
  body.style.margin = "0";
  const pruefung = inhaltPruefen(inhalt, { typen });
  if (!pruefung.ok) {
    const abgewiesen = /** @type {import("@core/lib/pfadRichtlinie.js").PfadAbgewiesen} */ (pruefung);
    const download = sonstHerunterladen && abgewiesen.grund === PFAD_GRUND.INHALT_TYP ? inhaltPruefen(inhalt, { nurHerunterladen: true }) : null;
    const p = doc.createElement("p");
    // A download offer is a note, not an error: the file stays reachable.
    p.setAttribute("role", download?.ok ? "note" : "alert");
    p.style.font = "14px system-ui, sans-serif";
    p.style.padding = "16px";
    p.textContent = t(abgewiesen.meldung);
    body.appendChild(p);
    if (!download?.ok) return false;
    body.appendChild(herunterladenLink(doc, download.url, name, t));
    return true;
  }
  const { url, typ } = pruefung;
  if (typ.startsWith("image/")) {
    const img = doc.createElement("img");
    img.src = url;
    img.alt = String(name || "");
    img.style.maxWidth = "100%";
    body.appendChild(img);
  } else if (typ === "application/pdf" || typ === "") {
    const frame = doc.createElement("iframe");
    frame.src = url;
    frame.title = String(name || "");
    frame.style.border = "0";
    frame.style.width = "100%";
    frame.style.height = "100vh";
    body.appendChild(frame);
  } else {
    body.appendChild(herunterladenLink(doc, url, name, t));
  }
  return true;
}

/**
 * An <a download> link for checked content; name only becomes an attribute and text.
 * @param {Document} doc the target window's document
 * @param {string} url checked data: or blob: URL
 * @param {string} name file name (link text and suggested file name)
 * @param {(k: string) => string} t translation
 * @returns {HTMLAnchorElement}
 */
function herunterladenLink(doc, url, name, t) {
  const a = doc.createElement("a");
  a.href = url;
  a.download = String(name || "dokument");
  a.textContent = `${t("Herunterladen")}: ${String(name || "")}`;
  a.style.font = "14px system-ui, sans-serif";
  a.style.padding = "0 16px";
  return a;
}
