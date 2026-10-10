import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { duePreorders } from "../lib/scheduled.js";
import { validate } from "../lib/validate.js";

const base = () => JSON.parse(readFileSync(new URL("../data/releases.json", import.meta.url), "utf8"));

test("an announced release flips to preorder on its preorder date, not before", () => {
  const d = base();
  const it = d.items.find(i => i.status === "announced");
  it.preordersStart = "2026-11-02";
  assert.equal(duePreorders(d, "2026-11-01").changed.length, 0);
  const { data, changed } = duePreorders(d, "2026-11-02");
  assert.deepEqual(changed.map(c => c.id), [it.id]);
  const after = data.items.find(i => i.id === it.id);
  assert.equal(after.status, "preorder");
  assert.equal(after.preordersOpened, "2026-11-02");
  assert.ok(after.timeline.some(t => t.date === "2026-11-02" && t.text === "Preorders opened."));
  assert.deepEqual(validate(data).errors, []);
  // Running again changes nothing.
  assert.equal(duePreorders(data, "2026-11-03").changed.length, 0);
});

test("preordersStart must be a date", () => {
  const d = base();
  d.items[0].preordersStart = "next week";
  assert.ok(validate(d).errors.some(e => e.includes("preordersStart")));
});
