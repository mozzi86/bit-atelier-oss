// ETRS89 / UTM (GRS80 ellipsoid) ↔ geographic coordinates — own implementation of the
// transverse Mercator series after J. P. Snyder, "Map Projections — A Working Manual",
// USGS Professional Paper 1395 (1987), eq. 8-9…8-25. Needed by the DXF parcel import
// (101-03): German cadastral DXF (ALKIS) carry ETRS89/UTM coordinates, zone 32 (EPSG:25832,
// e.g. Bavaria, Baden-Württemberg, NRW) or 33 (EPSG:25833, eastern states).
// Accuracy of the series: well below 1 mm inside a 6° zone — far finer than the 0.01 m
// a parcel boundary needs. ETRS89 is treated as WGS84 for the map (difference < 1 m in 2026,
// below what the web map shows) [ASSUMED].
//
// In:  easting/northing in metres + zone, or lat/lng in degrees. Out: the other one.
// Pure module, node-testable.

const A = 6378137;               // GRS80 semi-major axis, m
const F = 1 / 298.257222101;     // GRS80 flattening
const K0 = 0.9996;               // UTM scale factor on the central meridian
const E0 = 500000;               // false easting, m
const E2 = F * (2 - F);          // first eccentricity squared
const EP2 = E2 / (1 - E2);       // second eccentricity squared
const GRAD = Math.PI / 180;

/** Meridian arc length from the equator to latitude phi (radians), metres (Snyder eq. 3-21). */
function meridianBogen(phi) {
  const e4 = E2 * E2, e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

/**
 * Central meridian of a UTM zone.
 * @param {number} zone 1–60
 * @returns {number} longitude in degrees
 */
export function zentralMeridian(zone) {
  return zone * 6 - 183;
}

/**
 * Geographic → UTM (northern hemisphere).
 * @param {number} lat latitude, degrees
 * @param {number} lng longitude, degrees
 * @param {number} zone UTM zone 1–60
 * @returns {{ost: number, nord: number}} easting / northing in metres (without zone prefix)
 */
export function nachUtm(lat, lng, zone) {
  const phi = lat * GRAD, lam = (lng - zentralMeridian(zone)) * GRAD;
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2, c = EP2 * Math.cos(phi) ** 2, a = Math.cos(phi) * lam;
  const m = meridianBogen(phi);
  const ost = E0 + K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const nord = K0 * (m + n * Math.tan(phi) * ((a * a) / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  return { ost, nord };
}

/**
 * UTM (northern hemisphere) → geographic.
 * @param {number} ost easting in metres (without zone prefix, 500 000 = central meridian)
 * @param {number} nord northing in metres
 * @param {number} zone UTM zone 1–60
 * @returns {{lat: number, lng: number}} degrees
 */
export function vonUtm(ost, nord, zone) {
  const m = nord / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c1 = EP2 * Math.cos(phi1) ** 2, t1 = Math.tan(phi1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * s * s);
  const r1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const d = (ost - E0) / (n1 * K0);
  const phi = phi1 - ((n1 * Math.tan(phi1)) / r1) * ((d * d) / 2
    - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lam = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6
    + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(phi1);
  return { lat: phi / GRAD, lng: zentralMeridian(zone) + lam / GRAD };
}
