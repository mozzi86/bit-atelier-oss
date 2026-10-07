import React from "react";

// Schwebender KI-Assistent-Button im Alhambra-Stil (emaillierte Brosche):
// goldener Kordel-Ring, tiefblauer Grund, 8-zackiger Terrakotta-Stern mit
// cremefarbener Kontur, Türkis-Punkte an den Spitzen, Türkis-Zentrum mit
// dezentem weißen Roboter-Symbol. Reine SVG-in-JSX-Komponente, kein Asset.

const C = 32; // Zentrum im 64er-ViewBox

// 8-zackiger Stern: 16 Punkte, außen/innen alternierend, Start oben.
function starPoints(rOuter, rInner) {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// Positionen der 8 Sternspitzen (für Türkis-Punkte).
function tipPositions(r) {
  const tips = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    tips.push([C + r * Math.cos(a), C + r * Math.sin(a)]);
  }
  return tips;
}

// Grüne Arabesken-Blättchen zwischen den Spitzen (auf den Innenwinkeln).
function leafPositions(r) {
  const leaves = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i + Math.PI / 8 - Math.PI / 2;
    leaves.push([C + r * Math.cos(a), C + r * Math.sin(a), (a * 180) / Math.PI + 90]);
  }
  return leaves;
}

const STAR = starPoints(17.5, 11);
const TIPS = tipPositions(17.5);
const LEAVES = leafPositions(21.5);

export default function AlhambraAssistantButton({ label = "KI-Assistent", onClick }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="group w-14 h-14 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 hover:shadow-[0_0_22px_rgba(212,165,69,0.55)] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      <svg viewBox="0 0 64 64" className="w-full h-full drop-shadow-md" role="img" aria-hidden="true">
        {/* Goldener Grundring */}
        <circle cx={C} cy={C} r={31} fill="#b8892f" />
        <circle cx={C} cy={C} r={30} fill="#d4a545" />
        {/* Kordel-Effekt: gedrehter gestrichelter Ring */}
        <circle cx={C} cy={C} r={28.6} fill="none" stroke="#8a621e" strokeWidth={2.4} strokeDasharray="2.6 2.2" strokeLinecap="round" />
        <circle cx={C} cy={C} r={28.6} fill="none" stroke="#f3d68a" strokeWidth={1} strokeDasharray="2.6 2.2" strokeDashoffset={1.3} strokeLinecap="round" />

        {/* Tiefblauer Emaille-Grund */}
        <circle cx={C} cy={C} r={26.2} fill="#27418f" stroke="#f2e4c8" strokeWidth={0.9} />
        <circle cx={C} cy={C} r={23.5} fill="none" stroke="#3a56a8" strokeWidth={0.8} opacity={0.8} />

        {/* Grüne Arabesken-Akzente zwischen den Sternspitzen */}
        {LEAVES.map(([x, y, rot], i) => (
          <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)})`}>
            <path d="M0,-2.6 C1.7,-0.9 1.7,1.1 0,2.6 C-1.7,1.1 -1.7,-0.9 0,-2.6 Z" fill="#2e7d4f" stroke="#f2e4c8" strokeWidth={0.5} />
          </g>
        ))}

        {/* 8-zackiger Stern in Terrakotta mit Creme-Kontur */}
        <polygon points={STAR} fill="#c96a2e" stroke="#f2e4c8" strokeWidth={1.2} strokeLinejoin="round" />
        <polygon points={starPoints(13.5, 8.5)} fill="none" stroke="#f2e4c8" strokeWidth={0.6} opacity={0.75} strokeLinejoin="round" />

        {/* Türkis-Punkte an den Sternspitzen */}
        {TIPS.map(([x, y], i) => (
          <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r={1.5} fill="#3ec6c9" stroke="#f2e4c8" strokeWidth={0.4} />
        ))}

        {/* Türkis-Zentrum */}
        <circle cx={C} cy={C} r={8.2} fill="#3ec6c9" stroke="#f2e4c8" strokeWidth={0.9} />
        <circle cx={C} cy={C} r={8.2} fill="none" stroke="#1e8f92" strokeWidth={0.6} opacity={0.6} />

        {/* Dezentes weißes Roboter-Symbol (Wiedererkennung) */}
        <g stroke="#ffffff" strokeWidth={1.3} strokeLinecap="round" fill="none">
          <line x1={C} y1={26.8} x2={C} y2={28.4} />
          <circle cx={C} cy={26.2} r={0.8} fill="#ffffff" stroke="none" />
          <rect x={27.2} y={28.4} width={9.6} height={7.4} rx={2.2} />
          <line x1={24.9} y1={31} x2={24.9} y2={33.4} />
          <line x1={39.1} y1={31} x2={39.1} y2={33.4} />
        </g>
        <circle cx={29.9} cy={31.8} r={1} fill="#ffffff" />
        <circle cx={34.1} cy={31.8} r={1} fill="#ffffff" />
        <line x1={30.3} y1={34} x2={33.7} y2={34} stroke="#ffffff" strokeWidth={0.9} strokeLinecap="round" />

        {/* Sanftes Aufleuchten beim Hover */}
        <circle cx={C} cy={C} r={26.2} fill="#ffffff" opacity={0} className="transition-opacity duration-300 group-hover:opacity-10" />
      </svg>
    </button>
  );
}
