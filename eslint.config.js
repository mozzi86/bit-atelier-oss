// ESLint v9 Flat-Config für NovaConstruct (React + Vite, Browser + Node-Server).
import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";

// Phase 31: Paket-Grenzen (MOD-04) — Module importieren nur @core und sich selbst;
// @ava und @designer dürfen zusätzlich @ifc. `@/` ist App-only. Die
// `**/nova-<x>/**`-Gruppen fangen relative Ausbrüche ab (cross-package nur via Alias).
const forbid = (files, groups, message) => ({
  files,
  rules: {
    "no-restricted-imports": ["error", { patterns: [{ group: groups, message }] }],
  },
});

export default [
  // public/mapbox-gl-rtl-text.js: bewusst vendored Rohkopie (Worker lädt sie per
  // importScripts, darf nicht transformiert werden) — daher vom Linting ausgenommen.
  {
    ignores: [
      "dist/**", "dist-demo/**", "dist-lokal/**", "node_modules/**", "build.log", "lint.log", "typecheck.log",
      ".claude/**", ".planning/**", "public/mapbox-gl-rtl-text.js",
      // Phase 33 / W7: `parity/artifacts/` sind ERZEUGTE Artefakte (u. a. das
      // vollständig gebaute Kundenpaket aus Gate G20 mit eigenem node_modules
      // und dist/). Sie sind nicht eingecheckt und kein Prüfgegenstand von ESLint.
      "parity/artifacts/**",
      // Phase 67: the Python harness sidecar. Its venv vendors JS (pip/urllib3
      // emscripten worker) and its UI is a build-free HTML file — not ESLint's job.
      "harness/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "unused-imports": unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly",
        console: "readonly", fetch: "readonly", localStorage: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        URL: "readonly", URLSearchParams: "readonly", Blob: "readonly", File: "readonly", FileReader: "readonly",
        FormData: "readonly", AbortSignal: "readonly", AbortController: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        ResizeObserver: "readonly", IntersectionObserver: "readonly", MutationObserver: "readonly",
        BroadcastChannel: "readonly", DOMParser: "readonly", XMLSerializer: "readonly", Image: "readonly",
        // TextDecoder/TextEncoder sind in Browser UND Node seit Jahren Standard — der
        // GAEB-90-Leser braucht sie, um UTF-8 von CP437 zu unterscheiden.
        TextDecoder: "readonly", TextEncoder: "readonly",
        HTMLInputElement: "readonly", HTMLSelectElement: "readonly", MouseEvent: "readonly", WheelEvent: "readonly",
        KeyboardEvent: "readonly", Event: "readonly", CustomEvent: "readonly", btoa: "readonly", atob: "readonly",
        performance: "readonly", crypto: "readonly", alert: "readonly", WebSocket: "readonly", Audio: "readonly",
        getComputedStyle: "readonly", history: "readonly", location: "readonly", MediaStream: "readonly", RTCPeerConnection: "readonly",
        process: "readonly",
        // Phase 65-02: Demo-Persistenz und Projektdatei. indexedDB löst den
        // localStorage-Monolithen ab; structuredClone kopiert den Cache tief;
        // Compression-/DecompressionStream packen die .bitproj-Datei, Response
        // liest den Stream wieder aus. Alle vier sind Baseline in jedem Browser,
        // den die Demo unterstützt, und structuredClone gibt es auch in Node.
        indexedDB: "readonly", structuredClone: "readonly",
        CompressionStream: "readonly", DecompressionStream: "readonly", Response: "readonly",
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // JSX-Transform (React 17+): kein React-Import nötig
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      // Aufräumen: ungenutzte Importe/Variablen als Warnung (Politur), nicht Blocker
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["tailwind.config.js", "packages/*/shell/tailwind.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly", __dirname: "readonly", process: "readonly" },
    },
  },
  {
    files: ["server/**/*.js", "vite.config.js", "eslint.config.js", "packages/*/server/**/*.js", "packages/*/shell/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", __dirname: "readonly", Buffer: "readonly", fetch: "readonly", URL: "readonly", AbortSignal: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly" },
    },
  },
  {
    // Phase 33: Paritäts-Gates (parity/) und Einmal-Transformer (tools/) laufen
    // in Node. Beide sind Dev-Infrastruktur und verlassen das Monorepo nie.
    files: ["parity/**/*.mjs", "tools/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly", console: "readonly", __dirname: "readonly",
        Buffer: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
        TextDecoder: "readonly", TextEncoder: "readonly",
        // Phase 33 / W7: G18 und G20 starten den Server-Router bzw. das
        // Kundenpaket und sprechen ihn über HTTP an — dafür braucht der Gate-Code
        // `fetch` (Node ≥ 18) und `AbortSignal`.
        fetch: "readonly", AbortSignal: "readonly",
      },
    },
    rules: {
      // `const { psets, ...rest } = el` ist die saubere Art, ein Feld WEGZULASSEN —
      // genau dafür ist ignoreRestSiblings gedacht. (.mjs fällt nicht unter den
      // **/*.{js,jsx}-Block oben und braucht die Regel deshalb hier.)
      "no-unused-vars": ["error", {
        ignoreRestSiblings: true, args: "none",
        varsIgnorePattern: "^_", caughtErrors: "none",
      }],
    },
  },
  {
    // Playwright-Screenshot-Skripte: page.evaluate()-Callbacks laufen im Browser.
    files: ["scripts/screenshots.mjs", "scripts/optimize-screenshots.mjs"],
    languageOptions: {
      globals: { window: "readonly", document: "readonly", Image: "readonly" },
    },
  },
  // --- Phase 31: Boundary-Blöcke (MOD-04) ------------------------------------
  forbid(["packages/nova-core/**/*.{js,jsx}"],
    ["@ava/*", "@ifc/*", "@pdf/*", "@designer/*", "@sketch/*", "@/*",
     "**/nova-ausschreibung/**", "**/nova-ifc-viewer/**", "**/nova-pdf/**", "**/nova-designer/**", "**/bit-sketch/**"],
    "nova-core importiert nur aus sich selbst (@core/…)."),
  forbid(["packages/nova-ifc-viewer/**/*.{js,jsx}"],
    ["@ava/*", "@pdf/*", "@designer/*", "@sketch/*", "@/*", "**/nova-ausschreibung/**", "**/nova-pdf/**", "**/nova-designer/**", "**/bit-sketch/**"],
    "nova-ifc-viewer darf nur @core/ und sich selbst importieren."),
  forbid(["packages/nova-ausschreibung/**/*.{js,jsx}"],
    ["@pdf/*", "@designer/*", "@sketch/*", "@/*", "**/nova-pdf/**", "**/nova-designer/**", "**/bit-sketch/**"],
    "nova-ausschreibung darf nur @core/, @ifc/ und sich selbst importieren."),
  forbid(["packages/nova-pdf/**/*.{js,jsx}"],
    ["@ava/*", "@ifc/*", "@designer/*", "@sketch/*", "@/*", "**/nova-ausschreibung/**", "**/nova-ifc-viewer/**", "**/nova-designer/**", "**/bit-sketch/**"],
    "nova-pdf darf nur @core/ und sich selbst importieren."),
  forbid(["packages/nova-designer/**/*.{js,jsx}"],
    ["@ava/*", "@pdf/*", "@/*", "**/nova-ausschreibung/**", "**/nova-pdf/**"],
    "nova-designer darf nur @core/, @ifc/, @sketch/ und sich selbst importieren."),
  forbid(["packages/bit-sketch/**/*.{js,jsx}"],
    ["@ava/*", "@ifc/*", "@pdf/*", "@designer/*", "@/*",
     "**/nova-ausschreibung/**", "**/nova-ifc-viewer/**", "**/nova-pdf/**", "**/nova-designer/**"],
    "bit-sketch darf nur @core/ und sich selbst importieren."),
];
