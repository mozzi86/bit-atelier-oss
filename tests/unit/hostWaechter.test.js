// DNS-rebinding guard: only localhost, *.localhost, IP literals and configured names pass; a foreign
// domain resolving to 127.0.0.1 is refused with 421 before any route.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hostName, hostErlaubt, hostWaechter } from "../../server/hostWaechter.js";

describe("hostWaechter", () => {
  it("parses host names with ports and IPv6 brackets", () => {
    assert.equal(hostName("LOCALHOST:3001"), "localhost");
    assert.equal(hostName("[::1]:3001"), "::1");
    assert.equal(hostName("192.168.178.20:3001"), "192.168.178.20");
    assert.equal(hostName(""), "");
  });
  it("admits localhost, IP literals and configured names; refuses foreign domains", () => {
    for (const ok of ["localhost:3001", "127.0.0.1:3001", "[::1]:3001", "app.localhost:5173", "192.168.178.20:3001", "10.0.0.5"]) assert.equal(hostErlaubt(ok), true, ok);
    for (const nein of ["evil.example:3001", "127.0.0.1.evil.example", "localhost.evil.example", undefined, ""]) assert.equal(hostErlaubt(nein), false, String(nein));
    assert.equal(hostErlaubt("bit-server:3001", ["bit-server"]), true);
  });
  it("middleware answers 421 for a rebinding host and calls next otherwise", () => {
    const mw = hostWaechter({ extra: [] });
    let status = 0, weiter = false;
    const res = { status(s) { status = s; return this; }, type() { return this; }, send() { return this; } };
    mw({ headers: { host: "evil.example:3001" } }, res, () => { weiter = true; });
    assert.equal(status, 421); assert.equal(weiter, false);
    mw({ headers: { host: "localhost:3001" } }, res, () => { weiter = true; });
    assert.equal(weiter, true);
  });
});
