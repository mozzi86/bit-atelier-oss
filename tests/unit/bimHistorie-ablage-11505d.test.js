// 115-05d (C-2): the studio's drawing undo is put away when its tab unmounts and taken back only for the very model it belongs to.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { leereHistorie, vorAenderung, zieheStart, historieAblegen, historieHolen, historieVergessen } from "@designer/lib/bimHistorie.js";

const stand = (/** @type {number[]} */ waende, ausschnitte = []) => ({ customWalls: waende.map((i) => ({ _idx: i })), storeys: 2, ausschnitte });
const mitSchritt = () => vorAenderung(leereHistorie(), stand([1]));

beforeEach(() => historieVergessen());

test("taken back for the same project and the same model; consumed by the take-back", () => {
  const h = mitSchritt();
  historieAblegen("p1", h, stand([1, 2]));
  const zurueck = historieHolen("p1", stand([1, 2]));
  assert.deepEqual(zurueck?.stack, h.stack);
  assert.equal(historieHolen("p1", stand([1, 2])), null, "one take-back per put-away");
});

test("dropped when the model changed meanwhile (foreign change, discard, another draft)", () => {
  historieAblegen("p1", mitSchritt(), stand([1, 2]));
  assert.equal(historieHolen("p1", stand([1, 3])), null);
  assert.equal(historieHolen("p1", stand([1, 2])), null, "the dropped entry is gone, it never comes back later");
});

test("other project: nothing; saved views do not count for the comparison", () => {
  historieAblegen("p1", mitSchritt(), stand([1, 2], [{ id: "a" }]));
  assert.equal(historieHolen("p2", stand([1, 2])), null);
  assert.ok(historieHolen("p1", stand([1, 2], [])), "views load on their own and may differ");
});

test("an empty history never replaces a put-away one; an open drag is closed; forgetting works per project", () => {
  historieAblegen("p1", mitSchritt(), stand([1]));
  historieAblegen("p1", leereHistorie(), stand([1])); // the development double mount
  const h = historieHolen("p1", stand([1]));
  assert.equal(h?.stack.past.length, 1);
  const ziehend = vorAenderung(zieheStart(leereHistorie()), stand([1]));
  historieAblegen("p1", ziehend, stand([1, 2]));
  assert.deepEqual([historieHolen("p1", stand([1, 2]))?.ziehe, ziehend.ziehe], [false, true]);
  historieAblegen("p1", mitSchritt(), stand([1])); historieAblegen("p2", mitSchritt(), stand([1]));
  historieVergessen("p1");
  assert.equal(historieHolen("p1", stand([1])), null);
  assert.ok(historieHolen("p2", stand([1])));
  historieAblegen(null, mitSchritt(), stand([1]));
  assert.equal(historieHolen(null, stand([1])), null);
});
