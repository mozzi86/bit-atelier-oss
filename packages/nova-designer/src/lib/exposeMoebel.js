// W-1118-28 (step 3): the furniture of the model as bodies for the exposé picture. The furnishing is the one the apartment
// planner stores (BuildingComplex.moeblierung: per room a list {id, typ, x, y, rot}; sizes b × t from the catalogue or the
// project's own types, lib/moebel.js) — the picture adds the third dimension, nothing else: what stands where is the model.
//
// A type has no height and no shape in the model. Both are picked here from the type id / name (table, chair, sofa, kitchen
// unit, tiled stove, bed, sanitary …) with usual furniture heights [ASSUMED]; an unknown type becomes a plain box. So a new
// type shows up at once, just less detailed.
//
// Item frame (lib/wohnMoebel.js SEITE_RICHTUNG): at rot 0 the width b runs along +x, the depth t along +y (the model's z) and
// the FRONT is +y; each 90° turns (x, y) → (−y, x).
//
// In:  furnishing, rooms (customZones), type list. Out: resolved items with their storey; bodies through a box callback.
// Pure module: no three.js, no DOM.

/** Usual heights in m. [ASSUMED] furniture standards (seat 0.45, table 0.75, worktop 0.91, tall unit 2.00), no project data. */
export const MOEBEL_HOEHEN = Object.freeze({ sitz: 0.45, tisch: 0.75, couchtisch: 0.38, arbeitsplatte: 0.91, hochschrank: 2.0, regal: 1.8, bett: 0.5, kachelofen: 1.3, lowboard: 0.45, wanne: 0.58, wc: 0.42, geraet: 0.85, speicher: 1.8 });

/**
 * What kind of body a furniture type is, from its id and name.
 * @param {{id?: string, name?: string, kategorie?: string}|null|undefined} def
 * @returns {string} "stuhl" | "esstisch" | "couchtisch" | "sofa" | "tv" | "kachelofen" | "kochfeld" | "spuele" | "theke" | "kueche" |
 *   "kuehlschrank" | "regal" | "bett" | "wc" | "waschtisch" | "dusche" | "wanne" | "geraet" | "speicher" | "tisch" | "ohne" | "kasten"
 */
export function moebelArt(def) {
  const s = `${def?.id || ""} ${def?.name || ""}`.toLowerCase();
  if (/leine/.test(s)) return "ohne";
  if (/stuhl|sessel/.test(s) || def?.kategorie === "chair") return "stuhl";
  if (/couchtisch|beistell/.test(s)) return "couchtisch";
  if (/esstisch/.test(s)) return "esstisch";
  if (/sofa|couch/.test(s)) return "sofa";
  if (/\btv\b|lowboard|fernseh/.test(s)) return "tv";
  if (/kachelofen|grundofen|kamin/.test(s)) return "kachelofen";
  if (/kochfeld|herd/.test(s)) return "kochfeld";
  if (/sp(ü|ue)le/.test(s)) return "spuele";
  if (/insel-erweitert|theke|tresen/.test(s)) return "theke";
  if (/ablage|arbeitsfl|insel|unterschrank|k(ü|ue)chen/.test(s)) return "kueche";
  if (/k(ü|ue)hlschrank|hochschrank/.test(s)) return "kuehlschrank";
  if (/regal|schrank/.test(s)) return "regal";
  if (/bett/.test(s)) return "bett";
  if (/wc/.test(s)) return "wc";
  if (/waschtisch|waschbecken|ausguss/.test(s)) return "waschtisch";
  if (/dusche/.test(s)) return "dusche";
  if (/wanne/.test(s)) return "wanne";
  if (/waschmaschine|trockner|w(ä|ae)rmepumpe|wp-innen/.test(s)) return "geraet";
  if (/speicher|puffer/.test(s)) return "speicher";
  if (/tisch/.test(s) || def?.kategorie === "desk") return "tisch";
  return "kasten";
}

/** Point in polygon (even-odd), plan coordinates. @param {number} x @param {number} z @param {Array<{x: number, z: number}>} pts */
function imPolygon(x, z, pts) {
  let innen = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) innen = !innen;
  }
  return innen;
}

/**
 * The furniture with its storey and type. The key of a furnishing entry names its room ("guid:<room guid>" or "id:<_idx>");
 * an `id:` key may be stale after a rebuild of the rooms (W-1118-02), so the room found by the key must also CONTAIN the
 * item — else the item goes to a room that contains it (the lowest storey first), else to the ground floor.
 * @param {Record<string, any[]>|null|undefined} moeblierung
 * @param {any[]} zonen customZones [{points, level, _idx, guid?}]
 * @param {any[]} typen catalogue and own types [{id, name, b, t, kategorie}]
 * @returns {Array<{id: string, typ: string, x: number, z: number, rot: number, level: number, def: any}>}
 */
export function moebelAufloesen(moeblierung, zonen, typen) {
  const nachId = new Map((typen || []).filter((t) => t && t.id).map((t) => [t.id, t]));
  const raeume = (zonen || []).filter((z) => Array.isArray(z?.points) && z.points.length >= 3);
  /** @type {Array<{id: string, typ: string, x: number, z: number, rot: number, level: number, def: any}>} */
  const aus = [];
  for (const [key, items] of Object.entries(moeblierung || {})) {
    if (!Array.isArray(items)) continue;
    const perKey = raeume.find((z) => (z.guid && key === `guid:${z.guid}`) || key === `id:${z._idx}`) || null;
    for (const it of items) {
      const def = nachId.get(it?.typ);
      if (!def || !Number.isFinite(Number(it.x)) || !Number.isFinite(Number(it.y))) continue;
      const x = Number(it.x), z = Number(it.y);
      const raum = perKey && imPolygon(x, z, perKey.points) ? perKey
        : raeume.filter((r) => imPolygon(x, z, r.points)).sort((a, b) => (a.level || 0) - (b.level || 0))[0] || perKey;
      aus.push({ id: String(it.id || ""), typ: String(it.typ), x, z, rot: ((Math.round((Number(it.rot) || 0) / 90) % 4) + 4) % 4 * 90, level: raum ? Number(raum.level) || 0 : 0, def });
    }
  }
  return aus;
}

/**
 * Plan point of an item-frame point (a across, d towards the front), after the item's rotation.
 * @param {{x: number, z: number, rot: number}} it
 * @param {number} a @param {number} d
 * @returns {{x: number, z: number}}
 */
export function moebelPunkt(it, a, d) {
  let x = a, y = d;
  for (let k = 0; k < it.rot / 90; k += 1) [x, y] = [-y, x];
  return { x: it.x + x, z: it.z + y };
}

/**
 * The bodies of one piece of furniture, handed to `q` as boxes in the item frame: a0…a1 across (−b/2 … b/2), h0…h1 above the
 * floor, d0…d1 from the back (−t/2) to the front (+t/2). Material keys are those of exposeBild.materialien.
 * @param {any} def type {id, name, b, t, kategorie}
 * The optional last argument of `q` names a shape that fills the same box instead of the box itself: "rund" (a cushion with
 * rounded edges), "kugel" (ellipsoid), "zylinder" (upright cylinder), "schale" (upright cone frustum, wider at the top),
 * "kegel" (upright cone frustum, wider at the bottom).
 * @param {(mk: string, a0: number, a1: number, h0: number, h1: number, d0: number, d1: number, form?: string) => void} q
 * @param {{raumhoehe_m?: number}} [opt] clear height of the room in m (the shaft of a tiled stove ends there)
 */
export function moebelKoerper(def, q, { raumhoehe_m = 2.6 } = {}) {
  const b = Number(def?.b) || 0.6, t = Number(def?.t) || 0.6, hb = b / 2, ht = t / 2, H = MOEBEL_HOEHEN;
  const beine = (/** @type {string} */ mk, /** @type {number} */ h, /** @type {number} */ einzug, /** @type {number} */ d) => {
    for (const sa of [-1, 1]) for (const sd of [-1, 1]) q(mk, sa * (hb - einzug) - d / 2, sa * (hb - einzug) + d / 2, 0, h, sd * (ht - einzug) - d / 2, sd * (ht - einzug) + d / 2);
  };
  switch (moebelArt(def)) {
    case "ohne": return;
    case "stuhl":
      beine("eiche", H.sitz - 0.04, 0.04, 0.035);
      q("eiche", -hb + 0.02, hb - 0.02, H.sitz - 0.04, H.sitz, -ht + 0.02, ht - 0.02);
      q("polster", -hb + 0.04, hb - 0.04, H.sitz, H.sitz + 0.03, -ht + 0.06, ht - 0.04);
      q("eiche", -hb + 0.02, hb - 0.02, H.sitz + 0.18, H.sitz + 0.42, -ht + 0.02, -ht + 0.05); // back rest at the back
      for (const sa of [-1, 1]) q("eiche", sa * (hb - 0.04) - 0.0175, sa * (hb - 0.04) + 0.0175, H.sitz, H.sitz + 0.42, -ht + 0.02, -ht + 0.055);
      return;
    case "esstisch": case "tisch":
      beine("eiche", H.tisch - 0.04, 0.09, 0.07);
      q("eiche", -hb, hb, H.tisch - 0.04, H.tisch, -ht, ht);
      // a dining table carries pendant lamps on its long axis: cable from the ceiling, a conical shade 0.75 m above the top
      if (moebelArt(def) === "esstisch") {
        const lang = b >= t, n = Math.max(1, Math.min(3, Math.round((lang ? b : t) / 0.7)));
        for (let i = 0; i < n; i += 1) {
          const s = ((i + 0.5) / n - 0.5) * (lang ? b : t) * 0.6, a = lang ? s : 0, d = lang ? 0 : s, yS = H.tisch + 0.75;
          q("schwarz", a - 0.004, a + 0.004, yS + 0.18, raumhoehe_m, d - 0.004, d + 0.004, "zylinder");
          q("schwarz", a - 0.15, a + 0.15, yS, yS + 0.19, d - 0.15, d + 0.15, "kegel");
        }
      }
      return;
    case "couchtisch":
      beine("schwarz", H.couchtisch - 0.04, 0.08, 0.03);
      q("eiche", -hb, hb, H.couchtisch - 0.04, H.couchtisch, -ht, ht);
      // what lies on a coffee table in a picture: two books and a tray
      q("polster", -hb * 0.55, -hb * 0.55 + 0.3, H.couchtisch, H.couchtisch + 0.03, -ht * 0.4, -ht * 0.4 + 0.22);
      q("keramik", -hb * 0.55 + 0.03, -hb * 0.55 + 0.27, H.couchtisch + 0.03, H.couchtisch + 0.055, -ht * 0.4 + 0.02, -ht * 0.4 + 0.2);
      q("keramik", hb * 0.15, hb * 0.15 + 0.26, H.couchtisch, H.couchtisch + 0.075, ht * 0.1, ht * 0.1 + 0.26, "schale");
      return;
    case "sofa": {
      // upholstered: arms, back and cushions with rounded edges; sizes of a common two-/three-seater [ASSUMED]
      const lehne = Math.min(0.26, t * 0.28), arm = Math.min(0.18, b * 0.1);
      q("stoff", -hb + arm * 0.5, hb - arm * 0.5, 0.06, 0.3, -ht + 0.02, ht - 0.03); // base
      q("stoff", -hb, -hb + arm, 0.06, 0.6, -ht, ht, "rund"); q("stoff", hb - arm, hb, 0.06, 0.6, -ht, ht, "rund"); // arms
      q("stoff", -hb + arm * 0.6, hb - arm * 0.6, 0.24, 0.78, -ht, -ht + lehne, "rund"); // back
      const kissen = Math.max(1, Math.round((b - 2 * arm) / 0.9)), kb = (b - 2 * arm) / kissen;
      for (let k = 0; k < kissen; k += 1) {
        const a0 = -hb + arm + k * kb + 0.01, a1 = -hb + arm + (k + 1) * kb - 0.01;
        q("stoffHell", a0, a1, 0.27, H.sitz + 0.03, -ht + lehne - 0.03, ht, "rund"); // seat cushion
        q("stoffHell", a0 + 0.02, a1 - 0.02, H.sitz - 0.02, 0.84, -ht + lehne - 0.05, -ht + lehne + 0.17, "rund"); // back cushion
      }
      return;
    }
    case "tv":
      q("eiche", -hb, hb, 0.1, H.lowboard, -ht, ht);
      for (const sa of [-1, 1]) q("schwarz", sa * (hb - 0.25) - 0.02, sa * (hb - 0.25) + 0.02, 0, 0.1, -ht + 0.05, ht - 0.05);
      q("bildschirm", -Math.min(hb, 0.75), Math.min(hb, 0.75), 0.95, 1.8, -ht, -ht + 0.04); // screen on the wall behind
      q("polster", hb - 0.5, hb - 0.18, H.lowboard, H.lowboard + 0.035, -0.12, 0.12); // books on the board
      q("keramik", hb - 0.47, hb - 0.22, H.lowboard + 0.035, H.lowboard + 0.065, -0.1, 0.1);
      return;
    case "kachelofen": {
      q("kachel", -hb, hb, 0.06, H.kachelofen, -ht, ht);
      q("kachelrand", -hb - 0.02, hb + 0.02, 0, 0.06, -ht - 0.02, ht + 0.02);
      q("kachelrand", -hb - 0.02, hb + 0.02, H.kachelofen, H.kachelofen + 0.05, -ht - 0.02, ht + 0.02);
      q("innenwand", -hb + 0.25, hb - 0.25, H.kachelofen + 0.05, raumhoehe_m, -ht + 0.2, ht - 0.2); // shaft to the ceiling
      q("schwarz", -0.2, 0.2, 0.5, 1.02, ht, ht + 0.02); // fire door on the front
      q("feuerglas", -0.15, 0.15, 0.56, 0.96, ht + 0.02, ht + 0.025);
      q("schwarz", -0.2, 0.2, 0.2, 0.36, ht, ht + 0.02); // ash door
      return;
    }
    case "kueche": case "kochfeld": case "spuele": {
      const art = moebelArt(def);
      q("sockelleiste", -hb, hb, 0, 0.1, -ht + 0.02, ht - 0.06);
      q("front", -hb, hb, 0.1, H.arbeitsplatte - 0.04, -ht, ht - 0.02);
      q("arbeitsplatte", -hb, hb, H.arbeitsplatte - 0.04, H.arbeitsplatte, -ht, ht);
      // joints of the fronts: a grip groove under the worktop, a drawer joint, a vertical joint every 0.60 m
      q("sockelleiste", -hb, hb, H.arbeitsplatte - 0.075, H.arbeitsplatte - 0.06, ht - 0.021, ht - 0.019);
      q("sockelleiste", -hb, hb, 0.5, 0.504, ht - 0.021, ht - 0.019);
      for (let a = -hb + 0.6; a < hb - 0.05; a += 0.6) q("sockelleiste", a - 0.002, a + 0.002, 0.1, H.arbeitsplatte - 0.04, ht - 0.021, ht - 0.019);
      if (art === "kochfeld") {
        q("feuerglas", -hb + 0.04, hb - 0.04, H.arbeitsplatte, H.arbeitsplatte + 0.008, -ht + 0.06, ht - 0.06);
        // salt and pepper mills beside the hob, on the worktop run the hob sits in [ASSUMED the run continues on that side]
        q("schwarz", hb + 0.14, hb + 0.2, H.arbeitsplatte, H.arbeitsplatte + 0.2, -0.03, 0.03, "zylinder");
        q("schwarz", hb + 0.25, hb + 0.31, H.arbeitsplatte, H.arbeitsplatte + 0.15, 0.02, 0.08, "zylinder");
      }
      // a board leaning at the back of a plain worktop run
      if (art === "kueche" && b >= 1) q("eiche", -hb + 0.1, -hb + 0.42, H.arbeitsplatte, H.arbeitsplatte + 0.3, -ht + 0.02, -ht + 0.045);
      if (art === "spuele") {
        q("edelstahl", -hb + 0.08, hb - 0.08, H.arbeitsplatte, H.arbeitsplatte + 0.006, -ht + 0.12, ht - 0.1);
        q("edelstahl", -0.014, 0.014, H.arbeitsplatte, H.arbeitsplatte + 0.3, -ht + 0.05, -ht + 0.078); // tap: riser and spout
        q("edelstahl", -0.014, 0.014, H.arbeitsplatte + 0.272, H.arbeitsplatte + 0.3, -ht + 0.05, -ht + 0.24);
      }
      return;
    }
    case "theke":
      // a closed sideboard: body with joints every 0.60 m, plinth, top
      q("sockelleiste", -hb, hb, 0, 0.1, -ht + 0.02, ht - 0.04);
      q("front", -hb, hb, 0.1, H.arbeitsplatte - 0.04, -ht, ht - 0.01);
      for (let a = -hb + 0.6; a < hb - 0.05; a += 0.6) q("sockelleiste", a - 0.002, a + 0.002, 0.1, H.arbeitsplatte - 0.04, ht - 0.011, ht - 0.009);
      q("arbeitsplatte", -hb, hb, H.arbeitsplatte - 0.04, H.arbeitsplatte, -ht, ht);
      q("eiche", -0.17, 0.17, H.arbeitsplatte, H.arbeitsplatte + 0.07, -0.17, 0.17, "schale"); // a wooden bowl with apples on the sideboard
      for (const [a, d] of [[-0.065, -0.035], [0.055, -0.03], [0, 0.06]]) q("apfel", a - 0.04, a + 0.04, H.arbeitsplatte + 0.06, H.arbeitsplatte + 0.135, d - 0.04, d + 0.04, "kugel");
      return;
    case "kuehlschrank":
      q("sockelleiste", -hb, hb, 0, 0.1, -ht + 0.02, ht - 0.06);
      q("front", -hb, hb, 0.1, H.hochschrank, -ht, ht - 0.02);
      q("sockelleiste", -hb, hb, 1.2, 1.204, ht - 0.021, ht - 0.019); // joint between the two doors
      q("edelstahl", hb - 0.08, hb - 0.06, 0.9, 1.5, ht - 0.02, ht + 0.02);
      return;
    case "regal":
      q("front", -hb, hb, 0, H.regal, -ht, ht);
      return;
    case "bett":
      q("eiche", -hb, hb, 0.1, 0.3, -ht, ht);
      q("stoffHell", -hb + 0.03, hb - 0.03, 0.3, H.bett, -ht + 0.05, ht - 0.03);
      q("eiche", -hb, hb, 0.1, 0.95, -ht - 0.04, -ht); // head board at the back
      q("keramik", -hb + 0.1, hb - 0.1, H.bett, H.bett + 0.1, -ht + 0.1, -ht + 0.55); // pillows
      return;
    case "wc":
      q("keramik", -hb + 0.02, hb - 0.02, 0, H.wc, -ht + 0.12, ht);
      q("keramik", -hb, hb, 0.4, 1.0, -ht, -ht + 0.14); // cistern panel at the back
      return;
    case "waschtisch":
      q("front", -hb, hb, 0.25, 0.8, -ht + 0.05, ht - 0.03);
      q("keramik", -hb, hb, 0.8, 0.87, -ht, ht);
      return;
    case "dusche":
      q("keramik", -hb, hb, 0, 0.03, -ht, ht);
      q("klarglas", hb - 0.01, hb, 0.03, 2.0, -ht, ht);
      return;
    case "wanne":
      q("keramik", -hb, hb, 0, H.wanne, -ht, ht);
      return;
    case "geraet":
      q("front", -hb, hb, 0, H.geraet, -ht, ht);
      return;
    case "speicher":
      q("front", -hb, hb, 0, H.speicher, -ht, ht);
      return;
    default:
      q("front", -hb, hb, 0, 0.75, -ht, ht);
  }
}
