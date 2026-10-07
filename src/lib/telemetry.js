// Telemetry abstraction — prepares real live data sources (MQTT / WebRTC) while
// the app currently runs on the local simulation. Switch the active source via
// the backend env (TELEMETRY_SOURCE) or the Telemetry panel.
//
// Contract every source implements:
//   connect(handlers?) -> Promise<{ status, detail }>
//   sendCommand(unitId, command) -> Promise<void>
//   disconnect() -> void
//
// handlers: { onUnitUpdate(unit), onEvent(text), onStatus(status) }


const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export async function getTelemetryConfig() {
  try {
    const r = await fetch(`${API_BASE}/telemetry/config`);
    return await r.json();
  } catch {
    return { source: "simulation", mqtt: {}, webrtc: {} };
  }
}

// The local simulation is the default, always-available source.
export class SimulationSource {
  constructor() {
    this.id = "simulation";
  }
  async connect() {
    return { status: "connected", detail: "Lokale Simulation (Digital Twin) aktiv" };
  }
  async sendCommand() {}
  disconnect() {}
}

// MQTT over WebSockets. Real brokers publish unit telemetry on `site/+/telemetry`
// and accept commands on `site/{unitId}/command`. Requires the `mqtt` package and
// a broker URL — scaffolded so it degrades gracefully until configured.
export class MqttSource {
  constructor(config) {
    this.id = "mqtt";
    this.config = config?.mqtt || {};
    this.client = null;
  }
  async connect(handlers = {}) {
    if (!this.config.url) {
      return { status: "not_configured", detail: "MQTT_URL nicht gesetzt (.env)" };
    }
    let mqtt;
    try {
      // Optional dependency — install with `npm i mqtt` to enable.
      // Variable specifier keeps the bundler from resolving it at build time.
      const pkg = "mqtt";
      mqtt = (await import(/* @vite-ignore */ pkg)).default;
    } catch {
      return { status: "package_missing", detail: "Paket 'mqtt' nicht installiert — `npm i mqtt`" };
    }
    try {
      this.client = mqtt.connect(this.config.url);
      this.client.on("connect", () => {
        this.client.subscribe(this.config.topicTelemetry);
        handlers.onStatus?.("connected");
      });
      this.client.on("message", (_topic, payload) => {
        try {
          handlers.onUnitUpdate?.(JSON.parse(payload.toString()));
        } catch {
          /* ignore malformed */
        }
      });
      this.client.on("error", (e) => handlers.onEvent?.(`MQTT-Fehler: ${e.message}`));
      return { status: "connecting", detail: `Verbinde mit ${this.config.url}` };
    } catch (e) {
      return { status: "error", detail: e.message };
    }
  }
  async sendCommand(unitId, command) {
    if (!this.client) return;
    const topic = (this.config.topicCommand || "site/{unitId}/command").replace("{unitId}", unitId);
    this.client.publish(topic, JSON.stringify(command));
  }
  disconnect() {
    this.client?.end?.();
    this.client = null;
  }
}

// WebRTC video from on-site cameras via a signaling gateway (e.g. RTSP→WebRTC).
export class WebRtcSource {
  constructor(config) {
    this.id = "webrtc";
    this.config = config?.webrtc || {};
    this.pc = null;
  }
  async connect({ videoEl } = {}) {
    if (!this.config.signalingUrl) {
      return { status: "not_configured", detail: "WEBRTC_SIGNALING_URL nicht gesetzt (.env)" };
    }
    try {
      this.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      this.pc.ontrack = (e) => {
        if (videoEl) videoEl.srcObject = e.streams[0];
      };
      // Signaling handshake would go here (offer/answer via this.config.signalingUrl).
      // Left as an integration point: connect a WHEP/WebSocket gateway and set remote SDP.
      return { status: "ready", detail: `Signaling bereit: ${this.config.signalingUrl}` };
    } catch (e) {
      return { status: "error", detail: e.message };
    }
  }
  async sendCommand() {}
  disconnect() {
    this.pc?.close?.();
    this.pc = null;
  }
}

export function createSource(kind, config) {
  if (kind === "mqtt") return new MqttSource(config);
  if (kind === "webrtc") return new WebRtcSource(config);
  return new SimulationSource();
}
