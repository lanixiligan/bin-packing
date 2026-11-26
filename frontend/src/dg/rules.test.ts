// The DG rules port against the shared cases in backend/tests/data/dg_cases.json.
// Run: node --test src/dg/
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkAll, dgKey, dgLabel, lookup, MATRIX, COLS, northlineIssues, northlineLimit, pairVerdict, validateDg, type DgLike,
} from "./rules.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../../../backend/tests/data/dg_cases.json", import.meta.url), "utf8"),
) as { cases: { name: string; a: DgLike; b: DgLike; expect: string }[] };

describe("shared cases (same as backend/tests/test_dg.py)", () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      assert.equal(pairVerdict(c.a, c.b).status, c.expect);
      assert.equal(pairVerdict(c.b, c.a).status, c.expect);
    });
  }
});

describe("table and helpers", () => {
  test("Table 9.1 is symmetric between DG classes", () => {
    for (const r of Object.keys(MATRIX)) {
      for (const c of Object.keys(MATRIX)) assert.equal(lookup(r, c), MATRIX[c][COLS.indexOf(r as never)], `${r}/${c}`);
    }
  });
  test("labels and keys", () => {
    assert.equal(dgLabel({ dg_class: "3", subsidiary: ["8", "6.1"] }), "Class 3 (sub 6.1, 8)");
    assert.equal(dgLabel({ dg_class: "1", explosive_code: "1.4S" }), "Class 1.4S");
    assert.equal(dgLabel({ food: true }), "Food");
    assert.equal(dgLabel(null), "General");
    assert.equal(dgKey({}), "");
    assert.equal(dgKey({ dg_class: "3", subsidiary: ["8", "6.1"] }), dgKey({ dg_class: "3", subsidiary: ["6.1", "8"], container: "package" }));
  });
  test("checkAll finds the conflicting pairs", () => {
    const items = [{ n: "thinners", dg: { dg_class: "3" } }, { n: "bricks", dg: null }, { n: "chlorine", dg: { dg_class: "5.1", t92: [] } }] as { n: string; dg: DgLike }[];
    const found = checkAll(items, (i) => i.dg);
    assert.deepEqual(found.map((f) => [f.a.n, f.b.n, f.status]), [["thinners", "chlorine", "incompatible"]]);
  });
  test("validation mirrors the backend", () => {
    assert.deepEqual(validateDg({ dg_class: "3" }), []);
    assert.equal(validateDg({ dg_class: "1" }).length, 1);
    assert.equal(validateDg({ dg_class: "2.1", packing_group: "II" }).length, 1);
    assert.equal(validateDg({ dg_class: "8", t92: ["acid_strong", "alkali_strong"] }).length, 1);
    assert.equal(validateDg({ dg_class: "3", un_number: "12" }).length, 1);
  });
});

describe("Northline", () => {
  const kinds = (dg: DgLike) => northlineIssues(dg).map((i) => i.kind).sort();
  test("prohibited, approval, note", () => {
    assert.deepEqual(kinds({ dg_class: "4.3" }), ["prohibited"]);
    assert.deepEqual(kinds({ dg_class: "3", packing_group: "I" }), ["prohibited"]);
    assert.deepEqual(kinds({ dg_class: "2.3", container: "cylinder" }), ["approval", "note"]);
    assert.deepEqual(kinds({ dg_class: "6.1", packing_group: "III" }), []);
    assert.deepEqual(kinds({ dg_class: "6.1", packing_group: "III", container: "drum" }), ["approval"]);
    assert.deepEqual(kinds({ dg_class: "7", un_number: "2910" }), ["approval"]);
    assert.deepEqual(kinds({ dg_class: "1", explosive_code: "1.4C", un_number: "0509" }), []);
  });
  test("limits", () => {
    assert.deepEqual(northlineLimit({ dg_class: "4.1" }), ["Division 4.1", 50]);
    assert.equal(northlineLimit({ dg_class: "3" }), null);
  });
});
