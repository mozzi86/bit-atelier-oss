// einladung/index.ts — invite or revoke an EXTERNAL person (Phase 74-01 Task 9).
//
// POST { aktion: 'einladen', org_id, email, rolle: 'bidder'|'investor'|'gast',
//        projekt_id, vergabe_id?, kontakt_id?, gueltig_bis?, weiterleitung? }
//   → finds the account (page by page) or invites it (inviteUserByEmail),
//     writes org_members with the flags FIXED BY THE ROLE (never from the
//     request), projekt_zugang, vergabe_teilnehmer, and logs 'einladung'.
// POST { aktion: 'widerruf', org_id, email, projekt_id?, vergabe_id? }
//   → removes project access / tender participation (all of the org without
//     ids), sets the membership to 'gast' without rights, logs 'widerruf'.
//
// Owner only (A-36: planner → 403). An internal member is never turned into
// an external one (the role sets stay disjoint, 0006). Internal roles are
// granted by scripts/zugang-freischalten.mjs, not here.
//
// The service role writes (the tables have no client DML grant, 0007). The
// tender named by vergabe_id must be a Tender of that org AND that project.
//
// Deno notes: see _shared/auth.ts. Not deployed (deploy only after the
// user's yes; checked locally with `deno check`).

import { adminClient, AuthFehler, mitgliedFuerOrg, protokollieren } from "../_shared/auth.ts";
import { fehlerAntwort, jsonAntwort, optionsAntwort } from "../_shared/cors.ts";
import { einladungErlaubt, einladungPruefen, mitgliedschaftFuerExterne } from "../_shared/zugriffRegeln.js";

/** Users per admin listUsers page. */
const SEITE = 1000;

/**
 * Finds an auth user by e-mail (case-insensitive), page by page.
 * @returns {Promise<{ id: string } | null>}
 */
async function nutzerSuchen(email: string): Promise<{ id: string } | null> {
  const admin = adminClient();
  for (let seite = 1; seite <= 100; seite += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page: seite, perPage: SEITE });
    if (error) throw new AuthFehler(`Nutzerliste nicht lesbar: ${error.message}`, 500);
    const liste = data?.users ?? [];
    const treffer = liste.find((u) => String(u.email ?? "").toLowerCase() === email);
    if (treffer) return { id: treffer.id };
    if (liste.length < SEITE) return null;
  }
  throw new AuthFehler("Mehr als 100 Seiten Nutzer — Suche abgebrochen.", 500);
}

/** The tender must exist in this org and belong to the named project. */
async function vergabePruefen(orgId: string, vergabeId: string, projektId: string): Promise<void> {
  const { data, error } = await adminClient()
    .from("records")
    .select("id, data")
    .eq("org_id", orgId)
    .eq("entity", "Tender")
    .eq("id", vergabeId)
    .maybeSingle() as { data: { id: string; data: Record<string, unknown> } | null; error: { message: string } | null };
  if (error) throw new AuthFehler(`Vergabe nicht lesbar: ${error.message}`, 500);
  if (!data || String(data.data?.project_id ?? "") !== projektId) {
    throw new AuthFehler("Vorgang nicht zulässig oder nicht gefunden", 404);
  }
}

/** Throws a plain-text 500 for a failed write. */
function pruefe(error: { message: string } | null, was: string): void {
  if (error) throw new AuthFehler(`${was} fehlgeschlagen: ${error.message}`, 500);
}

async function einladen(akteur: string, d: Record<string, any>, weiterleitung: string | null): Promise<unknown> {
  const admin = adminClient();
  if (d.vergabeId) await vergabePruefen(d.orgId, d.vergabeId, d.projektId);

  let nutzer = await nutzerSuchen(d.email);
  let eingeladen = false;
  if (!nutzer) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(d.email, weiterleitung ? { redirectTo: weiterleitung } : undefined);
    if (error || !data?.user?.id) throw new AuthFehler(`Einladung fehlgeschlagen: ${error?.message ?? "keine Nutzer-ID"}`, 500);
    nutzer = { id: data.user.id };
    eingeladen = true;
  }

  const { data: bestehend, error: lesen } = await admin
    .from("org_members").select("role").eq("user_id", nutzer.id).eq("org_id", d.orgId)
    .maybeSingle() as { data: { role: string } | null; error: { message: string } | null };
  pruefe(lesen, "Mitgliedschaft lesen");
  const erlaubt = einladungErlaubt(bestehend);
  if (!erlaubt.ok) throw new AuthFehler(erlaubt.grund ?? "Nicht erlaubt", 409);

  const mitgliedschaft = {
    user_id: nutzer.id,
    org_id: d.orgId,
    ...mitgliedschaftFuerExterne(d.rolle),
    kontakt_id: d.kontaktId,
    eingeladen_von: akteur,
    eingeladen_am: new Date().toISOString(),
  };
  const m = await admin.from("org_members").upsert(mitgliedschaft as never, { onConflict: "user_id,org_id" });
  pruefe(m.error, "Mitgliedschaft schreiben");

  const z = await admin.from("projekt_zugang").upsert({
    org_id: d.orgId, user_id: nutzer.id, projekt_id: d.projektId, rolle: d.rolle,
    gueltig_bis: d.gueltigBis, angelegt_von: akteur,
  } as never, { onConflict: "org_id,user_id,projekt_id" });
  pruefe(z.error, "Projektzugang schreiben");

  if (d.vergabeId) {
    const v = await admin.from("vergabe_teilnehmer").upsert({
      org_id: d.orgId, user_id: nutzer.id, vergabe_id: d.vergabeId, projekt_id: d.projektId, kontakt_id: d.kontaktId,
    } as never, { onConflict: "org_id,user_id,vergabe_id" });
    pruefe(v.error, "Vergabeteilnahme schreiben");
  }

  await protokollieren({
    orgId: d.orgId, projektId: d.projektId, aktion: "einladung", entity: "org_members", recordId: nutzer.id,
    detail: { rolle: d.rolle, vergabe_id: d.vergabeId, neu_eingeladen: eingeladen }, akteur,
  });
  return { nutzer_id: nutzer.id, eingeladen, rolle: d.rolle };
}

async function widerrufen(akteur: string, d: Record<string, any>): Promise<unknown> {
  const admin = adminClient();
  const nutzer = await nutzerSuchen(d.email);
  if (!nutzer) return { geaendert: false };
  const { data: bestehend, error: lesen } = await admin
    .from("org_members").select("role").eq("user_id", nutzer.id).eq("org_id", d.orgId)
    .maybeSingle() as { data: { role: string } | null; error: { message: string } | null };
  pruefe(lesen, "Mitgliedschaft lesen");
  if (!bestehend) return { geaendert: false };
  if (!einladungErlaubt(bestehend).ok) {
    throw new AuthFehler("Interne Mitglieder werden mit dem Freischalt-Skript entzogen, nicht hier.", 409);
  }

  let v = admin.from("vergabe_teilnehmer").delete().eq("org_id", d.orgId).eq("user_id", nutzer.id);
  if (d.vergabeId) v = v.eq("vergabe_id", d.vergabeId);
  pruefe((await v).error, "Vergabeteilnahme löschen");
  if (!d.vergabeId) {
    let p = admin.from("projekt_zugang").delete().eq("org_id", d.orgId).eq("user_id", nutzer.id);
    if (d.projektId) p = p.eq("projekt_id", d.projektId);
    pruefe((await p).error, "Projektzugang löschen");
  }
  // Nothing left at all → the membership stays as a powerless 'gast' (the
  // account and its own rows remain; deleting them is the operator's call).
  if (!d.vergabeId && !d.projektId) {
    const m = await admin.from("org_members").update({
      ...mitgliedschaftFuerExterne("gast"),
    } as never).eq("org_id", d.orgId).eq("user_id", nutzer.id);
    pruefe(m.error, "Rolle zurücksetzen");
  }
  await protokollieren({
    orgId: d.orgId, projektId: d.projektId, aktion: "widerruf", entity: "org_members", recordId: nutzer.id,
    detail: { vergabe_id: d.vergabeId, alles: !d.vergabeId && !d.projektId }, akteur,
  });
  return { geaendert: true };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return optionsAntwort(req);
  try {
    if (req.method !== "POST") throw new AuthFehler("Nur POST unterstützt", 405);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new AuthFehler("Ungültiger JSON-Body", 400);
    }
    const geprueft = einladungPruefen(body);
    // The org gate runs before the validation answer, so a stranger learns
    // nothing about which fields would be accepted.
    const mitglied = await mitgliedFuerOrg(req, body.org_id ? String(body.org_id) : null);
    if (mitglied.rolle !== "owner") throw new AuthFehler("Nur der Inhaber des Büros lädt ein.", 403);
    if (!geprueft.ok) throw new AuthFehler(geprueft.fehler, 400);
    const d = geprueft.daten;
    const weiterleitung = typeof body.weiterleitung === "string" && /^https:\/\/[^\s]+$/.test(body.weiterleitung)
      ? body.weiterleitung : null;
    const ergebnis = d.aktion === "einladen"
      ? await einladen(mitglied.userId, d, weiterleitung)
      : await widerrufen(mitglied.userId, d);
    return jsonAntwort(req, ergebnis, 200);
  } catch (err) {
    return fehlerAntwort(req, err, "einladung");
  }
});
