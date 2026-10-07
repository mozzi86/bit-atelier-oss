import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import { Bot, Loader2, Sparkles, ArrowRight } from "lucide-react";
import { InvokeLLM } from "@core/integrations/Core";
import { IMPACT_LABELS, labelFor } from "./labels";

const impactColors = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

// KI-Assistent der Machbarkeit: zeigt Optimierungsvorschläge und beantwortet Fragen
// zu den aktuellen Machbarkeitsdaten über den LLM-Proxy.
export default function AIAssistant({ suggestions = [], feasibilityData }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer("");
    const context = {
      parcel_area: feasibilityData?.site?.parcel_area,
      far: feasibilityData?.massing?.calculated_far,
      total_gfa: feasibilityData?.massing?.total_gfa,
      financials: feasibilityData?.financials,
    };
    const prompt =
      `Du bist ein Machbarkeits-Berater für Immobilienentwicklung. ` +
      `Hier sind die aktuellen Projektdaten: ${JSON.stringify(context)}. ` +
      `Beantworte die folgende Frage fachlich und konkret:\n\n${question}`;
    try {
      const res = await InvokeLLM({ prompt, add_context_from_internet: false });
      setAnswer(typeof res === "string" ? res : JSON.stringify(res, null, 2));
    } catch {
      setAnswer("Fehler bei der KI-Anfrage.");
    }
    setLoading(false);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-indigo-500" /> Optimierungsvorschläge
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggestions.map((s, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-slate-700">{s.message}</p>
                <Badge className={impactColors[s.impact] || ""}>{labelFor(IMPACT_LABELS, s.impact)}</Badge>
              </div>
              {s.action && (
                <Button variant="ghost" size="sm" className="mt-2 text-indigo-600 px-0 h-auto">
                  {s.action} <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          ))}
          {suggestions.length === 0 && (
            <p className="text-sm text-slate-500">Keine Vorschläge.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="w-4 h-4" /> Frag die KI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="z. B. Wie verbessere ich den ROI?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
            />
            <Button onClick={ask} disabled={loading || !question.trim()}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            </Button>
          </div>
          {answer && (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap">
              {answer}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
