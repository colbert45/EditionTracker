import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopy, page } from "./helpers/build-copy.mjs";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { validate } from "../lib/validate.js";

const { item: PICK, other: OTHER } = pickItems(plainData());
const ID = PICK.id;
const MSRP = Number(PICK.price.replace(/[^0-9.]/g, ""));
const withItem = (id, patch, data = plainData()) => {
  Object.assign(data.items.find(i => i.id === id), patch);
  return data;
};
const text = (html, cls) => ((html.match(new RegExp(`<p class="${cls}">[\\s\\S]*?</p>`)) || [""])[0]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const dollars = n => "$" + n.toLocaleString("en-US");
const over = n => Math.round((n / MSRP - 1) * 100);
// A check from yesterday, so it never reads as "may be out of date", whenever the tests run.
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const RECENT = new Date(Date.parse(TODAY + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
const RECENT_TEXT = new Date(RECENT + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

test("a release with one plain price says MSRP and not to pay more; nothing else is claimed", () => {
  const html = page(buildCopy({ data: plainData() }), ID);
  assert.equal(text(html, "mline"), `MSRP ${PICK.price}. Don't pay more.`);
  assert.match(html, /<div class="msrp"><p class="mline"><b>MSRP /);
  assert.doesNotMatch(html, /class="resale"/); // no resale numbers unless someone filled them in
});

test("a price range, TBA and a rumor get no MSRP line", () => {
  const data = withItem(ID, { price: "$119.99 to $209.99" });
  withItem(OTHER.id, { price: "TBA" }, data);
  const dir = buildCopy({ data });
  assert.doesNotMatch(page(dir, ID), /class="msrp"/);
  assert.doesNotMatch(page(dir, OTHER.id), /class="msrp"/);
  assert.doesNotMatch(page(buildCopy({ data: withItem(ID, { status: "rumor" }) }), ID), /class="msrp"/);
});

test("an explicit MSRP fills in when the price isn't one amount", () => {
  const html = page(buildCopy({ data: withItem(ID, { price: "$119.99 to $209.99", msrp: "$149.99" }) }), ID);
  assert.equal(text(html, "mline"), "MSRP $149.99. Don't pay more.");
});

test("resale prices show with their date and how far over MSRP they are", () => {
  const low = Math.round(MSRP * 1.5), high = Math.round(MSRP * 2);
  const html = page(buildCopy({ data: withItem(ID, { resale: { low: dollars(low), high: dollars(high), checked: RECENT, where: "eBay" } }) }), ID);
  assert.equal(text(html, "resale"),
    `Resellers are asking ${dollars(low)} to ${dollars(high)} on eBay (checked ${RECENT_TEXT}). That's ${over(low)}% to ${over(high)}% over MSRP.`);
  // One box, MSRP first.
  assert.equal((html.match(/class="msrp"/g) || []).length, 1);
  assert.ok(html.indexOf('class="mline"') < html.indexOf('class="resale"'));
});

test("a single resale price, a price under MSRP, and a release with no MSRP", () => {
  const two = Math.round(MSRP * 2);
  const one = page(buildCopy({ data: withItem(ID, { resale: { low: dollars(two), checked: RECENT } }) }), ID);
  assert.equal(text(one, "resale"), `Resellers are asking ${dollars(two)} (checked ${RECENT_TEXT}). That's ${over(two)}% over MSRP.`);
  // Under MSRP: the numbers are shown, but no "over MSRP" claim.
  const under = page(buildCopy({ data: withItem(ID, { resale: { low: "$1", high: "$2", checked: RECENT } }) }), ID);
  assert.equal(text(under, "resale"), `Resellers are asking $1 to $2 (checked ${RECENT_TEXT}).`);
  // A range price has no MSRP to compare with: the resale line stands alone.
  const none = page(buildCopy({ data: withItem(ID, { price: "$119.99 to $209.99", resale: { low: "$300", checked: RECENT } }) }), ID);
  assert.doesNotMatch(none, /class="mline"/);
  assert.equal(text(none, "resale"), `Resellers are asking $300 (checked ${RECENT_TEXT}).`);
});

test("an old resale check says it may be out of date, and the place name is escaped", () => {
  const html = page(buildCopy({ data: withItem(ID, { resale: { low: "$600", checked: "2026-01-02", where: "<b>eBay</b>" } }) }), ID);
  assert.match(text(html, "resale"), /\(checked Jan 2, 2026, may be out of date\)/);
  assert.doesNotMatch(html, /<b>eBay<\/b>/);
  assert.match(html, /on &lt;b&gt;eBay&lt;\/b&gt;/);
});

test("the validator checks msrp and resale", () => {
  assert.deepEqual(validate(withItem(ID, { msrp: "$519.99", resale: { low: "$800", high: "$1,000", checked: RECENT, where: "eBay" } })).errors, []);
  const bad = (patch, expected) => {
    const errors = validate(withItem(ID, patch)).errors;
    assert.ok(errors.some(e => e.includes(expected)), `${expected}: ${JSON.stringify(errors)}`);
  };
  bad({ msrp: "519.99" }, "msrp must be");
  bad({ msrp: "$119.99 to $209.99" }, "msrp must be");
  bad({ resale: "$800" }, "resale: must look like");
  bad({ resale: { checked: RECENT } }, 'low must be a price like "$800"');
  bad({ resale: { low: "800", checked: RECENT } }, "low must be a price");
  bad({ resale: { low: "$800", high: "lots", checked: RECENT } }, "high must be null or a price");
  bad({ resale: { low: "$800", high: "$700", checked: RECENT } }, "high can't be lower than low");
  bad({ resale: { low: "$800" } }, "checked must be the date");
  bad({ resale: { low: "$800", checked: "Oct 9" } }, "checked must be the date");
  bad({ resale: { low: "$800", checked: RECENT, where: "x".repeat(41) } }, "where must be");
});

test("the homepage says what the site is for, near the top", () => {
  const home = page(buildCopy({ data: plainData() }), ".");
  assert.match(home, /<p class="pledge"><b>Restock alerts at MSRP\.<\/b> No bots, no markups\.<\/p>/);
  assert.ok(home.indexOf('class="hero-sub"') < home.indexOf('class="pledge"'));
  assert.ok(home.indexOf('class="pledge"') < home.indexOf('class="stats"'));
});
