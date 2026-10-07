import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Cpu, Radio, Video, Wifi } from "lucide-react";
import { getTelemetryConfig, createSource } from "@/lib/telemetry";

const SOURCES = [
  { id: "simulation", label: "Simulation", icon: Cpu },
  { id: "mqtt", label: "MQTT-Broker", icon: Radio },
  { id: "webrtc", label: "WebRTC-Video", icon: Video },
];

const statusBadge = {
  connected: "bg-emerald-100 text-emerald-800",
  ready: "bg-emerald-100 text-emerald-800",
  connecting: "bg-blue-100 text-blue-800",
  not_configured: "bg-slate-100 text-slate-600",
  package_missing: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
};

export default function TelemetryPanel() {
  const [config, setConfig] = useState(null);
  const [active, setActive] = useState("simulation");
  const [status, setStatus] = useState({ status: "connected", detail: "Lokale Simulation aktiv" });
  const videoRef = useRef(null);

  useEffect(() => {
    getTelemetryConfig().then((c) => {
      setConfig(c);
      setActive(c.source || "simulation");
    });
  }, []);

  const connect = async (kind) => {
    setActive(kind);
    const src = createSource(kind, config);
    const res = await src.connect({
      videoEl: videoRef.current,
      onStatus: (s) => setStatus((p) => ({ ...p, status: s })),
    });
    setStatus(res);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wifi className="w-4 h-4" /> Telemetrie-Quelle
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <Button key={s.id} size="sm" variant={active === s.id ? "default" : "outline"} onClick={() => connect(s.id)}>
              <s.icon className="w-4 h-4 mr-1" /> {s.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Status</span>
          <Badge className={statusBadge[status.status] || "bg-slate-100 text-slate-600"}>{status.status}</Badge>
        </div>
        <p className="text-xs text-slate-500">{status.detail}</p>

        {config && (active === "mqtt" || active === "webrtc") && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1 font-mono">
            {active === "mqtt" ? (
              <>
                <div>URL: {config.mqtt?.url || "— (MQTT_URL setzen)"}</div>
                <div>Telemetrie: {config.mqtt?.topicTelemetry}</div>
                <div>Befehle: {config.mqtt?.topicCommand}</div>
              </>
            ) : (
              <div>Signaling: {config.webrtc?.signalingUrl || "— (WEBRTC_SIGNALING_URL setzen)"}</div>
            )}
          </div>
        )}

        {active === "webrtc" && (
          <video ref={videoRef} autoPlay muted playsInline className="w-full rounded-lg bg-slate-900 aspect-video" />
        )}

        <p className="text-[11px] text-slate-400">
          Aktiv läuft die lokale Simulation. MQTT/WebRTC sind vorbereitet — Broker/Gateway in <code>.env</code> setzen
          (siehe <code>.env.example</code>), für MQTT zusätzlich <code>npm i mqtt</code>.
        </p>
      </CardContent>
    </Card>
  );
}
