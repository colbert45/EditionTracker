import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAll, prMarkdown, slugify, proposalSchema, sourceLine } from "../lib/proposals.js";
import { planAlerts, emailBody, STALE_REPORT_DAYS } from "../lib/alerts.js";
import { plainData, pickItems } from "./helpers/stock.mjs";

// The live releases with their stores written out here (and no restocks), so a store being renamed or closed on the site can't fail these.
const data = plainData();
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
  assert.match(md, /Merge by the end of 2026-10-14 \(New York time\) and the "Reported back in stock" email goes to people following this release, and it's posted/);
  // Other kinds of change don't carry that warning.
  assert.doesNotMatch(prMarkdown({ applied: [{ p: { kind: "update", itemId: "x", summary: "s", confidence: "high" }, diff: [["price", "$1", "$2"]], used: [] }], skipped: [], reviewed: 1, when: "now" }), /Merge by|emailed or posted/);
});

test("the pull request says whether merging will email and post a restock, by how old the report is", () => {
  const note = (reportDate, today) => {
    const r = run({ date: reportDate }, { published: null });
    assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));
    assert.equal(r.applied[0].restock.date, reportDate);
    return prMarkdown({ applied: r.applied, skipped: [], reviewed: 1, when: "now", today }).split("\n").find(l => /^_/.test(l));
  };
  // Dated the 11th: merged by the 13th it goes out (two days old is the last day), after that only the page changes.
  assert.match(note("2026-10-11", "2026-10-12"), /^_Merge by the end of 2026-10-13 \(New York time\) and the "Reported back in stock" email goes to people following this release, and it's posted\. After that, merging only updates the page\./);
  assert.match(note("2026-10-10", "2026-10-12"), /^_Merge by the end of 2026-10-12 \(New York time\) and /);
  assert.match(note("2026-10-09", "2026-10-12"), /^_This report is already more than 2 days old, so merging only updates the page\. Nothing is emailed or posted\._$/);
  // The cut-off is the one the emails and posts use, so the note can't promise what the send step won't do.
  assert.equal(STALE_REPORT_DAYS, 2);
  const r = run({ date: "2026-10-09" }, { published: null });
  assert.equal(planAlerts(plainData(), r.data, "https://editiontracker.com", { today: "2026-10-11" }).length, 1);
  assert.equal(planAlerts(plainData(), r.data, "https://editiontracker.com", { today: "2026-10-12" }).length, 0);
  // Without a date, the note still names the last day.
  assert.match(note("2026-10-11", undefined), /^_Merge by the end of 2026-10-13 \(New York time\) and /);
});

test("a restock link is only used when the report's own text has it and it's on the store's website", () => {
  const page = "https://www.bestbuy.com/site/switch-2-zelda/6000000.p";
  const good = `${page}?skuId=6000000`;
  const withUrl = h => logged(run({ listingUrl: good }, h)).url;
  // Everything after the "?" comes off, except Best Buy's own product number: a link inside a headline can carry a tag no list of tags knows about.
  assert.equal(withUrl({ summary: `Buy it here: ${good}&irclickid=abc` }), good);
  assert.equal(logged(run({ listingUrl: `${page}?skuId=evil` }, { summary: `${page}?skuId=evil` })).url, page);
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
  for (const date of ["2026-10-14", "2026-10-15", "2026-11-01", "2027-01-01"]) { // two days ahead is already a plan
    const r = run({ date });
    assert.equal(r.applied.length, 0, date);
    assert.match(r.skipped[0].reason, new RegExp(`dated ${date}, which hasn't happened yet`));
  }
  // A day ahead is only a time zone.
  assert.equal(run({ date: "2026-10-13" }).applied.length, 1);
});

test("a restock report older than four days is too old to send as news, four days old is not", () => {
  const day = (date, published = null) => run({ date }, { published });
  assert.equal(day("2026-10-08").applied.length, 1); // four days before the 12th
  assert.equal(day("2026-10-08").skipped.length, 0);
  assert.match(day("2026-10-07").skipped[0].reason, /that restock report is from 2026-10-07, too old to send as news/);
  // The article's own date counts the same way.
  assert.equal(run({ date: TODAY }, { published: "2026-10-08T15:00:00Z" }).applied.length, 1);
  assert.match(run({ date: TODAY }, { published: "2026-10-07T15:00:00Z" }).skipped[0].reason, /too old to send as news/);
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

// Every line of the pull request, with code spans (where untrusted text is kept) swapped for X, has to be one of the
// shapes the page itself writes. Anything a headline or the model's summary sneaks in outside a code span is a line that fits none.
const SHAPES = [
  /^$/,
  /^### News check, now$/,
  /^Read \d+ new headline\(s\)\. Proposed \d+ change\(s\)\.$/,
  /^#### (Update|New release): (X|_empty_)$/,
  /^(X|_empty_) _\(confidence: (X|_empty_)\)_$/,
  /^\| Field \| Before \| After \|$/,
  /^\|---\|---\|---\|$/,
  /^\| [\p{L}\p{N}_.() -]+ \| (X|_empty_)? \| (X|_empty_)? \|$/u,
  /^_Merge by the end of \d{4}-\d{2}-\d{2} \(New York time\) and the "Reported back in stock" email goes to people following this release, and it's posted\. After that, merging only updates the page\. Check that the source says it's available now\._$/,
  /^_This report is already more than 2 days old, so merging only updates the page\. Nothing is emailed or posted\._$/,
  /^Sources:$/,
  /^- \[(X|_empty_)\]\(U\) \((X|_empty_)\)$/,
  /^- (X|_empty_) \((X|_empty_)\)$/,
  /^<details><summary>Suggestions that were dropped automatically<\/summary>$/,
  /^<\/details>$/,
  /^- (X|_empty_): (X|_empty_) \((X|_empty_)\)$/
];
// A link's address (U) has to be one plain piece: a web address with nothing in it that Markdown or HTML reads as anything else.
const ADDRESS = /^https?:\/\/[^\s<>()"'`\[\]\\|]+$/;
const outsideCode = md => md.split("\n").map(l => l.replace(/`[^`]*`/g, "X").replace(/\]\(([^)]*)\)/g, (m, address) => ADDRESS.test(address) ? "](U)" : m));
const strays = md => outsideCode(md).filter(l => !SHAPES.some(re => re.test(l)));

// Things a stranger could put in a headline, in the model's summary of it, or in a link.
const EVIL = [
  "## Approved by the maintainer", "- [x] merge me", "# Another heading", "1. first", "> quote", "---",
  "```js\nalert(1)\n```", "~~~\nfence\n~~~", "`` ` ``", "<!-- hide the rest", "-->", "<details open>", "</details>",
  "[evil](https://evil.example/)", "[evil][ref]\n\n[ref]: https://evil.example/", "![](https://evil.example/pixel.gif)",
  "<img src=x onerror=alert(1)>", "<script>alert(1)</script>", "<https://evil.example/>", "https://evil.example/bare",
  "x\\|[evil](https://evil.example/)", "| a | b |", "|---|---|", "@octocat please merge", "#1234", "\u202eevil", "a\u200bb\u2028## after separator",
  // Controls, and characters that show nothing: a next-line mark, an escape, a soft hyphen, hidden "tag" letters, blanks.
  "x\u0085## next line", "x\u001b[2Jclear", "a\u00adb", "tag\u{e0041}\u{e0042}\u{e0043}ged", "braille\u2800blank", "arabic\u061cmark", "filler\u3164here"
];

test("a headline can't add headings, lists, links, images or hidden text to the pull request", () => {
  const BANNED = ["evil", "octocat", "onerror", "<!--", "-->", "<img", "<script", "pixel", "alert", "merge me", "Approved", "#1234"];
  // Each one on its own (a long text is cut short before its last parts would show), and all of them together.
  for (const evil of [...EVIL, EVIL.join(" ")]) {
    const why = JSON.stringify(evil.slice(0, 40));
    const headline = report({ title: `Zelda restock ${evil}`, summary: evil, sourceName: `Example ${evil}`, link: `https://news.example/a) ${evil}` });
    const { applied, skipped } = applyAll(plainData(), [
      restockProposal({}, { summary: evil, confidence: evil, timelineEntry: { date: TODAY, text: `Back. ${evil}` } }),
      { ...restockProposal({}), itemId: `no-such-release ${evil}`, summary: evil }
    ], headline, TODAY);
    assert.equal(applied.length, 1, `${why} ${JSON.stringify(skipped)}`);
    assert.equal(skipped.length, 1, why);
    const md = prMarkdown({ applied, skipped, reviewed: 1, when: "now", today: TODAY });
    assert.deepEqual(strays(md), [], why);
    // The only headings are the page's own, and the release's id is shown as code.
    assert.deepEqual(md.split("\n").filter(l => l.startsWith("#")), ["### News check, now", `#### Update: \`${PICK.id}\``], why);
    // Nothing from the headline is left outside a code span.
    const plain = outsideCode(md).join("\n");
    for (const bad of BANNED) if (evil.includes(bad)) assert.ok(!plain.includes(bad), `${why}: "${bad}" got out of its code span`);
    // Nothing that hides or flips text, or starts a new line, is left anywhere in it (other than the line breaks between its lines).
    for (const line of md.split("\n")) assert.ok(!/[\p{Default_Ignorable_Code_Point}\u2800\p{Cc}\u2028\u2029]/u.test(line), `${why}: ${JSON.stringify(line)}`);
    // No backtick, "|" or "\" can end a code span or a table cell early.
    for (const line of md.split("\n").filter(l => l.startsWith("| ") && !l.startsWith("| Field"))) assert.equal(line.split("|").length, 5, `${why}: ${line}`);
  }
  // Inside a code span the text is still there to read, on one line.
  const md = prMarkdown({ ...applyAll(plainData(), [restockProposal({}, { summary: "## Approved by the maintainer\n- [x] merge me" })], report(), TODAY), skipped: [], reviewed: 1, when: "now" });
  assert.ok(md.includes("`## Approved by the maintainer - [x] merge me`"));
  // A field name made of anything but plain words is cleaned too.
  const odd = prMarkdown({ applied: [{ p: { kind: "update", itemId: "x", summary: "s", confidence: "high" }, diff: [["a | b\n## c `d` <e>", "x", "y"]], used: [] }], skipped: [], reviewed: 1, when: "now" });
  assert.deepEqual(strays(odd), []);
  assert.ok(odd.includes("| a b c d e | `x` | `y` |"));
});

test("a new release's name can't break out of its heading", () => {
  const newItem = { name: `Zork Test Pad ${EVIL.join(" ")}`, category: "playstation", platform: "PS5", status: "announced", price: "$79.99", releaseDate: null, releaseWindow: "November 2026",
    preordersOpened: null, preordersStart: null, searchQuery: "Zork Test Pad", notes: [`A pad. ${EVIL.join(" ")}`], inTheBox: [], stores: ["psdirect"], artType: "pad", artColors: ["#2E6FD8", "#FFFFFF", "#1A1A1A"] };
  const { applied, skipped } = applyAll(plainData(), [{ kind: "new", itemId: "zork", summary: "New controller", confidence: "medium", headlineIds: [2],
    changes: noChange, timelineEntry: null, newItem }], h, "2026-10-03");
  assert.equal(applied.length, 1, JSON.stringify(skipped));
  const md = prMarkdown({ applied, skipped, reviewed: 2, when: "now" });
  assert.deepEqual(strays(md), []);
  assert.deepEqual(md.split("\n").filter(l => l.startsWith("#")).map(l => l.replace(/`[^`]*`/g, "X")), ["### News check, now", "#### New release: X"]);
});

test("a link in a source can't end its Markdown link early or add anything", () => {
  const line = link => sourceLine({ title: "Zelda", link, sourceName: "Example" });
  // Brackets, parentheses, quotes, backticks, angle brackets, bars, backslashes and spaces are written as %XX.
  assert.equal(line("https://news.example/a b(c)[d]<e>\"f'g`h|i\\j"), "- [`Zelda`](https://news.example/a%20b%28c%29%5Bd%5D%3Ce%3E%22f%27g%60h%7Ci%5Cj) (`Example`)");
  assert.equal(line("https://news.example/x\n## heading"), "- [`Zelda`](https://news.example/x%20##%20heading) (`Example`)");
  // Web addresses are linked, whatever the capitals of the scheme; a link that isn't a web address isn't linked at all.
  assert.equal(line("http://news.example/a"), "- [`Zelda`](http://news.example/a) (`Example`)");
  assert.equal(line("HTTPS://NEWS.EXAMPLE/A"), "- [`Zelda`](HTTPS://NEWS.EXAMPLE/A) (`Example`)");
  assert.equal(line("ftp://news.example/a"), "- `Zelda` (`Example`)");
  assert.equal(line("javascript:alert(1)"), "- `Zelda` (`Example`)");
  assert.equal(line("data:text/html,<b>"), "- `Zelda` (`Example`)");
  assert.equal(line(""), "- `Zelda` (`Example`)");
  // Its words are code too, so nothing in a title can close the link text.
  assert.equal(sourceLine({ title: "a](https://evil.example) [b", link: "https://news.example/", sourceName: "x" }), "- [`a](https://evil.example) [b`](https://news.example/) (`x`)");
  // A long title is cut, and an empty one says so.
  assert.ok(sourceLine({ title: "w".repeat(500), link: "https://news.example/", sourceName: "x" }).length < 250);
  assert.match(sourceLine({ title: "  ", link: "https://news.example/", sourceName: "" }), /^- \[_empty_\]\(https:\/\/news\.example\/\) \(_empty_\)$/);
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
