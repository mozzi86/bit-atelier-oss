import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import { Workflow, Plus, ArrowRight, Play, Loader2, Trash2 } from "lucide-react";
import { InvokeLLM } from "@core/integrations/Core";

// Build a sequential agent pipeline and "run" it via the LLM proxy.
export default function WorkflowBuilder({ agents = [] }) {
  const [name, setName] = useState("Neuer Workflow");
  const [steps, setSteps] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");

  const addStep = (agent) => setSteps((s) => [...s, agent]);
  const removeStep = (i) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const runWorkflow = async () => {
    if (steps.length === 0) return;
    setRunning(true);
    setResult("");
    const prompt =
      `Du orchestrierst einen Bau-/Architektur-Workflow namens "${name}". ` +
      `Die folgenden KI-Agenten laufen nacheinander: ` +
      steps.map((s, i) => `${i + 1}. ${s.name} (${s.specialty})`).join(", ") +
      `. Beschreibe in kurzen Schritten, was dieser Workflow konkret produziert und welches Ergebnis am Ende steht.`;
    try {
      const res = await InvokeLLM({ prompt, add_context_from_internet: false });
      setResult(typeof res === "string" ? res : JSON.stringify(res, null, 2));
    } catch {
      setResult("Fehler beim Ausführen des Workflows.");
    }
    setRunning(false);
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Agent palette */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agenten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {agents.map((a) => (
            <Button
              key={a.id}
              variant="outline"
              className="w-full justify-start"
              onClick={() => addStep(a)}
            >
              <Plus className="w-4 h-4 mr-2" />
              {a.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Pipeline */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="w-4 h-4" /> Workflow
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} />

          {steps.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center border border-dashed rounded-lg">
              Füge Agenten hinzu, um eine Pipeline zu erstellen.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {steps.map((s, i) => (
                <React.Fragment key={i}>
                  <Badge className="bg-indigo-100 text-indigo-800 py-1.5 pl-3 pr-2 flex items-center gap-1">
                    {s.name}
                    <button onClick={() => removeStep(i)} className="hover:text-red-600">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </Badge>
                  {i < steps.length - 1 && <ArrowRight className="w-4 h-4 text-slate-400" />}
                </React.Fragment>
              ))}
            </div>
          )}

          <Button onClick={runWorkflow} disabled={running || steps.length === 0}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {running ? "Läuft..." : "Workflow ausführen"}
          </Button>

          {result && (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap">
              {result}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
