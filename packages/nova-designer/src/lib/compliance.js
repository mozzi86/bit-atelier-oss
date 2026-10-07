// Spacio-style rapid residential feasibility: unit mix + code compliance.
// @designer darf @designer importieren (ESLint-Boundary) — die
// Barrierefreiheits-Faustformeln kommen aus der Fachlib statt aus einer Kopie.
import { aufzugPflicht, erfBarrierefreiErreichbar } from "@designer/lib/accessibility";

export const UNIT_TYPES = {
  studio: { label: "Studio", min: 25, default: 32 },
  t1: { label: "1-Zimmer", min: 30, default: 45 },
  t2: { label: "2-Zimmer", min: 45, default: 65 },
  t3: { label: "3-Zimmer", min: 60, default: 88 },
  t4: { label: "4-Zimmer", min: 75, default: 112 },
};
export const unitInfo = (k) => UNIT_TYPES[k] || { label: k, min: 25, default: 50 };

// Given residential usable area (NUF) and a mix (share% + area per unit),
// derive how many units of each type fit.
export function computeMix(residentialNUF, mix) {
  const totalShare = mix.reduce((s, m) => s + (Number(m.share) || 0), 0) || 1;
  const rows = mix.map((m) => {
    const share = (Number(m.share) || 0) / totalShare;
    const area = Number(m.area) || unitInfo(m.type).default;
    const count = Math.max(0, Math.floor((residentialNUF * share) / area));
    return { ...m, area, share: Number(m.share) || 0, count, livingArea: count * area };
  });
  const units = rows.reduce((s, r) => s + r.count, 0);
  const livingArea = rows.reduce((s, r) => s + r.livingArea, 0);
  return { rows, units, livingArea, avg: units ? livingArea / units : 0 };
}

const ok = (cond) => (cond ? "pass" : "fail");

// Dritter Status: „Regel nicht hinterlegt" ist NICHT dasselbe wie „Regel verletzt"
// und zählt deshalb weder als erfüllt noch als Hinweis in den Score (E-2).
export const UNCHECKED = "nicht_geprueft";

// [ASSUMED] Fahrradstellplätze je Wohneinheit — landes-/satzungsabhängig,
// über den Parameter `bikesPerUnit` überschreibbar.
export const BIKES_PER_UNIT = 2;

// Zahl oder null: leere Eingaben dürfen NICHT als 0 durchrutschen.
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const de2 = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Evaluate a checklist of building-code style rules.
// Rückgabe: {items, score, checked, total, unchecked, fails, warns, verdict, …}
// `score` ist null, wenn keine einzige Regel geprüft werden konnte.
export function checkCompliance(p) {
  const {
    siteArea, footprint, bgf,
    parkKey = 1.0, gfzLimit = 1.2, maxFloors = 8, mixRows = [],
    bikesPerUnit = BIKES_PER_UNIT,
  } = p;
  // Nullbare Eingaben — ohne Wert gilt „nicht geprüft", kein stiller Default.
  const grzLimit = numOrNull(p.grzLimit);
  const parkingProvided = numOrNull(p.parkingProvided);
  const bikesProvided = numOrNull(p.bikesProvided);
  const barrierFreeProvided = numOrNull(p.barrierFreeProvided);
  // CO-01/CO-02: Geometrie-Eingaben ebenfalls nullbar — ohne Geschosse/WE darf weder
  // „fail" behauptet noch NaN in einen Detailtext geschrieben werden.
  const floors = numOrNull(p.floors);
  const units = numOrNull(p.units);
  // Aufzug: explizit (true/false) oder aus der Geschossigkeit abgeleitet (LBO-abhängig).
  const lift = typeof p.hasLift === "boolean" ? p.hasLift : aufzugPflicht(floors ?? 0, p.okf ?? 0);
  const barrierFreeRequired = units === null || floors === null
    ? null
    : erfBarrierefreiErreichbar(units, floors, lift);

  const grz = siteArea ? footprint / siteArea : 0;
  const gfz = siteArea ? bgf / siteArea : 0;
  const parkingRequired = units === null ? null : Math.ceil(units * parkKey);
  const bikesRequired = units === null ? null : Math.ceil(units * bikesPerUnit);
  const dominant = mixRows.length && units !== null ? Math.max(...mixRows.map((r) => r.count)) / Math.max(1, units) : 0;
  const tooSmall = mixRows.filter((r) => r.count > 0 && r.area < unitInfo(r.type).min);

  const items = [
    {
      key: "grz", label: "GRZ (Grundflächenzahl)",
      status: grzLimit === null ? UNCHECKED : ok(grz <= grzLimit + 1e-6),
      detail: grzLimit === null
        ? `${de2(grz)} vorhanden — keine GRZ-Grenze hinterlegt (§17 BauNVO / B-Plan)`
        : `${de2(grz)} / max ${de2(grzLimit)} (§17 BauNVO)`,
    },
    { key: "gfz", label: "GFZ (Geschossflächenzahl)", status: ok(gfz <= gfzLimit + 1e-6), detail: `${de2(gfz)} / max ${de2(gfzLimit)}` },
    {
      key: "floors", label: "Geschossigkeit",
      status: floors === null ? UNCHECKED : ok(floors <= maxFloors),
      detail: floors === null
        ? `max ${maxFloors} Geschosse zulässig — Geschossanzahl nicht erfasst`
        : `${floors} / max ${maxFloors} Geschosse`,
    },
    {
      key: "parking", label: "KFZ-Stellplätze",
      status: parkingRequired === null || parkingProvided === null ? UNCHECKED : ok(parkingProvided >= parkingRequired),
      detail: parkingRequired === null
        ? `Schlüssel ${de2(parkKey)} je WE — Wohneinheiten nicht erfasst`
        : parkingProvided === null
          ? `${parkingRequired} erf. (Schlüssel ${de2(parkKey)}) — vorhandene Stellplätze nicht erfasst`
          : `${parkingProvided} vorh. / ${parkingRequired} erf. (Schlüssel ${de2(parkKey)})`,
    },
    {
      key: "bikes", label: "Fahrradstellplätze",
      status: bikesRequired === null || bikesProvided === null ? UNCHECKED : ok(bikesProvided >= bikesRequired),
      detail: bikesRequired === null
        ? `${bikesPerUnit} je WE — Wohneinheiten nicht erfasst`
        : bikesProvided === null
          ? `${bikesRequired} erf. (${bikesPerUnit} je WE) — vorhandene Fahrradstellplätze nicht erfasst`
          : `${bikesProvided} vorh. / ${bikesRequired} erf. (${bikesPerUnit} je WE)`,
    },
    { key: "minsize", label: "Mindestwohnungsgrößen", status: ok(tooSmall.length === 0), detail: tooSmall.length ? `${tooSmall.length} Typ(en) unter Mindestgröße` : "alle Typen ≥ Mindestgröße" },
    { key: "mix", label: "Wohnungsmix-Vielfalt", status: dominant > 0.7 ? "warn" : "pass", detail: `größter Typ ${Math.round(dominant * 100)} % (Ziel ≤ 70 %)` },
    {
      key: "barrierfree", label: "Barrierefreiheit",
      status: barrierFreeRequired === null || barrierFreeProvided === null ? UNCHECKED : ok(barrierFreeProvided >= barrierFreeRequired),
      detail: barrierFreeRequired === null
        ? "Wohneinheiten bzw. Geschossanzahl nicht erfasst (DIN 18040 / MBO §50)"
        : barrierFreeProvided === null
          ? `${barrierFreeRequired} WE barrierefrei erreichbar erf. (${lift ? "mit" : "ohne"} Aufzug, DIN 18040 / MBO §50) — vorhandene nicht erfasst`
          : `${barrierFreeProvided} vorh. / ${barrierFreeRequired} erf. (${lift ? "mit" : "ohne"} Aufzug, DIN 18040 / MBO §50)`,
    },
  ];

  return summarize(items, { grz, gfz, parkingRequired, bikesRequired, barrierFreeRequired, lift });
}

// Score + Verdikt aus einer Item-Liste. Nenner = tatsächlich geprüfte Regeln.
function summarize(items, extra) {
  const total = items.length;
  const checkedItems = items.filter((i) => i.status !== UNCHECKED);
  const checked = checkedItems.length;
  const unchecked = total - checked;
  const passes = checkedItems.filter((i) => i.status === "pass").length;
  const fails = checkedItems.filter((i) => i.status === "fail").length;
  const warns = checkedItems.filter((i) => i.status === "warn").length;
  const score = checked ? Math.round((passes / checked) * 100) : null;
  const verdict =
    checked === 0 ? "nicht geprüft"
      : fails > 0 ? "nicht konform"
        : warns > 0 ? "konform mit Hinweisen"
          : unchecked > 0 ? "konform, soweit geprüft"
            : "konform";
  return { items, score, checked, total, unchecked, passes, fails, warns, verdict, ...extra };
}

export const STATUS_STYLE = {
  pass: { color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "OK" },
  warn: { color: "bg-amber-100 text-amber-800", dot: "bg-amber-500", label: "Hinweis" },
  fail: { color: "bg-rose-100 text-rose-700", dot: "bg-rose-500", label: "Nicht erfüllt" },
  [UNCHECKED]: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-300", label: "nicht geprüft" },
};
