// 87-01: before the run, put the "Review Testhaus" into its expected geometry (70 × 16 m,
// 4 storeys) and snapshot the whole record as the restore target of fixtures/base.js.
// Runs once per `playwright test`, after the webServer is up.
import { request } from "@playwright/test";
import { testhausSollSchreiben } from "./fixtures/testhaus.js";

export default async function globalSetup(config) {
  const baseURL = config.projects[0]?.use?.baseURL || "http://localhost:5173";
  const ctx = await request.newContext({ baseURL });
  try {
    const soll = await testhausSollSchreiben(ctx);
    console.log(`[testhaus] Soll gespeichert: ${soll.footprintM.length} Ecken, ${soll.storeys} Geschosse`);
  } finally {
    await ctx.dispose();
  }
}
