import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopy, readReal, page } from "./helpers/build-copy.mjs";

test("the About page lists the cost rows that have a price, and the footer links to it", () => {
  const costs = readReal("data/costs.json");
  const dir = buildCopy({ costs });
  const html = page(dir, "about");
  assert.match(html, /<h1>About Edition Tracker<\/h1>/);
  assert.match(html, /No ads\. No affiliate links\./);
  for (const r of costs.items.filter(r => r.price.trim())) assert.ok(html.includes(r.price.replace(/&/g, "&amp;")), r.name);
  // A row without a price (like the domain, until it's filled in) isn't shown.
  assert.doesNotMatch(html, /Domain name/);
  assert.match(page(dir, "."), /href="\/about\/">About<\/a>/);
});

test("the coffee link only shows when a support link is set", () => {
  const cfg = readReal("site.config.json");
  assert.doesNotMatch(page(buildCopy({ config: { ...cfg, support: { url: "", label: "Buy me a coffee" } } }), "about"), /Chip in/);
  const html = page(buildCopy({ config: { ...cfg, support: { url: "https://ko-fi.com/example", label: "Buy me a coffee" } } }), "about");
  assert.match(html, /Chip in\./);
  assert.match(html, /href="https:\/\/ko-fi.com\/example" rel="noopener">Buy me a coffee</);
});

test("the total line only shows when one is written", () => {
  const costs = readReal("data/costs.json");
  assert.doesNotMatch(page(buildCopy({ costs: { ...costs, total: null } }), "about"), /<p><b>/);
  assert.match(page(buildCopy({ costs: { ...costs, total: "About $20 a month right now." } }), "about"), /<p><b>About \$20 a month right now\.<\/b><\/p>/);
});
