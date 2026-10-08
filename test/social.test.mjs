import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socialPosts, outTodayPosts, weekAheadPost, MAX_LENGTH } from "../lib/social.js";

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
  now.items[0].timeline.push({ date: "2026-10-06", text: "Restock at Target." });
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
