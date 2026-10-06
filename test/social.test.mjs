import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socialPosts, MAX_LENGTH } from "../lib/social.js";

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
