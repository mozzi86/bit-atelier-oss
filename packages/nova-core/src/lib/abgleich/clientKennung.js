// 106-09: the id of THIS tab for the change stream between devices. bitApi sends it on every request (header
// X-Bit-Client), the server stamps it on the stream event of a write (server/aenderungsStrom.js), and the stream
// client drops events that carry it - so a tab never applies its own write a second time.
//
// Kept in a module of its own without imports, because bitApi.js (the one data layer) and the stream client both
// need it and must not import each other.
//
// In:  nothing. Out: clientKennung() (stable for the lifetime of the page), CLIENT_KOPF.

/** Request header name (lower case on the server side: x-bit-client). */
export const CLIENT_KOPF = "X-Bit-Client";

/** @type {string|null} */
let kennung = null;

/**
 * The random id of this page (22 characters, A-Z a-z 0-9 _ -), created on first use. Not a secret and not an
 * identity: it only tells "my own write" from "somebody else's" in the stream.
 * @returns {string}
 */
export function clientKennung() {
  if (kennung) return kennung;
  const zeichen = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  /** @type {number[]} */
  let zahlen;
  try {
    const puffer = new Uint8Array(22);
    globalThis.crypto.getRandomValues(puffer);
    zahlen = [...puffer];
  } catch {
    zahlen = Array.from({ length: 22 }, () => Math.floor(Math.random() * 256));
  }
  kennung = zahlen.map((n) => zeichen[n % 64]).join("");
  return kennung;
}
