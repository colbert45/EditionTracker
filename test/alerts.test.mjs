import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planAlerts, emailBody } from "../lib/alerts.js";

const ROOT = new URL("..", import.meta.url).pathname;
const base = () => JSON.parse(readFileSync(ROOT + "data/releases.json", "utf8"));
const SITE = "https://editiontracker.com";

test("no changes, no alerts", () => {
  assert.deepEqual(planAlerts(base(), base(), SITE), []);
});

test("preorders opening goes to the item and its type", () => {
  const old = base(), now = base();
  const it = now.items.find(i => i.status === "announced");
  it.status = "preorder"; it.preordersOpened = "2026-10-06";
  const [a, ...rest] = planAlerts(old, now, SITE);
  assert.equal(rest.length, 0);
  assert.equal(a.subject, `Preorders open: ${it.name}`);
  assert.deepEqual(a.tags, [`item:${it.id}`, `type:${it.category}`]);
  assert.match(a.lines[0], /Announced → Preorders open/);
  assert.match(emailBody(a, now.categories), new RegExp(`${SITE}/${it.id}/`));
});

test("a price change or new timeline entry only goes to the item", () => {
  const old = base(), now = base();
  const it = now.items[0];
  it.price = "$1.00";
  it.timeline.push({ date: "2026-10-06", text: "Restock at Target." });
  const [a] = planAlerts(old, now, SITE);
  assert.deepEqual(a.tags, [`item:${it.id}`]);
  assert.ok(a.lines.some(l => l.startsWith("Price:")));
  assert.ok(a.lines.some(l => l.includes("Restock at Target.")));
});

test("a new release goes to its type; a new rumor waits", () => {
  const old = base(), now = base();
  const copy = { ...now.items[0], id: "brand-new", name: "Brand New Edition", status: "announced" };
  const rumor = { ...now.items[0], id: "just-a-rumor", name: "Rumored Thing", status: "rumor" };
  now.items.push(copy, rumor);
  const alerts = planAlerts(old, now, SITE);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].subject, "New: Brand New Edition");
  assert.deepEqual(alerts[0].tags, [`type:${copy.category}`]);
});

test("several new releases in one type become one email", () => {
  const old = base(), now = base();
  const c = now.items.find(i => i.category === "games");
  now.items.push({ ...c, id: "new-a", name: "New A", status: "announced" }, { ...c, id: "new-b", name: "New B", status: "preorder" });
  const alerts = planAlerts(old, now, SITE);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /^2 new Game editions: New A, New B$/);
  const body = emailBody(alerts[0], now.categories);
  assert.match(body, /new-a\//); assert.match(body, /new-b\//);
});

test("built pages carry the alert form with the right tags", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT });
  const data = base();
  const home = readFileSync(ROOT + "_site/index.html", "utf8");
  assert.match(home, /class="alert-btn" href="#alerts"/);
  for (const k of Object.keys(data.categories)) assert.match(home, new RegExp(`name="tag" value="type:${k}"`));
  assert.doesNotMatch(home, /value="item:/);
  const it = data.items.find(i => i.status === "preorder");
  const page = readFileSync(ROOT + `_site/${it.id}/index.html`, "utf8");
  assert.match(page, new RegExp(`name="tag" value="item:${it.id}" checked`));
  assert.match(page, /class="alert-me" href="#alerts"/);
});
