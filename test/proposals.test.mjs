import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyAll, prMarkdown, slugify, proposalSchema } from "../lib/proposals.js";
import { planAlerts, emailBody } from "../lib/alerts.js";
import { plainData, pickItems } from "./helpers/stock.mjs";

const data = JSON.parse(readFileSync(new URL("../data/releases.json", import.meta.url)));
const h = new Map([[1, { id: 1, title: "Zelda Switch 2 sold out again", link: "https://news.example/zelda", sourceName: "Example News" }],
                   [2, { id: 2, title: "Sony reveals Astro Bot DualSense", link: "https://news.example/astro", sourceName: "Example News" }]]);
const zeldaStatus = data.items.find(i => i.id === "switch-2-zelda-40th").status; // whatever it is today
const noChange = { status: null, price: null, releaseDate: null, releaseWindow: null, preordersOpened: null, appendNote: null, stores: null };

test("applies an update with timeline and source", () => {
  const { data: next, applied, skipped } = applyAll(data, [{
    kind: "update", itemId: "switch-2-zelda-40th", summary: "Sold out", confidence: "high", headlineIds: [1],
    changes: { ...noChange, status: "soldout" }, timelineEntry: { date: "2026-10-02", text: "Sold out again." }, newItem: null
  }], h, "2026-10-03");
  assert.equal(skipped.length, 0);
  const it = next.items.find(i => i.id === "switch-2-zelda-40th");
  assert.equal(it.status, "soldout");
  assert.equal(it.timeline.at(-1).text, "Sold out again.");
  assert.equal(it.sources.at(-1).url, "https://news.example/zelda");
  assert.equal(next.updated, "2026-10-03");
  assert.ok(prMarkdown({ applied, skipped, reviewed: 2, when: "now" }).includes("https://news.example/zelda"));
  assert.equal(data.items.find(i => i.id === "switch-2-zelda-40th").status, zeldaStatus, "original untouched");
});

test("adds a new release", () => {
  const { data: next, applied } = applyAll(data, [{
    kind: "new", itemId: "DualSense Astro Bot", summary: "New controller", confidence: "medium", headlineIds: [2],
    changes: noChange, timelineEntry: null,
    newItem: { name: "DualSense Astro Bot Limited Edition", category: "playstation", platform: "PS5", status: "announced", price: "$79.99",
      releaseDate: null, releaseWindow: "November 2026", preordersOpened: null, searchQuery: "DualSense Astro Bot",
      notes: ["Blue and white controller."], inTheBox: [], stores: ["psdirect", "bestbuy"], artType: "pad", artColors: ["#2E6FD8", "#FFFFFF", "#1A1A1A"] }
  }], h, "2026-10-03");
  assert.equal(applied.length, 1);
  const it = next.items.at(-1);
  assert.equal(it.id, "dualsense-astro-bot");
  assert.equal(it.releaseWindow, "November 2026");
  assert.deepEqual(it.sources, [{ label: "Example News", url: "https://news.example/astro" }]);
});

test("drops bad proposals instead of breaking the data", () => {
  const { applied, skipped } = applyAll(data, [
    { kind: "update", itemId: "does-not-exist", summary: "x", confidence: "low", headlineIds: [1], changes: noChange, timelineEntry: null, newItem: null },
    { kind: "update", itemId: "switch-2-zelda-40th", summary: "x", confidence: "low", headlineIds: [99], changes: { ...noChange, price: "$1" }, timelineEntry: null, newItem: null },
    { kind: "update", itemId: "switch-2-zelda-40th", summary: "x", confidence: "low", headlineIds: [1], changes: { ...noChange, releaseDate: "Oct 29" }, timelineEntry: null, newItem: null }
  ], h, "2026-10-03");
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 3);
});

test("slugify", () => {
  assert.equal(slugify("LEGO Zelda: Ocarina of Time Link & Epona"), "lego-zelda-ocarina-of-time-link-and-epona");
});

test("the news check can't switch anything to Back in stock", () => {
  // Not in the answers it's allowed to give...
  const props = proposalSchema(data).properties.proposals.items.properties;
  const enums = [props.changes.properties.status.anyOf[1].enum, props.newItem.anyOf[1].properties.status.enum];
  for (const e of enums) { assert.ok(e.includes("soldout")); assert.ok(!e.includes("restock")); }
  // ...and refused if it gives it anyway.
  const { applied, skipped } = applyAll(data, [
    { kind: "update", itemId: "switch-2-zelda-40th", summary: "x", confidence: "high", headlineIds: [1], changes: { ...noChange, status: "restock" }, timelineEntry: null, newItem: null },
    { kind: "new", itemId: "x", summary: "x", confidence: "high", headlineIds: [2], changes: noChange, timelineEntry: null,
      newItem: { name: "Some Edition", category: "playstation", platform: "PS5", status: "restock", price: "$1.00", releaseDate: null, releaseWindow: "TBA",
        preordersOpened: null, searchQuery: "x", notes: ["x"], inTheBox: [], stores: [], artType: "pad", artColors: ["#111111", "#222222", "#333333"] } }
  ], h, "2026-10-03");
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /set by recording a restock/);
  assert.match(skipped[1].reason, /can't start out as back in stock/);
});

// ---------- restock reports ----------
const TODAY = "2026-10-12";
const { item: PICK } = pickItems(plainData());
const BB_SEARCH = id => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(plainData().items.find(i => i.id === id).searchQuery)}`;
const report = (over = {}) => new Map([[1, { id: 1, title: "Switch 2 Zelda edition is back in stock at Best Buy", link: "https://news.example/zelda-restock?utm_source=rss&utm_medium=feed",
  sourceName: "Example News", summary: "Best Buy has restocked it online.", published: "2026-10-12T09:00:00Z", ...over }]]);
const restockProposal = (restock, over = {}) => ({ kind: "update", itemId: PICK.id, summary: "Back in stock", confidence: "medium", headlineIds: [1],
  changes: { ...noChange, restock: { store: "bestbuy", date: TODAY, listingUrl: null, ...restock } }, timelineEntry: null, newItem: null, ...over });
const run = (restock, headline, over) => applyAll(plainData(), [restockProposal(restock, over)], report(headline), TODAY);

test("the news check can propose a restock, and the schema allows it", () => {
  const changes = proposalSchema(plainData()).properties.proposals.items.properties.changes;
  assert.ok(changes.required.includes("restock"));
  const r = changes.properties.restock.anyOf[1];
  assert.deepEqual(r.required, ["store", "date", "listingUrl"]);
  assert.ok(r.properties.store.enum.includes("bestbuy"));
  assert.ok(!r.properties.store.enum.includes("nowhere"));
});

test("a restock report becomes a reported entry whose source is the report", () => {
  const { data: next, applied, skipped } = run({});
  assert.equal(skipped.length, 0, JSON.stringify(skipped));
  const it = next.items.find(i => i.id === PICK.id);
  assert.equal(it.status, "restock");
  assert.deepEqual(it.restocks, [{ date: TODAY, store: "bestbuy", url: BB_SEARCH(PICK.id), source: "https://news.example/zelda-restock", reported: true }]);
  assert.equal(next.updated, TODAY);
  assert.ok(it.sources.some(x => x.url === "https://news.example/zelda-restock?utm_source=rss&utm_medium=feed"));
  assert.deepEqual(applied[0].diff.map(d => d[0]), ["restock", "status", "sources"]);
  const md = prMarkdown({ applied, skipped, reviewed: 1, when: "now" });
  assert.match(md, /\| restock \|  \| `Best Buy, reported 2026-10-12` \|/);
  assert.match(md, /Merging sends the "Reported back in stock" email to people following this release/);
  // Other kinds of change don't carry that warning.
  assert.doesNotMatch(prMarkdown({ applied: [{ p: { kind: "update", itemId: "x", summary: "s", confidence: "high" }, diff: [["price", "$1", "$2"]], used: [] }], skipped: [], reviewed: 1, when: "now" }), /Merging sends/);
});

test("a restock link is only used when the report's own text has it and it's on the store's website", () => {
  const good = "https://www.bestbuy.com/site/switch-2-zelda/6000000.p?skuId=6000000";
  const withUrl = h => run({ listingUrl: good }, h).data.items.find(i => i.id === PICK.id).restocks[0].url;
  assert.equal(withUrl({ summary: `Buy it here: ${good}&irclickid=abc` }), good); // tracking tags come off
  assert.equal(withUrl({}), BB_SEARCH(PICK.id)); // the model's link isn't in the report: it's not trusted
  assert.equal(withUrl({ summary: "Buy it at https://www.amazon.com/dp/B0ABC" , title: good.replace("bestbuy.com", "bestbuy.com.evil.test") }), BB_SEARCH(PICK.id));
  const wrongSite = run({ listingUrl: "https://www.target.com/p/x/-/A-1" }, { summary: "https://www.target.com/p/x/-/A-1" });
  assert.equal(wrongSite.data.items.find(i => i.id === PICK.id).restocks[0].url, BB_SEARCH(PICK.id)); // a Target link can't stand in for Best Buy
});

test("a restock report that can't be trusted is dropped with a reason", () => {
  const dropped = (restock, headline, over) => { const r = run(restock, headline, over); assert.equal(r.applied.length, 0); return r.skipped[0].reason; };
  assert.match(dropped({}, { link: "https://www.amazon.com/dp/B0ABC?tag=dealsite-20" }), /goes to Amazon/);
  assert.match(dropped({ date: "Oct 12" }), /no usable date/);
  assert.match(dropped({ date: "2026-10-01" }), /too old to send as news/);
  assert.match(dropped({}, {}, { changes: { ...noChange, status: "soldout", restock: { store: "bestbuy", date: TODAY, listingUrl: null } } }), /can't also change the status/);
  assert.match(dropped({ store: "nowhere" }), /no store "nowhere"/);
  // A release that isn't on sale yet has nothing to restock.
  const rumor = plainData(); rumor.items.find(i => i.id === PICK.id).status = "rumor";
  const r = applyAll(rumor, [restockProposal({})], report(), TODAY);
  assert.match(r.skipped[0].reason, /nothing to restock yet/);
  // The same store on the same day isn't added twice, even from a second report.
  const once = run({});
  const twice = applyAll(once.data, [restockProposal({})], report({ link: "https://news.example/another-report" }), TODAY);
  assert.match(twice.skipped[0].reason, /already logged for 2026-10-12/);
});

test("a report dated tomorrow counts as today, and one from a few days ago still counts", () => {
  assert.equal(run({ date: "2026-10-13" }).data.items.find(i => i.id === PICK.id).restocks[0].date, TODAY);
  assert.equal(run({ date: "2026-10-09" }).data.items.find(i => i.id === PICK.id).restocks[0].date, "2026-10-09");
});

test("merging a reported restock emails it as reported", () => {
  const before = plainData();
  const { data: next } = run({});
  const [alert, ...rest] = planAlerts(before, next, "https://editiontracker.com");
  assert.equal(rest.length, 0);
  assert.equal(alert.kind, "restock");
  assert.deepEqual(alert.tags, [`item:${PICK.id}`]);
  assert.match(alert.subject, /^Reported back in stock: .* at Best Buy$/);
  const body = emailBody(alert, next.categories);
  assert.match(body, /was reported back in stock on Oct 12, 2026, per \[news\.example\]\(https:\/\/news\.example\/zelda-restock\)/);
  assert.match(body, /may already be gone/);
});
