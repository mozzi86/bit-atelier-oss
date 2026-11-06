// 108-01 (9b): when does a maplibre error event mean "tiles not reachable" (the note "Karte offline" over the map)?
// Plain module (no maplibre import) so the rule is unit-testable in node; MapLibreMap.jsx calls it on every `error` event.
//
// Review 108-01: the first rule filtered on the message text (/sprite|image/). That also swallowed real tile failures — a raster tile
// that cannot be decoded (a captive portal answers with HTML: "Could not load image …") and HTTP errors of the satellite source
// (its URL contains "World_Imagery"). The rule now looks at what maplibre attaches to the event instead of the text:
//  - a tile error carries `tile` (TileManager._loadTile fires ErrorEvent(err, {tile}); 404 tiles are not fired at all, so a tile at the
//    edge of the coverage never counts);
//  - every source event is forwarded by the style with `sourceId` and the serialized `source` (its `type`);
//  - sprite and style-image errors come from the style itself and have no `sourceId`;
//  - geojson/image/video/canvas sources hold data of the callers, not tiles — an invalid setData is not "offline".
//
// In:  a maplibre error event. Out: true = count it as a tile failure.

/** Source types whose data are tiles from a server (or their TileJSON). */
const KACHEL_QUELLEN = new Set(["raster", "vector", "raster-dem"]);

/**
 * @param {{sourceId?: string|null, tile?: object|null, source?: {type?: string}|null, error?: {message?: string}}|null|undefined} e
 *   maplibre error event (`error` of Map)
 * @returns {boolean} true when a tile (or the TileJSON of a tile source) could not be loaded
 */
export function istKachelFehler(e) {
  if (!e || e.sourceId == null) return false;
  const typ = e.source?.type;
  if (typ && !KACHEL_QUELLEN.has(typ)) return false;
  return e.tile != null || KACHEL_QUELLEN.has(/** @type {string} */ (typ));
}
