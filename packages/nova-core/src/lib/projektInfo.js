// Project facts every build shows (Plan 83-02, open source under MIT): where the
// source code lives, where problems are reported, which mail address receives
// feedback and which version is running.
//
// In:  ANBIETER.email (anbieter.js — the one place for operator data) and the
//      package.json version, injected by vite.config.js as `__APP_VERSION__`.
// Out: four constants. No network access, no side effects.

/* global __APP_VERSION__ */
import { ANBIETER } from './anbieter.js';

/** Public source repository (GitHub). Linked from the terms, the footer and every HTML report. */
export const REPO_URL = 'https://github.com/mozzi86/bit-atelier-oss';

/** Issue tracker of the repository; `${ISSUES_URL}/new` opens a new report. */
export const ISSUES_URL = `${REPO_URL}/issues`;

/** The BIT-Atelier app mail that receives feedback — the same address the imprint names. */
export const FEEDBACK_EMAIL = ANBIETER.email;

// `typeof` on an undeclared identifier is safe: under plain node (unit tests)
// there is no define, so the fallback applies. Vite replaces the identifier
// itself, so in every build this folds to a string literal.
// @ts-ignore -- injected by vite.config.js `define`; deliberately undeclared for node
const VERSION_AUS_BUILD = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

/** Version of the running build (package.json `version`); 'dev' outside a Vite build. */
export const APP_VERSION = VERSION_AUS_BUILD || 'dev';
