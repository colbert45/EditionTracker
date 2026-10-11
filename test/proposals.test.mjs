import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyAll, prMarkdown, slugify, proposalSchema } from "../lib/proposals.js";
import { planAlerts, emailBody } from "../lib/alerts.js";
import { plainData, pickItems } from "./helpers/stock.mjs";

const data = JSON.parse(readFileSync(new URL("../data/releases.json", import.meta.url)));
const h = new Map([[1, { id: 1, title: "Zelda Switch 2 sold out again", link: "https://news.example/zelda", sourceName: "Example News" }],
                   [2, { id: 2, title: "Maker reveals the Zork Test Pad", link: "https://news.example/zork", sourceName: "Example News" }]]);
const FIRST = data.items[0].id; // any release will do for these
const firstStatus = data.items[0].status; // whatever it is today
const noChange = { status: null, price: null, releaseDate: null, releaseWindow: null, preordersOpened: null, appendNote: null, stores: null };

test("applies an update with timeline and source", () => {
  const { data: next, applied, skipped } = applyAll(data, [{
    kind: "update", itemId: FIRST, summary: "Sold out", confidence: "high", headlineIds: [1],
    changes: { ...noChange, status: "soldout" }, timelineEntry: { date: "2026-10-02", text: "Sold out again." }, newItem: null
  }], h, "2026-10-03");
  assert.equal(skipped.length, 0);
  const it = next.items.find(i => i.id === FIRST);
  assert.equal(it.status, "soldout");
  assert.equal(it.timeline.at(-1).text, "Sold out again.");
  assert.equal(it.sources.at(-1).url, "https://news.example/zelda");
  assert.equal(next.updated, "2026-10-03");
  assert.ok(prMarkdown({ applied, skipped, reviewed: 2, when: "now" }).includes("https://news.example/zelda"));
  assert.equal(data.items.find(i => i.id === FIRST).status, firstStatus, "original untouched");
});

test("adds a new release", () => {
  const { data: next, applied } = applyAll(data, [{
    kind: "new", itemId: "Zork Test Pad", summary: "New controller", confidence: "medium", headlineIds: [2],
    changes: noChange, timelineEntry: null,
    newItem: { name: "Zork Test Pad Limited Edition", category: "playstation", platform: "PS5", status: "announced", price: "$79.99",
      releaseDate: null, releaseWindow: "November 2026", preordersOpened: null, searchQuery: "Zork Test Pad",
      notes: ["Blue and white controller."], inTheBox: [], stores: ["psdirect", "bestbuy"], artType: "pad", artColors: ["#2E6FD8", "#FFFFFF", "#1A1A1A"] }
  }], h, "2026-10-03");
  assert.equal(applied.length, 1);
  const it = next.items.at(-1);
  assert.equal(it.id, "zork-test-pad");
  assert.equal(it.releaseWindow, "November 2026");
  assert.deepEqual(it.sources, [{ label: "Example News", url: "https://news.example/zork" }]);
});

test("drops bad proposals instead of breaking the data", () => {
  const { applied, skipped } = applyAll(data, [
    { kind: "update", itemId: "does-not-exist", summary: "x", confidence: "low", headlineIds: [1], changes: noChange, timelineEntry: null, newItem: null },
    { kind: "update", itemId: FIRST, summary: "x", confidence: "low", headlineIds: [99], changes: { ...noChange, price: "$1" }, timelineEntry: null, newItem: null },
    { kind: "update", itemId: FIRST, summary: "x", confidence: "low", headlineIds: [1], changes: { ...noChange, releaseDate: "Oct 29" }, timelineEntry: null, newItem: null }
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
    { kind: "update", itemId: FIRST, summary: "x", confidence: "high", headlineIds: [1], changes: { ...noChange, status: "restock" }, timelineEntry: null, newItem: null },
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
// The store's search link for a release, worked out from the data (so a change to a store's search address can't fail these).
const searchLink = (key, id) => { const d = plainData(); return d.stores[key].searchUrl + encodeURIComponent(d.items.find(i => i.id === id).searchQuery); };
const BB_SEARCH = id => searchLink("bestbuy", id);
const report = (over = {}) => new Map([[1, { id: 1, title: "Switch 2 Zelda edition is back in stock at Best Buy", link: "https://news.example/zelda-restock?utm_source=rss&utm_medium=feed",
  sourceName: "Example News", summary: "Best Buy has restocked it online.", published: "2026-10-12T09:00:00Z", ...over }]]);
const restockProposal = (restock, over = {}) => ({ kind: "update", itemId: PICK.id, summary: "Back in stock", confidence: "medium", headlineIds: [1],
  changes: { ...noChange, restock: { store: "bestbuy", date: TODAY, listingUrl: null, ...restock } }, timelineEntry: null, newItem: null, ...over });
const run = (restock, headline, over) => applyAll(plainData(), [restockProposal(restock, over)], report(headline), TODAY);
const logged = (r, n = 0) => r.data.items.find(i => i.id === PICK.id).restocks[n];

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
  assert.deepEqual(applied[0].diff.map(d => d[0]), ["restock", "restock link", "status", "sources"]);
  const md = prMarkdown({ applied, skipped, reviewed: 1, when: "now" });
  assert.match(md, /\| restock \|  \| `Best Buy, reported 2026-10-12` \|/);
  // The link that would be published is in the diff, so it can be looked at before merging.
  assert.ok(md.includes(`| restock link |  | \`${BB_SEARCH(PICK.id)}\` |`));
  assert.match(md, /Merging sends the "Reported back in stock" email to people following this release/);
  // Other kinds of change don't carry that warning.
  assert.doesNotMatch(prMarkdown({ applied: [{ p: { kind: "update", itemId: "x", summary: "s", confidence: "high" }, diff: [["price", "$1", "$2"]], used: [] }], skipped: [], reviewed: 1, when: "now" }), /Merging sends/);
});

test("a restock link is only used when the report's own text has it and it's on the store's website", () => {
  const page = "https://www.bestbuy.com/site/switch-2-zelda/6000000.p";
  const good = `${page}?skuId=6000000`;
  const withUrl = h => logged(run({ listingUrl: good }, h)).url;
  // Everything after the "?" comes off: a link inside a headline can carry a tag no list of tags knows about.
  assert.equal(withUrl({ summary: `Buy it here: ${good}&irclickid=abc` }), page);
  assert.equal(withUrl({}), BB_SEARCH(PICK.id)); // the model's link isn't in the report: it's not trusted
  assert.equal(withUrl({ summary: "Buy it at https://www.amazon.com/dp/B0ABC", title: good.replace("bestbuy.com", "bestbuy.com.evil.test") }), BB_SEARCH(PICK.id));
  const wrongSite = run({ listingUrl: "https://www.target.com/p/x/-/A-1" }, { summary: "https://www.target.com/p/x/-/A-1" });
  assert.equal(logged(wrongSite).url, BB_SEARCH(PICK.id)); // a Target link can't stand in for Best Buy
});

test("an affiliate link in a report's text is never published, whatever the tag is called", () => {
  const tagged = "https://www.target.com/p/switch-2-zelda/-/A-1?afid=x&wmlspartner=imp_1&veh=aff&somethingnew=abc";
  const r = run({ store: "target", listingUrl: tagged }, { summary: `Links to: ${tagged}` });
  assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));
  assert.equal(logged(r).url, "https://www.target.com/p/switch-2-zelda/-/A-1");
  // And it's what the pull request shows.
  assert.ok(prMarkdown({ applied: r.applied, skipped: [], reviewed: 1, when: "now" }).includes("| restock link |  | `https://www.target.com/p/switch-2-zelda/-/A-1` |"));
});

test("a restock report that can't be trusted is dropped with a reason", () => {
  const dropped = (restock, headline, over) => { const r = run(restock, headline, over); assert.equal(r.applied.length, 0); return r.skipped[0].reason; };
  assert.match(dropped({}, { link: "https://www.amazon.com/dp/B0ABC?tag=dealsite-20" }), /goes to Amazon/);
  assert.match(dropped({ date: "Oct 12" }), /no usable date/);
  assert.match(dropped({}, { published: "2026-10-01T09:00:00Z" }), /too old to send as news/);
  assert.match(dropped({ date: "2026-10-01" }, { published: null }), /too old to send as news/);
  assert.match(dropped({ date: "2026-10-01" }), /too old to send as news/); // an old date for a new article is still old
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

test("planned stock isn't a restock", () => {
  // "Target restocks on Friday" is a plan, not news that it's in stock now, even when the article came out today.
  for (const date of ["2026-10-15", "2026-11-01", "2027-01-01"]) {
    const r = run({ date });
    assert.equal(r.applied.length, 0, date);
    assert.match(r.skipped[0].reason, new RegExp(`dated ${date}, which hasn't happened yet`));
  }
  // A day ahead is only a time zone.
  assert.equal(run({ date: "2026-10-13" }).applied.length, 1);
});

test("a restock is never dated newer than the news about it, in New York time", () => {
  const day = (restock, headline) => logged(run(restock, headline)).date;
  // The model can't make it newer than the report: the report came out on the 10th, so that's the latest it can be.
  assert.equal(day({ date: TODAY }, { published: "2026-10-10T15:00:00Z" }), "2026-10-10");
  // It can make it older (the report says "last Friday"): the earlier day is kept, and the page says it may be gone.
  assert.equal(day({ date: "2026-10-09" }, { published: "2026-10-12T09:00:00Z" }), "2026-10-09");
  // New York time: 10:30pm on the 11th there is already the 12th in UTC, which is the date the model is shown.
  assert.equal(day({ date: "2026-10-12" }, { published: "2026-10-12T02:30:00Z" }), "2026-10-11");
  // With no date on the report, the model's date is used. A day ahead counts as today.
  assert.equal(day({ date: "2026-10-09" }, { published: null }), "2026-10-09");
  assert.equal(day({ date: "2026-10-13" }, { published: null }), TODAY);
  // A report dated after today (a clock that's off) counts as today.
  assert.equal(day({ date: TODAY }, { published: "2026-10-14T12:00:00Z" }), TODAY);
  // A date that can't be read is ignored rather than trusted.
  assert.equal(day({ date: "2026-10-11" }, { published: "not a date" }), "2026-10-11");
  // Cited reports: the newest one sets how fresh it can be.
  const two = new Map([[1, { ...report().get(1), published: "2026-10-08T09:00:00Z" }], [2, { ...report().get(1), id: 2, link: "https://news.example/second", published: "2026-10-11T09:00:00Z" }]]);
  const both = applyAll(plainData(), [restockProposal({}, { headlineIds: [1, 2] })], two, TODAY);
  assert.equal(logged(both).date, "2026-10-11");
});

test("a headline can't add headings or lists to the pull request", () => {
  const evil = report({ title: "Zelda restock\n\n## Approved by the maintainer\n- [x] merge me", summary: "one\n# Another heading", sourceName: "Example\n## News",
    link: "https://news.example/a)\n## Link heading" });
  const { applied, skipped } = applyAll(plainData(), [
    restockProposal({}, { summary: "Back\n\n## Approved\n- ok" }),
    { ...restockProposal({}), itemId: "no-such-release\n## Dropped heading", summary: "x\n## Also dropped" }
  ], evil, TODAY);
  assert.equal(applied.length, 1);
  assert.equal(skipped.length, 1);
  const md = prMarkdown({ applied, skipped, reviewed: 1, when: "now" });
  assert.deepEqual(md.split("\n").filter(l => l.startsWith("#")), ["### News check, now", `#### Update: ${PICK.id}`]);
  assert.ok(!md.split("\n").some(l => /^\s*(##|- \[x\]|# )/.test(l) && !l.startsWith("###")));
  assert.ok(md.includes("Dropped heading") && md.includes("Approved")); // the text is still shown, just on one line
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
