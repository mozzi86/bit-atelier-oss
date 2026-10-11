// 87-02: the JSON-DB debounces writes (120 ms) and flushed only on `process.on('exit')`.
// A SIGINT / SIGTERM (Ctrl-C, concurrently --kill-others) does not fire `exit` on every
// path, so the last write could be lost. createDb now also flushes on those signals —
// without exiting (the composition root decides about exiting).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "../../packages/nova-core/server/db.js";

describe("87-02 — JSON-DB flusht bei Signalen", () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    it(`${signal}: ausstehender Debounce-Write liegt danach auf der Platte`, () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-db-"));
      const pfad = path.join(tmp, "db.json");
      const vorher = process.listenerCount(signal);
      const db = createDb(pfad);
      assert.equal(process.listenerCount(signal), vorher + 1, "ein Handler je Signal registriert");
      const rec = db.create("Probe", { name: "noch nicht geschrieben" });
      assert.ok(rec?.id);
      const sofort = fs.existsSync(pfad) ? JSON.parse(fs.readFileSync(pfad, "utf8")) : {};
      assert.ok(!(sofort.Probe || []).some((r) => r.id === rec.id), "vor dem Debounce noch nicht auf der Platte");
      // Only the listeners run — process.emit does not deliver a real signal. The db
      // re-raises the signal when it is the LAST listener; a dummy listener keeps the
      // test process alive.
      const halter = () => {};
      process.on(signal, halter);
      try {
        process.emit(signal);
      } finally {
        process.off(signal, halter);
      }
      const danach = JSON.parse(fs.readFileSync(pfad, "utf8"));
      assert.ok((danach.Probe || []).some((r) => r.id === rec.id), "nach dem Signal geschrieben");
      // Every createDb registers BOTH signals, so an earlier db in this process leaves its
      // listener for the other signal behind — it fires and removes itself here as well.
      assert.ok(process.listenerCount(signal) <= vorher, "die Handler räumen sich nach dem Signal weg (once)");
    });
  }
});
