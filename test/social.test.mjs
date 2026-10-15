import { test } from "node:test";
import assert from "node:assert/strict";
import { socialPosts, outTodayPosts, weekAheadPost, MAX_LENGTH } from "../lib/social.js";
import { msrpText } from "../lib/msrp.js";
import { xLength, X_LIMIT, forX } from "../lib/xpost.js";
import { plainData, pickItems, steadyData } from "./helpers/stock.mjs";

// The real releases, steadied so these tests don't depend on what's live today (see steadyData).
const base = steadyData;
const SITE = "https://editiontracker.com";

test("no changes, no posts", () => {
  assert.deepEqual(socialPosts(base(), base(), SITE), []);
});

test("preorders opening makes a post with the link", () => {
  const old = base(), now = base();
  const it = now.items.find(i => i.id === "test-announced");
  it.status = "preorder"; it.preordersOpened = "2026-10-06";
  const [p, ...rest] = socialPosts(old, now, SITE);
  assert.equal(rest.length, 0);
  assert.ok(p.text.startsWith(`Preorders open: ${it.name}`));
  assert.ok(p.text.endsWith(`${SITE}/${it.id}/`));
  assert.ok(p.text.length <= MAX_LENGTH);
});

test("a price change or timeline note alone isn't posted", () => {
  const old = base(), now = base();
  now.items[0].price = "$1.00";
  now.items[0].timeline.push({ date: "2026-10-06", text: "Shown in a new trailer." });
  assert.deepEqual(socialPosts(old, now, SITE), []);
});

test("each new release gets its own post, and long names still fit", () => {
  const old = base(), now = base();
  const c = now.items.find(i => i.id === "test-announced");
  now.items.push({ ...c, id: "new-a", name: "New A", status: "announced" },
    { ...c, id: "new-b", name: "B".repeat(400), status: "preorder" });
  const posts = socialPosts(old, now, SITE);
  assert.equal(posts.length, 2);
  assert.match(posts[0].text, /^New: New A/);
  assert.match(posts[1].text, /^New, preorders open: B+…/);
  for (const p of posts) assert.ok(p.text.length <= MAX_LENGTH, p.text.length);
});

test("a new rumor isn't posted", () => {
  const old = base(), now = base();
  now.items.push({ ...now.items[0], id: "just-a-rumor", name: "Rumored Thing", status: "rumor" });
  assert.deepEqual(socialPosts(old, now, SITE), []);
});

test("release day gets an Out today post; rumors don't", () => {
  const d = base();
  const it = d.items.find(i => i.id === "test-preorder");
  const posts = outTodayPosts(d, it.releaseDate, SITE);
  assert.ok(posts.some(p => p.text.startsWith(`Out today: ${it.name}`) && p.text.endsWith(`${SITE}/${it.id}/`)));
  for (const p of posts) assert.ok(p.text.length <= MAX_LENGTH);
  d.items.push({ ...it, id: "r", name: "Rumor", status: "rumor" });
  assert.ok(!outTodayPosts(d, it.releaseDate, SITE).some(p => p.id === "r"));
});

test("the week-ahead post lists this week's dates, fits, and links the calendar", () => {
  const d = base();
  const it = d.items.find(i => i.id === "test-preorder");
  for (let k = 0; k < 12; k++) d.items.push({ ...it, id: `x${k}`, name: `A long special edition name number ${k}`, status: "preorder" });
  const p = weekAheadPost(d, it.releaseDate, SITE);
  assert.ok(p.text.startsWith("Coming out this week:"));
  assert.ok(p.text.endsWith(`${SITE}/calendar/`));
  assert.match(p.text, /\+ \d+ more/);
  assert.ok(p.text.length <= MAX_LENGTH);
  assert.equal(weekAheadPost(d, "1999-01-01", SITE), null);
});

test("a restock note is posted as stock news; other notes aren't", () => {
  const old = base(), now = base();
  const it = now.items.find(i => i.id === "test-preorder");
  it.timeline.push({ date: "2026-10-09", text: "Best Buy will sell limited extra units in stores at launch." });
  const [p, ...rest] = socialPosts(old, now, SITE);
  assert.equal(rest.length, 0);
  assert.ok(p.text.startsWith(`Stock news: ${it.name}`));
  assert.match(p.text, /\nBest Buy will sell limited extra units in stores at launch\.\n/);
  assert.ok(p.text.length <= MAX_LENGTH);
  const old2 = base(), now2 = base();
  now2.items[0].timeline.push({ date: "2026-10-09", text: "Shown in a new trailer." });
  assert.deepEqual(socialPosts(old2, now2, SITE), []);
});

// ---------- restock posts ----------
const { item: PICK } = pickItems(plainData());
const restockPosts = (restocks, patch = {}) => {
  const old = plainData(), now = plainData();
  const it = now.items.find(i => i.id === PICK.id);
  Object.assign(it, { status: "restock", restocks, ...patch });
  return { posts: socialPosts(old, now, SITE), it };
};
const BB = { date: "2026-10-09", store: "bestbuy", url: "https://www.bestbuy.com/site/example/1.p", source: "https://example.com/news/restock" };
const TG = { date: "2026-10-09", store: "target", url: "https://www.target.com/p/example/-/A-1", source: null };
const RP = { date: "2026-10-09", store: "bestbuy", url: "https://www.bestbuy.com/site/searchpage.jsp?st=Example", source: "https://www.nintendolife.com/news/2026/10/restock", reported: true };

test("a restock post says where, the MSRP, and links the release page", () => {
  const { posts: [p, ...rest], it } = restockPosts([BB]);
  assert.equal(rest.length, 0);
  assert.equal(p.restock, true);
  assert.equal(p.text, `Back in stock: ${it.name} at Best Buy\nMSRP ${msrpText(it)}. Don't pay more.\n${SITE}/${PICK.id}/`);
  assert.ok(p.text.length <= MAX_LENGTH);
  assert.equal(p.url, `${SITE}/${PICK.id}/`);
});

test("a reported restock is posted as reported, and may be gone", () => {
  const { posts: [p], it } = restockPosts([RP]);
  assert.equal(p.text, `Reported back in stock: ${it.name} at Best Buy\nMSRP ${msrpText(it)}. Don't pay more. It may already be gone.\n${SITE}/${PICK.id}/`);
});

test("two stores make one post, and a release with no single price still says to buy from the store", () => {
  const { posts, it } = restockPosts([BB, TG], { price: "$119.99 to $209.99" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text.split("\n")[0], `Back in stock: ${it.name} at Best Buy and Target`);
  assert.equal(posts[0].text.split("\n")[1], "Buy from the store itself.");
});

test("a long name is shortened so the post still fits", () => {
  const { posts: [p] } = restockPosts([BB], { name: "A very long special edition name ".repeat(12) });
  assert.ok(p.text.length <= MAX_LENGTH, p.text.length);
  assert.match(p.text.split("\n")[0], /…$/);
  assert.ok(p.text.endsWith(`${SITE}/${PICK.id}/`));
});

test("the Discord version links each store without a preview, escapes the name, and ends with the release page", () => {
  const { posts: [p], it } = restockPosts([BB, RP], { name: "Zelda *Edition* _of_ `Time`" });
  const lines = p.discord.split("\n");
  assert.equal(lines[0], "**Back in stock: Zelda \\*Edition\\* \\_of\\_ \\`Time\\` at Best Buy**");
  assert.equal(lines[1], `MSRP ${msrpText(it)}. Don't pay more.`);
  assert.equal(lines[2], "Best Buy: <https://www.bestbuy.com/site/example/1.p>");
  assert.equal(lines[3], "Best Buy, reported per nintendolife.com: <https://www.bestbuy.com/site/searchpage.jsp?st=Example>");
  assert.equal(lines.at(-1), `${SITE}/${PICK.id}/`);
  assert.ok(p.discord.length < 2000);
  // Other posts have no Discord version, so they never go there.
  const old = base(), now = base();
  const target = now.items.find(i => i.id === "test-announced");
  target.status = "preorder"; target.preordersOpened = "2026-10-06";
  const [other] = socialPosts(old, now, SITE);
  assert.equal(other.restock, undefined);
  assert.equal(other.discord, undefined);
});

// ---------- posts for X: no link ----------
// X charges ten times as much for a post with a link in it, so its version of every post has none: the site is written
// in words ("editiontracker dot com", which X doesn't turn into a link) and hashtags help people find it. Bluesky keeps its link.
const NO_LINK = /https?:|www\.|\beditiontracker\.com|\b[a-z0-9-]+\.(com|org|net|io|gg|tv|co)\b/i;
const asNintendo = it => { it.category = "nintendo"; it.platform = "Nintendo Switch 2"; return it; };

test("a new release or big change is posted to X without its link, with the site named and hashtags", () => {
  const old = base(), now = base();
  const it = asNintendo(now.items.find(i => i.id === "test-announced"));
  it.status = "preorder"; it.preordersOpened = "2026-10-06";
  asNintendo(old.items.find(i => i.id === "test-announced"));
  const [p] = socialPosts(old, now, SITE);
  assert.ok(p.text.endsWith(`${SITE}/test-announced/`)); // Bluesky still gets the link
  assert.equal(p.xText, "Preorders open: Test test-announced\nNintendo Switch 2 · $99.99 · Expected 2099\nDetails: editiontracker dot com\n#Nintendo #Switch2 #SpecialEdition #GameCollecting");
  assert.doesNotMatch(p.xText, NO_LINK);
  // A brand new release too.
  const fresh = base(), more = base();
  more.items.push({ ...asNintendo({ ...more.items.find(i => i.id === "test-announced") }), id: "new-a", name: "New A", status: "announced" });
  const [n] = socialPosts(fresh, more, SITE);
  assert.equal(n.xText, "New: New A\nNintendo Switch 2 · $99.99 · Expected 2099\nDetails: editiontracker dot com\n#Nintendo #Switch2 #SpecialEdition #GameCollecting");
});

test("stock news, release day, restocks and the week ahead all have a version for X without a link", () => {
  // Stock news
  const old = base(), now = base();
  const it = asNintendo(now.items.find(i => i.id === "test-preorder"));
  asNintendo(old.items.find(i => i.id === "test-preorder"));
  it.timeline.push({ date: "2026-10-09", text: "Best Buy will sell limited extra units in stores at launch." });
  const [stock] = socialPosts(old, now, SITE);
  assert.match(stock.xText, /^Stock news: Test test-preorder\nNintendo Switch 2 · \$99\.99 · Out Jun 1, 2099\nBest Buy will sell limited extra units in stores at launch\.\nDetails: editiontracker dot com\n#Nintendo #Switch2 #SpecialEdition #GameCollecting$/);
  // A restock says where the links are
  const { posts: [restock], it: restocked } = restockPosts([BB]);
  assert.equal(restock.xText.split("\n").at(-2), "Store links: editiontracker dot com");
  assert.match(restock.xText.split("\n").at(-1), /^#Restock( #[A-Za-z0-9]+)*$/); // the hashtag people watching for stock follow
  assert.equal(restock.xText.split("\n")[0], `Back in stock: ${forX(restocked.name, SITE)} at Best Buy`); // a name that looks like an address is written in words
  // Release day
  const d = base();
  asNintendo(d.items.find(i => i.id === "test-preorder"));
  const [today] = outTodayPosts(d, "2099-06-01", SITE).filter(p => p.id === "test-preorder");
  assert.equal(today.xText, "Out today: Test test-preorder\nNintendo Switch 2 · $99.99\nDetails: editiontracker dot com\n#Nintendo #Switch2 #SpecialEdition #GameCollecting");
  // The week ahead
  const week = weekAheadPost(d, "2099-06-01", SITE);
  assert.ok(week.text.endsWith(`${SITE}/calendar/`));
  assert.ok(week.xText.startsWith("Coming out this week:\n• Jun 1: Test test-preorder"));
  assert.ok(week.xText.endsWith("\nFull calendar: editiontracker dot com\n#SpecialEdition"));
  for (const x of [stock.xText, restock.xText, today.xText, week.xText]) { assert.doesNotMatch(x, NO_LINK); assert.ok(xLength(x) <= X_LIMIT, x); }
});

test("a long list or a long name still fits on X, and the week ahead keeps its site line", () => {
  const d = base();
  const it = d.items.find(i => i.id === "test-preorder");
  for (let k = 0; k < 12; k++) d.items.push({ ...it, id: `x${k}`, name: `A long special edition name number ${k}`, status: "preorder" });
  const week = weekAheadPost(d, it.releaseDate, SITE);
  assert.ok(xLength(week.xText) <= X_LIMIT, xLength(week.xText));
  assert.match(week.xText, /\+ \d+ more\nFull calendar: editiontracker dot com/);
  const old = base(), now = base();
  const big = { ...now.items.find(i => i.id === "test-announced"), id: "big", name: "B".repeat(400), status: "preorder" };
  now.items.push(big);
  const [p] = socialPosts(old, now, SITE);
  assert.ok(xLength(p.xText) <= X_LIMIT, xLength(p.xText));
  assert.match(p.xText.split("\n")[0], /^New, preorders open: B+…$/);
});

test("a name that looks like a web address is written in words on X, and left alone on Bluesky", () => {
  const old = base(), now = base();
  now.items.push({ ...now.items.find(i => i.id === "test-announced"), id: "dot-com", name: "Xbox.com Edition", status: "announced" });
  const [p] = socialPosts(old, now, SITE);
  assert.match(p.text, /^New: Xbox\.com Edition/);
  assert.match(p.xText, /^New: Xbox dot com Edition\n/);
  assert.doesNotMatch(p.xText, NO_LINK);
});
