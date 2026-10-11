import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopy, page } from "./helpers/build-copy.mjs";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { validate } from "../lib/validate.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Fake restocks, only ever built into a throwaway copy of the site.
const { item: PICK, other: OTHER } = pickItems(plainData());
const ID = PICK.id;
// Released a long time ago unless a test says otherwise, so these don't change as the real dates pass.
const PAST = "2020-01-01", FUTURE = "2099-01-01";
// Restock dates are worked out from today, because a restock a couple of days old is shown as "may be gone".
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const daysAgo = n => new Date(Date.parse(TODAY + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);
const fmt = (d, o) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const short = d => fmt(d, { month: "short", day: "numeric" });
const long = d => fmt(d, { month: "short", day: "numeric", year: "numeric" });

const withRestocks = (restocks, patch = { releaseDate: PAST, releaseWindow: null }) => {
  const data = plainData();
  const it = data.items.find(i => i.id === ID);
  it.status = "restock";
  it.restocks = restocks;
  // The feed's "last changed" date is the newest date on the release, so the real timeline can't be allowed in.
  it.timeline = [];
  it.preordersOpened = null;
  Object.assign(it, patch);
  return data;
};
const ONE = [{ date: TODAY, store: "bestbuy", url: "https://www.bestbuy.com/site/example/1.p", source: "https://example.com/news/best-buy-restock" }];
const REPORTED = [{ date: TODAY, store: "bestbuy", url: "https://www.bestbuy.com/site/searchpage.jsp?st=Example", source: "https://www.nintendolife.com/news/2026/10/best-buy-restock", reported: true }];
const sec = (home, name) => home.slice(home.indexOf(`<section data-sec="${name}"`), home.indexOf("</section>", home.indexOf(`<section data-sec="${name}"`)));

test("a release page shows the status, the log and an InStock offer", () => {
  const html = page(buildCopy({ data: withRestocks(ONE) }), ID);
  assert.match(html, />Back in stock</);
  assert.match(html, /<h2>Restock history<\/h2>/);
  assert.ok(html.includes(`<time datetime="${TODAY}">${long(TODAY)}</time><span><a href="https://www.bestbuy.com/site/example/1.p" target="_blank" rel="noopener">Best Buy</a> <span class="small">· <a href="https://example.com/news/best-buy-restock"`));
  assert.match(html, /schema.org\/InStock/);
  assert.match(html, /<p class="countdown" data-release="2020-01-01" hidden><\/p>/); // already out: no countdown shown
  assert.match(html, /Alert me on restock/);
  assert.doesNotMatch(html, /may be sold out by now/); // restocked today
});

test("a restock of something that's already out leaves the calendar and says preorders are closed", () => {
  const dir = buildCopy({ data: withRestocks(ONE, { releaseDate: PAST, releaseWindow: null, preordersOpened: "2019-12-01" }) });
  const html = page(dir, ID);
  assert.match(html, /<dt>Preorders<\/dt><dd>Opened Dec 1, 2019<\/dd>/);
  assert.match(html, /schema.org\/InStock/);
  assert.doesNotMatch(page(dir, "calendar"), new RegExp(`href="/${ID}/"`));
});

test("a preorder that's back in stock is still an upcoming release", () => {
  const dir = buildCopy({ data: withRestocks(ONE, { releaseDate: FUTURE, releaseWindow: null, preordersOpened: "2026-09-01" }) });
  const html = page(dir, ID);
  assert.match(html, />Back in stock</);
  assert.match(html, /schema.org\/PreOrder/);
  assert.match(html, /"availabilityStarts":"2099-01-01"/);
  assert.match(html, /<p class="countdown" data-release="2099-01-01">Out in \d+ days\.<\/p>/);
  assert.match(html, /<dt>Preorders<\/dt><dd>Open since Sep 1<\/dd>/);
  // Still on the calendar, and on the homepage once: under Back in stock, not also Coming up.
  assert.match(page(dir, "calendar"), new RegExp(`href="/${ID}/"`));
  // The calendar is about release days, so its row shows the release date, not "Restocked <today>".
  const calendarRow = page(dir, "calendar").split("<li ").find(r => r.includes(`href="/${ID}/"`));
  assert.match(calendarRow, /<span class="dt">Jan 1<span>in \d+ days<\/span><\/span>/);
  assert.doesNotMatch(calendarRow, /Restocked|Reported/);
  assert.match(calendarRow, />Back in stock</); // the status chip still says so
  const home = page(dir, ".");
  assert.match(sec(home, "restock"), new RegExp(`href="/${ID}/"`));
  assert.doesNotMatch(sec(home, "coming"), new RegExp(`href="/${ID}/"`));
  assert.doesNotMatch(sec(home, "out"), new RegExp(`href="/${ID}/"`));
  const listed = JSON.parse(home.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema.org","@type":"ItemList".*?)<\/script>/s)[1]);
  assert.equal(listed.itemListElement.filter(e => e.url.endsWith(`/${ID}/`)).length, 1);
});

test("no log means no heading, on every other page too", () => {
  const dir = buildCopy({ data: withRestocks(ONE) });
  assert.doesNotMatch(page(dir, OTHER.id), /Restock history/);
  const none = buildCopy({ data: plainData() });
  assert.doesNotMatch(page(none, ID), /Restock history/);
});

test("the log is newest first, and a source that repeats the link isn't shown twice", () => {
  const url = "https://www.target.com/p/example/-/A-1";
  const html = page(buildCopy({ data: withRestocks([
    { date: daysAgo(1), store: "bestbuy", url: "https://www.bestbuy.com/a", source: null },
    { date: TODAY, store: "target", url, source: url },
    { date: TODAY, store: "walmart", url: "https://www.walmart.com/ip/1", source: null }
  ]) }), ID);
  const log = html.slice(html.indexOf("Restock history"), html.indexOf("<h2>Sources</h2>"));
  const order = [...log.matchAll(/>(Best Buy|Target|Walmart)</g)].map(m => m[1]);
  assert.deepEqual(order, ["Walmart", "Target", "Best Buy"]); // same-day entries: the later one first
  assert.doesNotMatch(log, /Source/);
});

test("the homepage lists restocked releases first, and not again under Already out", () => {
  const dir = buildCopy({ data: withRestocks(ONE) });
  const home = page(dir, ".");
  const restock = sec(home, "restock");
  assert.doesNotMatch(restock.slice(0, 40), /hidden/);
  assert.match(restock, /Back in stock/);
  assert.match(restock, new RegExp(`href="/${ID}/"`));
  assert.ok(restock.includes(`Restocked ${short(TODAY)}<span>at Best Buy</span>`));
  assert.doesNotMatch(sec(home, "out"), new RegExp(`href="/${ID}/"`));
  assert.doesNotMatch(sec(home, "coming"), new RegExp(`href="/${ID}/"`));
  assert.ok(home.indexOf('data-sec="restock"') < home.indexOf('data-sec="coming"'));
  assert.match(home, /<b>1<\/b> back in stock/);
  // With nothing restocked the section is still there for the page script, but hidden.
  const none = page(buildCopy({ data: plainData() }), ".");
  assert.match(none, /<section data-sec="restock" hidden>/);
  assert.doesNotMatch(none, /back in stock<\/li>/);
});

test("the feed announces a restock as new", () => {
  const dir = buildCopy({ data: withRestocks(ONE) });
  const feed = readFileSync(join(dir, "_site/feed.xml"), "utf8");
  const entry = feed.split("<item>").find(x => x.includes(`/${ID}/`));
  assert.ok(entry.includes(`#${TODAY}-restock-r1</guid>`));
  assert.match(entry, /Back in stock at Best Buy\./);
});

test("a reported restock says it was reported, and where", () => {
  const dir = buildCopy({ data: withRestocks(REPORTED) });
  const html = page(dir, ID);
  assert.match(html, />Back in stock</); // the release's status is still Back in stock
  assert.ok(html.includes(`<span class="small">· Reported on <a href="https://www.nintendolife.com/news/2026/10/best-buy-restock" target="_blank" rel="noopener">nintendolife.com</a></span>`));
  assert.ok(sec(page(dir, "."), "restock").includes(`Reported ${short(TODAY)}<span>at Best Buy</span>`));
  const feed = readFileSync(join(dir, "_site/feed.xml"), "utf8");
  assert.match(feed.split("<item>").find(x => x.includes(`/${ID}/`)), /Reported back in stock at Best Buy\./);
  // A confirmed restock doesn't say reported.
  assert.doesNotMatch(page(buildCopy({ data: withRestocks(ONE) }), ID), /Reported/);
});

test("a restock a couple of days old says it may be gone", () => {
  const old = buildCopy({ data: withRestocks([{ ...ONE[0], date: daysAgo(5) }]) });
  const html = page(old, ID);
  assert.match(html, /<p class="small">The latest restock was 5 days ago, so it may be sold out by now\.<\/p>/);
  assert.ok(sec(page(old, "."), "restock").includes(`Restocked ${short(daysAgo(5))}<span>at Best Buy · may be gone</span>`));
  // One day old is still fresh, and a newer restock resets it.
  const day = buildCopy({ data: withRestocks([{ ...ONE[0], date: daysAgo(1) }]) });
  assert.doesNotMatch(page(day, ID), /may be sold out by now/);
  assert.doesNotMatch(page(day, "."), /may be gone/);
  const again = buildCopy({ data: withRestocks([{ ...ONE[0], date: daysAgo(5) }, { ...ONE[0], store: "target", url: "https://www.target.com/p/x/-/A-1", date: TODAY }]) });
  assert.doesNotMatch(page(again, ID), /may be sold out by now/);
  // A reported one ages the same way.
  const rep = buildCopy({ data: withRestocks([{ ...REPORTED[0], date: daysAgo(4) }]) });
  assert.ok(sec(page(rep, "."), "restock").includes(`Reported ${short(daysAgo(4))}<span>at Best Buy · may be gone</span>`));
});

test("the validator checks restocks", () => {
  const ok = withRestocks(ONE);
  assert.deepEqual(validate(ok).errors, []);
  assert.deepEqual(validate(withRestocks(REPORTED)).errors, []);
  const bad = (patch, text) => {
    const d = withRestocks([{ ...ONE[0], ...patch }]);
    assert.ok(validate(d).errors.some(e => e.includes(text)), `${text}: ${JSON.stringify(validate(d).errors)}`);
  };
  bad({ store: "nowhere" }, "store must be one of");
  bad({ date: "Oct 9" }, "date must be a date");
  bad({ url: "http://www.bestbuy.com/a" }, "url must be");
  bad({ url: "not a link" }, "url must be");
  bad({ source: "ftp://x" }, "source must be");
  // A report has to say where it was reported.
  bad({ reported: "yes" }, "reported must be true or false");
  bad({ reported: true, source: null }, "a reported restock needs a source");
  // This site has no affiliate links, so hand-edited data can't carry one either.
  bad({ url: "https://www.bestbuy.com/a?irclickid=abc" }, "url has an affiliate tag (irclickid)");
  bad({ source: "https://example.com/news?tag=dealsite-20" }, "source has an affiliate tag (tag)");
  bad({ source: "https://www.amazon.com/dp/B0ABC" }, "source goes to Amazon");
  bad({ url: "https://amzn.to/3abc" }, "url goes to Amazon");
  // Back in stock with no entry is allowed, but flagged.
  const noLog = withRestocks([]);
  const r = validate(noLog);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some(w => w.includes("no restock logged")));
  // Extra sites a store sells from.
  const d = plainData();
  const store = Object.keys(d.stores)[0];
  d.stores[store].domains = ["microsoft.com"];
  assert.deepEqual(validate(d).errors, []);
  d.stores[store].domains = ["https://microsoft.com"];
  assert.ok(validate(d).errors.some(e => e.includes("domains")));
});
