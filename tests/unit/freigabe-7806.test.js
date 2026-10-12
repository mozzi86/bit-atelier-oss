// Unit tests for 78-06 (HOHEIT-07): scripts/freigabe.mjs moves `produktion` only by fast-forward to a
// commit on main, tags it annotated (freigabe-YYYY-MM-DD[-n]), refuses diverged branches, dirty trees
// and commits outside main, and never pushes. Runs against a throw-away git repo (--ohne-gates).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tagName, argumente, freigeben } from "../../scripts/freigabe.mjs";

let repo;
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (datei, inhalt) => { fs.writeFileSync(path.join(repo, datei), inhalt); git("add", datei); git("commit", "-q", "-m", datei); return git("rev-parse", "HEAD"); };
const TAG = new Date(2026, 9, 12);
const leise = () => {};

describe("78-06 freigabe.mjs", () => {
  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "freigabe-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false"); git("config", "tag.gpgsign", "false");
    commit("a.txt", "1");
  });
  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("tag names count up within a day", () => {
    assert.equal(tagName(TAG, []), "freigabe-2026-10-12");
    assert.equal(tagName(TAG, ["freigabe-2026-10-12"]), "freigabe-2026-10-12-2");
    assert.equal(tagName(TAG, ["freigabe-2026-10-12", "freigabe-2026-10-12-2"]), "freigabe-2026-10-12-3");
    assert.deepEqual(argumente(["--commit", "abc", "--notiz", "x", "--ohne-gates"]), { commit: "abc", notiz: "x", ohneGates: true, trocken: false });
    assert.throws(() => argumente(["--push"]), /Unbekannte Option/);
  });

  it("first release creates produktion and an annotated tag, prints but does not push", () => {
    const r = freigeben({ commit: "main", notiz: "erste", ohneGates: true, trocken: false }, { cwd: repo, jetzt: TAG, log: leise });
    assert.equal(r.neuerZweig, true);
    assert.equal(git("rev-parse", "produktion"), git("rev-parse", "main"));
    assert.equal(git("cat-file", "-t", r.tag), "tag", "annotated, not lightweight");
    assert.match(git("tag", "-l", "--format=%(contents)", r.tag), /Commit: [0-9a-f]{40}[\s\S]*erste/);
    assert.equal(r.pushBefehl, "git push origin produktion freigabe-2026-10-12");
  });

  it("dry run changes nothing; the next release fast-forwards and counts the tag", () => {
    const neu = commit("b.txt", "2");
    const vorher = git("rev-parse", "produktion");
    const t = freigeben({ commit: "main", notiz: "", ohneGates: true, trocken: true }, { cwd: repo, jetzt: TAG, log: leise });
    assert.equal(t.tag, "freigabe-2026-10-12-2");
    assert.equal(git("rev-parse", "produktion"), vorher);
    freigeben({ commit: "main", notiz: "", ohneGates: true, trocken: false }, { cwd: repo, jetzt: TAG, log: leise });
    assert.equal(git("rev-parse", "produktion"), neu);
  });

  it("refuses a dirty tree, a commit outside main and a diverged produktion", () => {
    fs.writeFileSync(path.join(repo, "a.txt"), "geändert");
    assert.throws(() => freigeben({ commit: "main", notiz: "", ohneGates: true, trocken: true }, { cwd: repo, log: leise }), /geänderte Dateien/);
    git("checkout", "-q", "--", "a.txt");
    git("checkout", "-q", "-b", "seite"); const seite = commit("c.txt", "3"); git("checkout", "-q", "main");
    assert.throws(() => freigeben({ commit: seite, notiz: "", ohneGates: true, trocken: true }, { cwd: repo, log: leise }), /nicht auf main/);
    git("branch", "-f", "produktion", seite);
    assert.throws(() => freigeben({ commit: "main", notiz: "", ohneGates: true, trocken: false }, { cwd: repo, log: leise }), /nicht vorspulen/);
    assert.equal(git("rev-parse", "produktion"), seite, "diverged branch left untouched");
  });
});
