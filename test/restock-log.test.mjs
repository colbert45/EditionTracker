import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopy, readReal, page } from "./helpers/build-copy.mjs";
import { validate } from "../lib/validate.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Fake restocks, only ever built into a throwaway copy of the site.
const ID = "switch-2-zelda-40th";
const withRestocks = restocks => {
  const data = readReal("data/releases.json");
  const it = data.items.find(i => i.id === ID);
  it.status = "restock";
  it.restocks = restocks;
  return data;
};
const ONE = [{ date: "2026-10-09", store: "bestbuy", url: "https://www.bestbuy.com/site/example/1.p", source: "https://example.com/news/best-buy-restock" }];

test("a release page shows the status, the log and an InStock offer", () => {
  const html = page(buildCopy({ data: withRestocks(ONE) }), ID);
  assert.match(html, />Back in stock</);
  assert.match(html, /<h2>Restock history<\/h2>/);
  assert.match(html, /<time datetime="2026-10-09">Oct 9, 2026<\/time><span><a href="https:\/\/www.bestbuy.com\/site\/example\/1.p" target="_blank" rel="noopener">Best Buy<\/a> <span class="small">· <a href="https:\/\/example.com\/news\/best-buy-restock"/);
  assert.match(html, /schema.org\/InStock/);
  assert.doesNotMatch(html, /class="countdown"/);
  assert.match(html, /Alert me on restock/);
});

test("no log means no heading, on every other page too", () => {
  const dir = buildCopy({ data: withRestocks(ONE) });
  assert.doesNotMatch(page(dir, "xbox-series-x25"), /Restock history/);
  const real = buildCopy();
  assert.doesNotMatch(page(real, ID), /Restock history/);
});

test("the log is newest first, and a source that repeats the link isn't shown twice", () => {
  const url = "https://www.target.com/p/example/-/A-1";
  const html = page(buildCopy({ data: withRestocks([
    { date: "2026-10-09", store: "bestbuy", url: "https://www.bestbuy.com/a", source: null },
    { date: "2026-10-12", store: "target", url, source: url },
    { date: "2026-10-12", store: "walmart", url: "https://www.walmart.com/ip/1", source: null }
  ]) }), ID);
  const log = html.slice(html.indexOf("Restock history"), html.indexOf("Timeline"));
  const order = [...log.matchAll(/>(Best Buy|Target|Walmart)</g)].map(m => m[1]);
  assert.deepEqual(order, ["Walmart", "Target", "Best Buy"]); // same-day entries: the later one first
  assert.doesNotMatch(log, /Source/);
});

test("the homepage lists restocked releases first, and not again under Already out", () => {
  const dir = buildCopy({ data: withRestocks(ONE) });
  const home = page(dir, ".");
  const sec = name => home.slice(home.indexOf(`<section data-sec="${name}"`), home.indexOf("</section>", home.indexOf(`<section data-sec="${name}"`)));
  const restock = sec("restock");
  assert.doesNotMatch(restock.slice(0, 40), /hidden/);
  assert.match(restock, /Back in stock/);
  assert.match(restock, new RegExp(`href="/${ID}/"`));
  assert.match(restock, /Restocked Oct 9<span>at Best Buy<\/span>/);
  assert.doesNotMatch(sec("out"), new RegExp(`href="/${ID}/"`));
  assert.doesNotMatch(sec("coming"), new RegExp(`href="/${ID}/"`));
  assert.ok(home.indexOf('data-sec="restock"') < home.indexOf('data-sec="coming"'));
  assert.match(home, /<b>1<\/b> back in stock/);
  // With nothing restocked the section is still there for the page script, but hidden.
  const none = page(buildCopy(), ".");
  assert.match(none, /<section data-sec="restock" hidden>/);
  assert.doesNotMatch(none, /back in stock<\/li>/);
});

test("the feed announces a restock as new", () => {
  const dir = buildCopy({ data: withRestocks(ONE) });
  const feed = readFileSync(join(dir, "_site/feed.xml"), "utf8");
  const entry = feed.split("<item>").find(x => x.includes(`/${ID}/`));
  assert.match(entry, /#2026-10-09-restock-r1<\/guid>/);
  assert.match(entry, /Back in stock at Best Buy\./);
});

test("the validator checks restocks", () => {
  const ok = withRestocks(ONE);
  assert.deepEqual(validate(ok).errors, []);
  const bad = (patch, text) => {
    const d = withRestocks([{ ...ONE[0], ...patch }]);
    assert.ok(validate(d).errors.some(e => e.includes(text)), `${text}: ${JSON.stringify(validate(d).errors)}`);
  };
  bad({ store: "nowhere" }, "store must be one of");
  bad({ date: "Oct 9" }, "date must be a date");
  bad({ url: "http://www.bestbuy.com/a" }, "url must be");
  bad({ url: "not a link" }, "url must be");
  bad({ source: "ftp://x" }, "source must be");
  // Back in stock with no entry is allowed, but flagged.
  const noLog = withRestocks([]);
  const r = validate(noLog);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some(w => w.includes("no restock logged")));
  // Extra sites a store sells from.
  const d = readReal("data/releases.json");
  d.stores.xbox.domains = ["microsoft.com"];
  assert.deepEqual(validate(d).errors, []);
  d.stores.xbox.domains = ["https://microsoft.com"];
  assert.ok(validate(d).errors.some(e => e.includes("domains")));
});
