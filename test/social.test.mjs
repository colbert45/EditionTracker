import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socialPosts, outTodayPosts, weekAheadPost, MAX_LENGTH } from "../lib/social.js";
import { msrpText } from "../lib/msrp.js";
import { plainData, pickItems } from "./helpers/stock.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const base = () => JSON.parse(readFileSync(ROOT + "data/releases.json", "utf8"));
const SITE = "https://editiontracker.com";

test("no changes, no posts", () => {
  assert.deepEqual(socialPosts(base(), base(), SITE), []);
});

test("preorders opening makes a post with the link", () => {
  const old = base(), now = base();
  const it = now.items.find(i => i.status === "announced");
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
  const c = now.items.find(i => i.category === "games");
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
  const it = d.items.find(i => i.releaseDate && i.status !== "rumor");
  const posts = outTodayPosts(d, it.releaseDate, SITE);
  assert.ok(posts.some(p => p.text.startsWith(`Out today: ${it.name}`) && p.text.endsWith(`${SITE}/${it.id}/`)));
  for (const p of posts) assert.ok(p.text.length <= MAX_LENGTH);
  d.items.push({ ...it, id: "r", name: "Rumor", status: "rumor" });
  assert.ok(!outTodayPosts(d, it.releaseDate, SITE).some(p => p.id === "r"));
});

test("the week-ahead post lists this week's dates, fits, and links the calendar", () => {
  const d = base();
  const it = d.items.find(i => i.releaseDate && i.status !== "rumor");
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
  const it = now.items.find(i => i.status === "preorder" && i.releaseDate);
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
  const old = plainData(), now = plainData();
  const target = now.items.find(i => i.status === "announced");
  target.status = "preorder"; target.preordersOpened = "2026-10-06";
  const [other] = socialPosts(old, now, SITE);
  assert.equal(other.restock, undefined);
  assert.equal(other.discord, undefined);
});
