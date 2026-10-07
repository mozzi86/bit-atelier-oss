// Slippy-Map-Helfer für OpenStreetMap-Kacheln (kein API-Key).
// https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames

const TILE = 256;

export function lonLatToTile(lon, lat, z) {
  const n = Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function tileUrl(x, y, z) {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

// Kachel-Mosaik, das ein Viewport (W×H px) zentriert auf lat/lng füllt.
// Liefert { tiles: [{href, x, y}], size } in Viewport-Pixelkoordinaten.
export function tileMosaic(lat, lng, z, W, H) {
  const n = Math.pow(2, z);
  const c = lonLatToTile(lng, lat, z);
  const centerPxX = c.x * TILE;
  const centerPxY = c.y * TILE;
  const topLeftX = centerPxX - W / 2;
  const topLeftY = centerPxY - H / 2;
  const tx0 = Math.floor(topLeftX / TILE);
  const ty0 = Math.floor(topLeftY / TILE);
  const tx1 = Math.floor((topLeftX + W) / TILE);
  const ty1 = Math.floor((topLeftY + H) / TILE);
  const tiles = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const wx = ((tx % n) + n) % n; // wrap X
      if (ty < 0 || ty >= n) continue;
      tiles.push({
        href: tileUrl(wx, ty, z),
        x: Math.round(tx * TILE - topLeftX),
        y: Math.round(ty * TILE - topLeftY),
      });
    }
  }
  return { tiles, size: TILE };
}
