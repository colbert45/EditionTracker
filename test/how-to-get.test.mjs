import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopy, page } from "./helpers/build-copy.mjs";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { validate } from "../lib/validate.js";

const { item: PICK, other: OTHER } = pickItems(plainData());
const ID = PICK.id;
const withHowTo = (howToGet, id = ID) => {
  const d = plainData();
  d.items.find(i => i.id === id).howToGet = howToGet;
  return d;
};
const box = html => (html.match(/<section class="howto">[\s\S]*?<\/section>/) || [""])[0];

test("nothing filled in, no box, on any page", () => {
  const dir = buildCopy({ data: plainData() });
  assert.doesNotMatch(page(dir, ID), /class="howto"|How to get one/);
  for (const empty of [{}, { where: "", limit: null, tips: [] }, { where: "   ", tips: ["", "  "] }]) {
    assert.doesNotMatch(page(buildCopy({ data: withHowTo(empty) }), ID), /How to get one/, JSON.stringify(empty));
  }
});

test("only the fields that are filled in are shown", () => {
  const html = page(buildCopy({ data: withHowTo({ where: "Online at the Nintendo Store.", tips: [] }) }), ID);
  const b = box(html);
  assert.match(b, /<h2>How to get one<\/h2>/);
  assert.match(b, /<div><dt>Where<\/dt><dd>Online at the Nintendo Store\.<\/dd><\/div>/);
  assert.doesNotMatch(b, /<dt>Limit<\/dt>|<dt>Members<\/dt>|<h3>Tips<\/h3>/);
  // It sits above the notes and below the price facts.
  assert.ok(html.indexOf('class="facts"') < html.indexOf('class="howto"') && html.indexOf('class="howto"') < html.indexOf("<h2>Notes</h2>"));
});

test("every field shows in order, with the tips as a list, and text is escaped", () => {
  const html = page(buildCopy({ data: withHowTo({
    where: "Online, and in stores at launch.",
    limit: "One per customer <b>per account</b>.",
    membership: "Members get a day of early access.",
    tips: ["Sign in ahead of time.", "Save a card & an address."]
  }) }), ID);
  const b = box(html);
  const order = [...b.matchAll(/<dt>(\w+)<\/dt>/g)].map(m => m[1]);
  assert.deepEqual(order, ["Where", "Limit", "Members"]);
  assert.match(b, /<h3>Tips<\/h3><ul class="plain"><li>Sign in ahead of time\.<\/li><li>Save a card &amp; an address\.<\/li><\/ul>/);
  assert.match(b, /One per customer &lt;b&gt;per account&lt;\/b&gt;\./);
  assert.doesNotMatch(b, /<b>per account<\/b>/);
});

test("other releases are untouched", () => {
  const dir = buildCopy({ data: withHowTo({ where: "Online." }) });
  assert.doesNotMatch(page(dir, OTHER.id), /How to get one/);
});

test("the validator checks howToGet", () => {
  assert.deepEqual(validate(withHowTo({ where: "Online.", limit: "One each.", membership: "Members first.", tips: ["Sign in early."] })).errors, []);
  assert.deepEqual(validate(withHowTo({ where: "", limit: null })).errors, []);
  const bad = (value, text) => {
    const errors = validate(withHowTo(value)).errors;
    assert.ok(errors.some(e => e.includes(text)), `${text}: ${JSON.stringify(errors)}`);
  };
  bad("Online at the Nintendo Store", "howToGet: must look like");
  bad(["x"], "howToGet: must look like");
  bad({ stores: "Best Buy" }, `"stores" isn't a field. Use where, limit, membership or tips`);
  bad({ where: 5 }, "where must be short text");
  bad({ limit: "x".repeat(401) }, "limit must be short text");
  bad({ tips: "Sign in early" }, "tips must be a list");
  bad({ tips: ["ok", 5] }, "tips must be a list");
  bad({ tips: Array(9).fill("A tip.") }, "tips must be a list");
  bad({ tips: ["x".repeat(251)] }, "tips must be a list");
});
