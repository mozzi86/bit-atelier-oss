// Shared surfaces for the client portal, the office release page and the
// invitation. Colour comes only from the tokens in index.css (card, brand,
// muted, the four state colours). Dark mode follows those tokens, so these
// strings carry no dark: palette classes.
//
// In:  nothing. Out: class-name fragments. No side effects.

/** Card and panel: white / near-black, hairline border. */
export const flaecheKarte = "border border-border bg-card text-card-foreground";
/** Primary action. Brand is the existing emerald token, not a new green. */
export const flaecheKnopf = "bg-brand text-brand-foreground hover:opacity-90";
/** Secondary action on a card. */
export const flaecheKnopfLeise = "border border-input bg-card text-foreground hover:bg-accent";
/** Text field and select. Focus uses the app ring (teal), already measured for 3:1. */
export const flaecheFeld = "border border-input bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Recessed chip or preview well. */
export const flaecheRuhe = "bg-muted";
export const flaecheTitel = "text-foreground";
export const flaecheLeise = "text-muted-foreground";
export const flaecheFehler = "border border-fehler-rand bg-fehler-flaeche text-fehler";
export const flaecheErfolg = "border border-erfolg-rand bg-erfolg-flaeche text-erfolg";
export const flaecheHinweis = "border border-hinweis-rand bg-hinweis-flaeche text-hinweis";
export const flaecheWarnung = "border border-warnung-rand bg-warnung-flaeche text-warnung";
/**
 * WhatsApp send button. #25D366 is the channel green already used on the
 * release page, named once so the class is not an arbitrary hex. The label
 * stays white (brand-foreground), the same pairing as before.
 */
export const flaecheWhatsapp = "bg-whatsapp text-brand-foreground hover:opacity-90";
/** Quote bar on an office reply. */
export const flaecheAntwort = "border-brand";
