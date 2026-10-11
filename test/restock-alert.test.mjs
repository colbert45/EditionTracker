import { test } from "node:test";
import assert from "node:assert/strict";
import { planAlerts, emailBody, roundupEmail } from "../lib/alerts.js";
import { socialPosts } from "../lib/social.js";
import { msrpText, dollars } from "../lib/msrp.js";
import { plainData as base, pickItems } from "./helpers/stock.mjs";

const SITE = "https://editiontracker.com";
const PICK = pickItems(base()).item;
const ID = PICK.id;
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BB = { date: "2026-10-09", store: "bestbuy", url: "https://www.bestbuy.com/site/example/1.p", source: "https://example.com/news/restock" };
const TG = { date: "2026-10-09", store: "target", url: "https://www.target.com/p/example/-/A-1", source: null };

const restocked = (restocks, status = "restock") => {
  const old = base(), now = base();
  const it = now.items.find(i => i.id === ID);
  it.status = status; it.restocks = restocks;
  return { old, now, it };
};

test("a new restock emails the item's and the category's subscribers", () => {
  const { old, now, it } = restocked([BB]);
  const alerts = planAlerts(old, now, SITE);
  assert.equal(alerts.length, 1);
  const [a] = alerts;
  assert.equal(a.kind, "restock");
  assert.deepEqual(a.tags, [`item:${ID}`, `type:${it.category}`]);
  assert.equal(a.subject, `Back in stock: ${it.name} at Best Buy`);
  // The listing comes first, then the MSRP line, the source, the tip line.
  const body = emailBody(a, now.categories);
  assert.ok(body.indexOf(BB.url) < body.indexOf("MSRP"), "listing before MSRP");
  assert.match(body, /^## Back in stock: /);
  assert.match(body, /\*\*Best Buy\*\* has it\. \[Go to the listing →\]\(https:\/\/www.bestbuy.com\/site\/example\/1.p\)/);
  assert.match(body, /Source: \[example.com\]\(https:\/\/example.com\/news\/restock\)/);
  assert.match(body, new RegExp(`\\*\\*MSRP ${escape(msrpText(PICK))}\\.\\*\\* Don't pay more\\.`));
  assert.match(body, /\[tips@editiontracker.com\]\(mailto:tips@editiontracker.com\)/);
  assert.match(body, new RegExp(`\\(${SITE}/${ID}/\\)`));
  assert.doesNotMatch(body, /Status:/);
});

test("two retailers at once make one email, and no Source line when there isn't one", () => {
  const { old, now } = restocked([BB, TG]);
  const alerts = planAlerts(old, now, SITE);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, / at Best Buy and Target$/);
  const body = emailBody(alerts[0], now.categories);
  assert.match(body, /\*\*Target\*\* has it\./);
  assert.equal((body.match(/Source:/g) || []).length, 1);
});

test("a source that just repeats the listing link is left out", () => {
  const { old, now } = restocked([{ ...BB, source: BB.url }]);
  assert.doesNotMatch(emailBody(planAlerts(old, now, SITE)[0], now.categories), /Source:/);
});

test("a restock from a news report says so, and that it may be gone", () => {
  const RP = { date: "2026-10-09", store: "bestbuy", url: "https://www.bestbuy.com/site/searchpage.jsp?st=Example", source: "https://www.nintendolife.com/news/2026/10/best-buy-restock", reported: true };
  const { old, now, it } = restocked([RP]);
  const [a, ...rest] = planAlerts(old, now, SITE);
  assert.equal(rest.length, 0);
  assert.equal(a.subject, `Reported back in stock: ${it.name} at Best Buy`);
  assert.deepEqual(a.lines, ["Reported back in stock at Best Buy."]);
  const body = emailBody(a, now.categories);
  assert.match(body, new RegExp(`^## Reported back in stock: `));
  assert.match(body, /\*\*Best Buy\*\* was reported back in stock on Oct 9, 2026, per \[nintendolife.com\]\(https:\/\/www.nintendolife.com\/news\/2026\/10\/best-buy-restock\)\./);
  assert.match(body, /That report may be hours old, so it may already be gone\. \[Check Best Buy →\]\(https:\/\/www.bestbuy.com\/site\/searchpage.jsp\?st=Example\)/);
  assert.doesNotMatch(body, /has it\./); // it doesn't claim the store has it
  assert.match(body, new RegExp(`\\*\\*MSRP ${escape(msrpText(PICK))}\\.\\*\\* Don't pay more\\.`));
  // One checked at the store and one reported: the email leads with the confirmed wording and keeps each line honest.
  const mixed = restocked([BB, RP]);
  const [m] = planAlerts(mixed.old, mixed.now, SITE);
  assert.equal(m.subject, `Back in stock: ${mixed.it.name} at Best Buy`);
  const mixedBody = emailBody(m, mixed.now.categories);
  assert.match(mixedBody, /^## Back in stock: /);
  assert.match(mixedBody, /has it\. \[Go to the listing →\]/);
  assert.match(mixedBody, /was reported back in stock on/);
  // The weekly roundup says "Reported" too.
  assert.match(roundupEmail(planAlerts(old, now, SITE), now.categories).body, /Reported back in stock at Best Buy\./);
});

test("a bracket in a link can't end the Markdown link early", () => {
  const url = "https://www.bestbuy.com/site/zelda-(40th)/6000000.p?skuId=6000000";
  const source = "https://en.wikipedia.org/wiki/Nintendo_(company)";
  const { old, now } = restocked([{ ...BB, url, source }]);
  const body = emailBody(planAlerts(old, now, SITE)[0], now.categories);
  assert.match(body, /\[Go to the listing →\]\(https:\/\/www.bestbuy.com\/site\/zelda-%2840th%29\/6000000.p\?skuId=6000000\)/);
  assert.match(body, /Source: \[en.wikipedia.org\]\(https:\/\/en.wikipedia.org\/wiki\/Nintendo_%28company%29\)/);
});

test("a later restock alerts again, and nothing alerts when nothing is new", () => {
  const old = base(), mid = base(), now = base();
  for (const [d, r] of [[mid, [BB]], [now, [BB, TG]]]) { const it = d.items.find(i => i.id === ID); it.status = "restock"; it.restocks = r; }
  const alerts = planAlerts(mid, now, SITE);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, / at Target$/);
  assert.deepEqual(planAlerts(now, now, SITE), []);
  assert.equal(planAlerts(old, mid, SITE).length, 1);
});

test("a second restock of the same listing on the same day still alerts", () => {
  const old = base(), now = base();
  for (const [d, r] of [[old, [BB]], [now, [BB, BB]]]) { const it = d.items.find(i => i.id === ID); it.status = "restock"; it.restocks = r; }
  const alerts = planAlerts(old, now, SITE);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].restocks.length, 1);
  // The same two entries on both sides are nothing new.
  assert.deepEqual(planAlerts(now, now, SITE), []);
});

test("flipping the status without a log entry still says Back in stock", () => {
  const { old, now, it } = restocked([]);
  const [a, ...rest] = planAlerts(old, now, SITE);
  assert.equal(rest.length, 0);
  assert.equal(a.kind, "status");
  assert.equal(a.subject, `Back in stock: ${it.name}`);
});

test("a restock and a status change together are one email", () => {
  const old = base();
  old.items.find(i => i.id === ID).status = "soldout";
  const now = base();
  const it = now.items.find(i => i.id === ID);
  it.status = "restock"; it.restocks = [BB];
  const alerts = planAlerts(old, now, SITE);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "restock");
  assert.ok(!alerts[0].lines.some(l => l.startsWith("Status:")));
});

test("a restock makes one social post, and a status flip with no log entry makes none", () => {
  const { old, now, it } = restocked([BB]);
  const posts = socialPosts(old, now, SITE);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].restock, true);
  assert.equal(posts[0].text.split("\n")[0], `Back in stock: ${it.name} at Best Buy`);
  const o2 = base();
  o2.items.find(i => i.id === ID).status = "soldout";
  const n2 = base();
  n2.items.find(i => i.id === ID).status = "restock";
  assert.deepEqual(socialPosts(o2, n2, SITE), []);
});

test("the weekly roundup mentions a restock", () => {
  const { old, now } = restocked([BB]);
  const r = roundupEmail(planAlerts(old, now, SITE), now.categories);
  assert.match(r.body, /Back in stock at Best Buy\./);
});

test("MSRP is only claimed for one plain dollar amount", () => {
  const it = p => ({ status: "preorder", price: p });
  assert.equal(msrpText(it("$519.99")), "$519.99");
  assert.equal(msrpText(it("$249")), "$249");
  assert.equal(msrpText(it("$99.99 each")), "$99.99 each");
  assert.equal(msrpText(it("$6,300")), "$6,300");
  assert.equal(msrpText(it("$119.99 to $209.99")), null);
  assert.equal(msrpText(it("TBA")), null);
  assert.equal(msrpText({ status: "rumor", price: "$12.99" }), null);
  assert.equal(msrpText({ status: "out", price: "TBA", msrp: "$59.99" }), "$59.99");
  assert.equal(dollars("$1,299.99"), 1299.99);
  assert.equal(dollars("TBA"), null);
});
