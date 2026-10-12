import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import {
  Plug, KeyRound, Loader2, CheckCircle2, XCircle, Trash2, Pencil,
  ShieldCheck, Zap, ListRestart, Cpu,
} from "lucide-react";
import { toast } from "sonner";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
// 83-03: presets (Anthropic, OpenAI, Gemini, Mistral, OpenRouter, Groq, DeepSeek,
// Qwen, LM Studio, Ollama, custom) and the endpoint rule live in ONE module that
// the server's llm.js uses too — the hint "Anfragen gehen an" shows exactly the
// URL the server will call.
import { KI_TYPEN, KI_VORLAGEN, endpunktUrl, vorlageFuer } from "@core/lib/kiVorlagen";
// 93-12: local servers as first-class option — one-click presets, model discovery (/llm/modelle), a test
// with elapsed seconds and cancel (the first call of a local model loads it: minutes), reload when the
// server changed the list (pull finished, "Verwenden" in LokaleKi.jsx).
import { istLoopbackUrl } from "@core/lib/kiLokal";
import { VERBINDUNGEN_EVENT } from "@/lib/kiLokalApi";

/**
 * Default base URL per connection type. Resolves to the same endpoints as
 * llm.js PROVIDER_DEFAULTS (openai: with or without /v1 → …/v1/chat/completions).
 */
const TYP_STANDARD_URL = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1", ollama: "http://127.0.0.1:11434", custom: "" };

const EMPTY_FORM = { id: null, name: "", vorlage: "anthropic", provider: "anthropic", base_url: "https://api.anthropic.com", model: "", api_key: "", active: true };

// 57-04 Task 5: bitApi.apiFetch statt roh fetch — dieselben /llm/*-Pfade wie
// vorher, aber im Cloud-Modus über die Edge Function `llm` (JWT hängt
// supabase-js an; Keys bleiben serverseitig, Antworten maskiert).
// 80-03 (DEMO-JOURNEY-08): der Server antwortet manchmal mit `fehler` statt
// `error` (uneinheitlich gewachsen) — beide Felder lesen, statt auf „Fehler 503“
// zurückzufallen, wenn der Body eine deutsche Meldung trägt.
async function api(path, options = {}) {
  const res = await bitApi.apiFetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg = `Fehler ${res.status}`;
    try { const body = await res.json(); msg = body.error ?? body.fehler ?? msg; } catch { /* kein Body */ }
    throw new Error(msg);
  }
  return res.json();
}

export default function LlmConnections() {
  const { t } = useI18n();
  const [connections, setConnections] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [modelle, setModelle] = useState(/** @type {{ liste: string[], fehler?: string }|null} */ (null));
  const [suche, setSuche] = useState(false);
  const [testStart, setTestStart] = useState(/** @type {number|null} */ (null));
  const [, setTick] = useState(0);
  const testCtrl = React.useRef(/** @type {AbortController|null} */ (null));

  const reload = useCallback(async () => {
    try {
      setConnections(await api("/llm/connections"));
    } catch {
      toast.error(t("Verbindungen konnten nicht geladen werden"));
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    window.addEventListener(VERBINDUNGEN_EVENT, reload);
    return () => window.removeEventListener(VERBINDUNGEN_EVENT, reload);
  }, [reload]);
  // Elapsed seconds while a test runs.
  useEffect(() => {
    if (testStart == null) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [testStart]);

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  // A preset fills type + base URL; the model name stays the user's choice.
  const onVorlageChange = (id) => {
    const vorlage = KI_VORLAGEN.find((v) => v.id === id);
    setModelle(null);
    if (!vorlage) { set({ vorlage: "" }); return; }
    set({ vorlage: id, provider: vorlage.provider, base_url: vorlage.baseUrl });
  };

  // Model discovery: GET /v1/models (OpenAI-compatible) or /api/tags (Ollama), server-side.
  const modelleAbrufen = async (/** @type {Partial<typeof form>} */ werte = {}) => {
    const f = { ...form, ...werte };
    setSuche(true);
    setModelle(null);
    try {
      const body = { provider: f.provider, base_url: f.base_url, ...(f.id ? { id: f.id } : {}), ...(f.api_key ? { api_key: f.api_key } : {}) };
      const r = await api("/llm/modelle", { method: "POST", body: JSON.stringify(body) });
      setModelle({ liste: r.modelle || [], fehler: r.fehler });
      if (r.modelle?.length && !f.model) set({ model: r.modelle[0] });
    } catch (e) {
      setModelle({ liste: [], fehler: e.message });
    } finally {
      setSuche(false);
    }
  };

  // One click: preset + model list of the running local server.
  const lokalWaehlen = (/** @type {string} */ id) => {
    const vorlage = KI_VORLAGEN.find((v) => v.id === id);
    if (!vorlage) return;
    const werte = { vorlage: id, provider: vorlage.provider, base_url: vorlage.baseUrl, api_key: "", model: "" };
    set(werte);
    setTestResult(null);
    modelleAbrufen(werte);
  };

  const onProviderChange = (v) => {
    setModelle(null);
    const base_url = TYP_STANDARD_URL[v] ?? "";
    set({ provider: v, base_url, vorlage: vorlageFuer(v, base_url) });
  };

  const onBaseUrlChange = (base_url) => set({ base_url, vorlage: vorlageFuer(form.provider, base_url) });

  const vorlageMeta = KI_VORLAGEN.find((v) => v.id === form.vorlage) || null;
  const providerLabel = (v) => t(KI_TYPEN.find((p) => p.v === v)?.label || v);
  const istLokal = form.provider === "ollama" || Boolean(vorlageMeta?.lokal) || istLoopbackUrl(form.base_url);
  const testSekunden = testStart != null ? Math.round((Date.now() - testStart) / 1000) : 0;
  const modellBeispiel = vorlageMeta?.beispielModell || "mein-modell";
  // What the server will call — the same rule llm.js applies (empty base → type default).
  const zielUrl = endpunktUrl(form.provider, form.base_url.trim() || TYP_STANDARD_URL[form.provider] || "");

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestStart(Date.now());
    const ctrl = new AbortController();
    testCtrl.current = ctrl;
    try {
      const body = { ...form };
      delete body.vorlage; // form-only field, the server knows provider + base_url
      if (!body.api_key) delete body.api_key; // leer = gespeicherten Schlüssel nutzen
      if (!body.id) delete body.id;
      const r = await api("/llm/test", { method: "POST", body: JSON.stringify(body), signal: ctrl.signal });
      setTestResult(r);
      if (r.modelle?.length) setModelle({ liste: r.modelle });
    } catch (e) {
      setTestResult({ ok: false, fehler: e.name === "AbortError" ? t("Test abgebrochen.") : e.message });
    } finally {
      setTesting(false);
      setTestStart(null);
      testCtrl.current = null;
    }
  };

  const handleSave = async () => {
    if (!form.model.trim()) { toast.error(t("Bitte Modellname angeben")); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        provider: form.provider,
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        api_key: form.api_key, // leer = Schlüssel unverändert (bei Bearbeitung)
        active: form.active,
      };
      if (form.id) {
        await api(`/llm/connections/${form.id}`, { method: "PUT", body: JSON.stringify(body) });
        toast.success(t("Verbindung aktualisiert"));
      } else {
        await api("/llm/connections", { method: "POST", body: JSON.stringify(body) });
        toast.success(t("Verbindung gespeichert"));
      }
      setForm(EMPTY_FORM);
      setTestResult(null);
      await reload();
    } catch (e) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c) => {
    setForm({ id: c.id, name: c.name || "", vorlage: vorlageFuer(c.provider, c.base_url || ""), provider: c.provider, base_url: c.base_url || "", model: c.model || "", api_key: "", active: Boolean(c.active) });
    setTestResult(null);
  };

  const handleDelete = async (c) => {
    try {
      await api(`/llm/connections/${c.id}`, { method: "DELETE" });
      toast.success(t("Verbindung gelöscht"));
      if (form.id === c.id) setForm(EMPTY_FORM);
      await reload();
    } catch (e) {
      toast.error(`${t("Löschen fehlgeschlagen")}: ${e.message}`);
    }
  };

  const handleToggleActive = async (c) => {
    setTogglingId(c.id);
    try {
      await api(`/llm/connections/${c.id}`, { method: "PUT", body: JSON.stringify({ active: !c.active }) });
      await reload();
    } catch (e) {
      toast.error(`${t("Umschalten fehlgeschlagen")}: ${e.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  const inputCls = "mt-1 w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Formular */}
      <Card className="border border-slate-100 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="w-4 h-4 text-emerald-600" />
            {form.id ? t("Verbindung bearbeiten") : t("Eigenes KI-Modell / API verbinden")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-emerald-50/70 px-2.5 py-2 text-xs text-slate-700 dark:bg-emerald-950/20 dark:text-slate-200">
            <Cpu className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            <span>{t("Lokal auf diesem Rechner:")}</span>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" data-testid="ki-lokal-lmstudio" onClick={() => lokalWaehlen("lmstudio")}>LM Studio</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" data-testid="ki-lokal-ollama" onClick={() => lokalWaehlen("ollama")}>Ollama</Button>
          </div>
          <label className="block">
            <span className="text-xs text-slate-500">{t("Bezeichnung (optional)")}</span>
            <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("z. B. Büro-Claude")} />
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">{t("Vorlage")}</span>
            <select className={inputCls} value={form.vorlage} onChange={(e) => onVorlageChange(e.target.value)} data-testid="ki-vorlage">
              <option value="">{t("Ohne Vorlage (Werte von Hand)")}</option>
              {KI_VORLAGEN.map((v) => <option key={v.id} value={v.id}>{t(v.label)}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">{t("Verbindungstyp")}</span>
            <select className={inputCls} value={form.provider} onChange={(e) => onProviderChange(e.target.value)}>
              {KI_TYPEN.map((p) => <option key={p.v} value={p.v}>{t(p.label)}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">{t("Basis-URL")}</span>
            <input className={inputCls} data-testid="ki-basis-url" value={form.base_url} onChange={(e) => onBaseUrlChange(e.target.value)} placeholder={TYP_STANDARD_URL[form.provider] || "https://mein-server.de/v1"} />
            {zielUrl && (
              <span className="mt-1 block text-[11px] text-slate-400 break-all" data-testid="ki-ziel-url">
                {t("Anfragen gehen an:")} {zielUrl}
              </span>
            )}
          </label>

          <div className="block">
            <label className="block">
              <span className="text-xs text-slate-500">{t("Modellname")}</span>
              <input className={inputCls} value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder={t("z. B. {modell}").replace("{modell}", modellBeispiel)} data-testid="ki-modell" />
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => modelleAbrufen()} disabled={suche || form.provider === "anthropic"} data-testid="ki-modelle-abrufen">
                {suche ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListRestart className="w-3.5 h-3.5" />} {t("Modelle abrufen")}
              </Button>
              {modelle?.liste?.length > 0 && (
                <select className="h-7 rounded-md border border-slate-200 px-1.5 text-xs" value={modelle.liste.includes(form.model) ? form.model : ""} onChange={(e) => set({ model: e.target.value })} data-testid="ki-modell-liste" aria-label={t("Gefundene Modelle")}>
                  <option value="">{t("{n} Modelle gefunden — wählen").replace("{n}", String(modelle.liste.length))}</option>
                  {modelle.liste.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>
            {modelle?.fehler && <p className="mt-1 text-[11px] text-rose-700" data-testid="ki-modelle-fehler">{modelle.fehler}</p>}
          </div>

          <label className="block">
            <span className="text-xs text-slate-500 flex items-center gap-1"><KeyRound className="w-3 h-3" /> {t("API-Schlüssel")}{form.id ? ` ${t("(leer lassen = unverändert)")}` : ""}</span>
            <input type="password" autoComplete="off" className={inputCls} value={form.api_key} onChange={(e) => set({ api_key: e.target.value })} placeholder={istLokal ? t("Für lokale Server nicht erforderlich") : "sk-…"} />
          </label>

          {istLokal && (
            <p className="text-[11px] text-slate-400">
              {t("Läuft auf Ihrem Rechner — der lokale Server (LM Studio bzw. Ollama) muss gestartet und ein Modell geladen sein.")}
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700 pt-1 cursor-pointer">
            <input type="checkbox" className="accent-emerald-600 w-4 h-4" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            {t("Aktiv — dieses Modell für alle KI-Funktionen verwenden")}
          </label>

          <p className="text-[11px] text-slate-400 flex items-start gap-1.5 pt-1">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px text-emerald-600" />
            {t("Der Schlüssel wird lokal in Ihrer BIT-Atelier-Datenbank gespeichert und nie an Dritte übertragen.")}
          </p>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing} data-testid="ki-testen">
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              {testing ? `${t("Teste…")} ${testSekunden} s` : t("Verbindung testen")}
            </Button>
            {testing && (
              <Button variant="ghost" size="sm" onClick={() => testCtrl.current?.abort()} data-testid="ki-test-abbrechen">{t("Abbrechen")}</Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {form.id ? t("Aktualisieren") : t("Speichern")}
            </Button>
            {form.id && (
              <Button variant="ghost" size="sm" onClick={() => { setForm(EMPTY_FORM); setTestResult(null); }}>{t("Abbrechen")}</Button>
            )}
          </div>

          {testing && istLokal && testSekunden >= 5 && (
            <p className="text-[11px] text-slate-500" data-testid="ki-test-geduld">{t("Lokale Modelle brauchen beim ersten Aufruf oft Minuten, weil das Modell erst in den Speicher geladen wird.")}</p>
          )}
          {testResult && (
            <div data-testid="ki-test-ergebnis" className={`rounded-lg border px-3 py-2 text-sm ${testResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
              <div className="flex items-center gap-2 font-medium">
                {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testResult.ok ? t("Verbindung erfolgreich") : t("Verbindung fehlgeschlagen")}
                {typeof testResult.dauer_ms === "number" && <span className="text-xs font-normal opacity-70">({testResult.dauer_ms} ms)</span>}
              </div>
              {testResult.ok ? (
                <p className="text-xs mt-1">{t("Modell {modell}: „{antwort}\"").replace("{modell}", testResult.modell).replace("{antwort}", testResult.antwort)}</p>
              ) : (
                <p className="text-xs mt-1">{testResult.fehler}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bestehende Verbindungen */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-4">{t("Gespeicherte Verbindungen")}</h2>
        <div className="space-y-3">
          {connections.length === 0 && (
            <p className="text-sm text-slate-400">{t("Noch keine Verbindung — links ein eigenes Modell verbinden. Ohne aktive Verbindung nutzt BIT-Atelier das eingebaute Standardverhalten.")}</p>
          )}
          {connections.map((c) => (
            <Card key={c.id} className={`border shadow-sm ${c.active ? "border-emerald-300 bg-emerald-50/40" : "border-slate-100"}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{c.name || c.model || providerLabel(c.provider)}</span>
                      <Badge variant="outline" className="text-[10px]">{providerLabel(c.provider)}</Badge>
                      {c.active && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px]">{t("Aktiv")}</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 truncate">
                      {c.model || t("(kein Modell)")} · {c.base_url || t("Standard-URL")}
                      {c.has_api_key ? ` · ${t("Schlüssel")} ${c.api_key_masked}` : ` · ${t("ohne Schlüssel")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={togglingId === c.id} onClick={() => handleToggleActive(c)}>
                      {togglingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : c.active ? t("Deaktivieren") : t("Aktivieren")}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Verbindung bearbeiten")} onClick={() => handleEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700" aria-label={t("Verbindung löschen")} onClick={() => handleDelete(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
