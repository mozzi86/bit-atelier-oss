// Listing helpers for /InvestmentPlatform.
//
// In:  LandListing records as stored (title, location, prices, owner_id, status).
// Out: filtered lists and display numbers. No network, no React.
// A missing location or a non-numeric price must not throw: the marketplace
// renders whatever was saved, including older rows without a location object.

/**
 * Finite number, or 0 when the value is missing or not a number.
 * Unit depends on the caller (m², Euro, percent).
 * @param {unknown} wert
 * @returns {number}
 */
export function zahl(wert) {
  const x = Number(wert);
  return Number.isFinite(x) ? x : 0;
}

/**
 * "Street, city" from a listing. Empty string when location is absent.
 * @param {any} listing
 * @returns {string}
 */
export function ortZeile(listing) {
  const ort = listing?.location;
  if (!ort || typeof ort !== "object") return "";
  return [ort.address, ort.city].filter((teil) => typeof teil === "string" && teil.trim()).join(", ");
}

/**
 * Form state for LandListingForm, from a stored listing (edit) .
 * Areas in m², money in Euro, share in percent.
 * @param {any} listing
 * @returns {{ title: string, address: string, city: string, land_area: number, asking_price: number, minimum_investment: number, profit_share_percentage: number, status: string }}
 */
export function formularAusInserat(listing) {
  const ort = listing?.location && typeof listing.location === "object" ? listing.location : {};
  return {
    title: typeof listing?.title === "string" ? listing.title : "",
    address: typeof ort.address === "string" ? ort.address : "",
    city: typeof ort.city === "string" ? ort.city : "",
    land_area: zahl(listing?.land_area),
    asking_price: zahl(listing?.asking_price),
    minimum_investment: zahl(listing?.minimum_investment),
    profit_share_percentage: zahl(listing?.profit_share_percentage),
    status: typeof listing?.status === "string" && listing.status ? listing.status : "active",
  };
}

/**
 * Listings of one owner. No user id → none (do not show everyone's rows as "mine").
 * @param {any[]|null|undefined} listings
 * @param {string|null|undefined} userId
 * @returns {any[]}
 */
export function eigeneInserate(listings, userId) {
  if (!userId) return [];
  return (Array.isArray(listings) ? listings : []).filter((l) => l && l.owner_id === userId);
}

/**
 * Live filter: title, address, city, raw status and an optional status label.
 * Empty query returns the list unchanged. Matching is case-insensitive.
 * @param {any[]|null|undefined} listings
 * @param {string} suche
 * @param {(status: string) => string} [statusText]
 * @returns {any[]}
 */
export function inserateFiltern(listings, suche, statusText = (s) => s) {
  const q = String(suche || "").trim().toLowerCase();
  const liste = Array.isArray(listings) ? listings : [];
  if (!q) return liste;
  return liste.filter((l) => {
    const teile = [l?.title, ortZeile(l), l?.status, statusText(l?.status)];
    return teile.filter((x) => x != null && x !== "").join(" ").toLowerCase().includes(q);
  });
}
