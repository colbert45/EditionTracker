import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopy, readReal, page } from "./helpers/build-copy.mjs";

test("the About page lists the cost rows that have a price, and the footer links to it", () => {
  // Start from the real rows, but with the domain row blank, so this keeps passing once its price is filled in.
  const real = readReal("data/costs.json");
  const costs = { ...real, items: real.items.map(r => r.name === "Domain name" ? { ...r, price: "" } : r) };
  const dir = buildCopy({ costs });
  const html = page(dir, "about");
  assert.match(html, /<h1>About Edition Tracker<\/h1>/);
  assert.match(html, /No ads\. No affiliate links\./);
  for (const r of costs.items.filter(r => r.price.trim())) assert.ok(html.includes(r.price.replace(/&/g, "&amp;")), r.name);
  // A row without a price isn't shown.
  assert.doesNotMatch(html, /Domain name/);
  const priced = buildCopy({ costs: { ...real, items: real.items.map(r => r.name === "Domain name" ? { ...r, price: "$12 a year" } : r) } });
  assert.match(page(priced, "about"), /Domain name[\s\S]*\$12 a year/);
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

test("a Discord invite link shows in the footer only when it's a real invite link", () => {
  const cfg = readReal("site.config.json");
  const follow = html => (html.match(/<p>Follow: [^<]*(?:<a [^>]*>[^<]*<\/a>[^<]*)*<\/p>/) || [""])[0];
  const none = page(buildCopy({ config: { ...cfg, social: { ...cfg.social, discord: "" } } }), "about");
  assert.doesNotMatch(follow(none), /Discord/);
  const set = page(buildCopy({ config: { ...cfg, social: { ...cfg.social, discord: "https://discord.gg/abc123" } } }), "about");
  assert.match(follow(set), /<a href="https:\/\/discord.gg\/abc123" rel="me noopener">Discord<\/a>/);
  assert.match(follow(set), /Bluesky/); // the others stay
  // It isn't claimed as the site's own profile in the page data.
  assert.doesNotMatch(set, /"sameAs":\[[^\]]*discord/);
  for (const bad of ["https://example.com/abc", "http://discord.gg/abc", "https://discord.gg/abc/def", "javascript:alert(1)", "https://discord.gg/<b>"]) {
    assert.doesNotMatch(follow(page(buildCopy({ config: { ...cfg, social: { ...cfg.social, discord: bad } } }), "about")), /Discord/, bad);
  }
});
