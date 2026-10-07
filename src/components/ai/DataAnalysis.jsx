import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Textarea } from "@core/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { FileCheck, Loader2, Sparkles } from "lucide-react";
import { InvokeLLM } from "@core/integrations/Core";

// Free-form AI data analysis console backed by the LLM proxy.
export default function DataAnalysis({ agents = [] }) {
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [input, setInput] = useState(
    "Analysiere die Kostenentwicklung dieses Wohnbauprojekts und nenne 3 Optimierungspotenziale."
  );
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const analyze = async () => {
    setLoading(true);
    setOutput("");
    const agent = agents.find((a) => a.id === agentId);
    const prompt =
      `Du bist ${agent?.name || "ein Analyse-Agent"} (${agent?.specialty || "Datenanalyse"}). ` +
      `Analysiere die folgende Eingabe und liefere eine strukturierte, fachliche Auswertung:\n\n${input}`;
    try {
      const res = await InvokeLLM({ prompt, add_context_from_internet: false });
      setOutput(typeof res === "string" ? res : JSON.stringify(res, null, 2));
    } catch {
      setOutput("Fehler bei der Analyse.");
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck className="w-4 h-4" /> KI-Datenanalyse
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-[1fr_2fr] gap-3">
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger>
              <SelectValue placeholder="Agent wählen..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-slate-500 self-center">
            Wähle einen Agenten und beschreibe die zu analysierenden Daten/Frage.
          </div>
        </div>
        <Textarea
          rows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button onClick={analyze} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          {loading ? "Analysiere..." : "Analysieren"}
        </Button>
        {output && (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap">
            {output}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
