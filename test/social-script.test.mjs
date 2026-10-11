import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { applyRestock } from "../lib/restock.js";

// Runs scripts/social.mjs on a throwaway repo whose last commit logs a restock, with no keys set,
// so it can only say what it would post. Nothing is sent anywhere.
const ROOT = new URL("..", import.meta.url).pathname;
const NO_GLOBAL = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...NO_GLOBAL } }).trim();
const { item: PICK, other: OTHER } = pickItems(plainData());
const BB = "https://www.bestbuy.com/site/example/6000000.p?skuId=6000000";

function repoWithRestock(message, edit, editConfig) {
  const dir = mkdtempSync(join(tmpdir(), "et-social-"));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "data")); mkdirSync(join(dir, "scripts"));
  const config = JSON.parse(readFileSync(join(ROOT, "site.config.json"), "utf8"));
  if (editConfig) editConfig(config);
  writeFileSync(join(dir, "site.config.json"), JSON.stringify(config, null, 2));
  copyFileSync(join(ROOT, "scripts/social.mjs"), join(dir, "scripts/social.mjs"));
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  const before = plainData();
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(before, null, 2) + "\n");
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "Start");
  const start = git(dir, "rev-parse", "HEAD");
  const r = applyRestock(before, { item: PICK.id, retailer: "best buy", link: BB, source: "", today: "2026-10-09" });
  if (edit) edit(r.data); // more changes in the same commit
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(r.data, null, 2) + "\n");
  git(dir, "commit", "-q", "-am", message || r.message);
  return { dir, start, name: r.item.name };
}
function social(dir, start, env = {}, ...args) {
  const clean = { ...process.env, ...NO_GLOBAL };
  for (const k of ["BLUESKY_APP_PASSWORD", "X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET", "DISCORD_WEBHOOK_URL"]) delete clean[k];
  return spawnSync("node", ["scripts/social.mjs", start, ...args], { cwd: dir, encoding: "utf8", env: { ...clean, ...env } });
}

test("a restock commit makes a restock post, and with no keys it only says what it would post", () => {
  const { dir, start, name } = repoWithRestock();
  const r = social(dir, start);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run \(no Bluesky, X or Discord keys/);
  assert.match(r.stdout, new RegExp(`Back in stock: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at Best Buy\\n.*Don't pay more\\.\\nhttps://editiontracker.com/${PICK.id}/`));
  assert.doesNotMatch(r.stdout, /posted to/);
});

test("a Discord link that isn't Discord's is ignored, and the link is never printed", () => {
  const { dir, start } = repoWithRestock();
  const r = social(dir, start, { DISCORD_WEBHOOK_URL: "https://example.com/api/webhooks/123/secret-token-value" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DISCORD_WEBHOOK_URL is set but isn't a Discord webhook link\. Not posting to Discord\./);
  assert.ok(!r.stdout.includes("secret-token-value") && !r.stderr.includes("secret-token-value"));
  // Even a real-looking link isn't used (or printed) on a dry run.
  const dry = social(dir, start, { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123456789/token-abc" }, "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run/);
  assert.ok(!dry.stdout.includes("token-abc") && !dry.stderr.includes("token-abc"));
});

test("[no alerts] still keeps a restock commit from being posted", () => {
  const { dir, start } = repoWithRestock("Back in stock: something [no alerts]");
  const r = social(dir, start);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /A commit says \[no alerts\] or \[no posts\]\. Not posting\./);
});

test("a trailing line break on a pasted Discord link doesn't make it count as invalid", () => {
  const { dir, start } = repoWithRestock();
  const r = social(dir, start, { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123456789/token-abc\n" }, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /isn't a Discord webhook link/);
  assert.ok(!r.stdout.includes("token-abc") && !r.stderr.includes("token-abc"));
});

test("a bulk edit isn't posted, even when one release in it was restocked", () => {
  const changePrices = n => d => { let k = 0; for (const it of d.items) if (it.id !== PICK.id && k < n) { it.price = "$1.23"; k++; } };
  // 8 price changes and a restock is 9 releases changed at once.
  const bulk = repoWithRestock(undefined, changePrices(8));
  const r = social(bulk.dir, bulk.start);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /9 releases changed at once, which looks like a bulk edit\. Not posting\./);
  assert.doesNotMatch(r.stdout, /Back in stock/);
  // 7 and a restock is 8: still news.
  const fine = repoWithRestock(undefined, changePrices(7));
  assert.match(social(fine.dir, fine.start).stdout, /Back in stock: /);
});

test("a news report that's days old by the time it's merged isn't posted", () => {
  const ago = n => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const report = date => d => {
    const it = d.items.find(i => i.id === OTHER.id);
    it.status = "restock";
    it.restocks = [{ date, store: "bestbuy", url: "https://www.bestbuy.com/site/searchpage.jsp?st=x", source: "https://news.example/report", reported: true }];
  };
  // The restock checked at the store is posted; the six-day-old report in the same commit is not.
  const stale = repoWithRestock(undefined, report(ago(6)));
  const out = social(stale.dir, stale.start).stdout;
  assert.match(out, new RegExp(`Back in stock: ${stale.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at Best Buy`));
  assert.doesNotMatch(out, /Reported back in stock/);
  // A report from yesterday still is.
  const fresh = repoWithRestock(undefined, report(ago(1)));
  assert.match(social(fresh.dir, fresh.start).stdout, /Reported back in stock: /);
});

// ---------- what is really sent to X and Bluesky ----------
// The script is run with fetch() replaced (test/helpers/fake-fetch.mjs), so every request it would make is written to a
// file instead of leaving the machine. That shows exactly what X would be charged for.
const FAKE_KEYS = { BLUESKY_APP_PASSWORD: "bsky-password", X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_TOKEN_SECRET: "ts" };
function sendFor(dir, start, args = [], env = {}) {
  const log = join(dir, "fetch.log");
  writeFileSync(log, "");
  const r = social(dir, start, { ...FAKE_KEYS, FAKE_FETCH_LOG: log, NODE_OPTIONS: `--import=${join(ROOT, "test/helpers/fake-fetch.mjs")}`, ...env }, ...args);
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  return {
    ...r, calls,
    x: calls.filter(c => c.url === "https://api.x.com/2/tweets").map(c => JSON.parse(c.body).text),
    bluesky: calls.filter(c => c.url.endsWith("com.atproto.repo.createRecord")).map(c => JSON.parse(c.body).record),
    other: calls.filter(c => !/api\.x\.com|bsky\.social/.test(c.url))
  };
}
const NO_LINK = /https?:|www\.|\beditiontracker\.com|\b[a-z0-9-]+\.(com|org|net|io|gg|tv|co)\b/i;
const newRelease = d => d.items.push({ ...JSON.parse(JSON.stringify(OTHER)), id: "brand-new-test", name: "Brand New Test Edition", category: "nintendo", platform: "Nintendo Switch 2", status: "announced", price: "$59.99", releaseDate: null, releaseWindow: "2099", timeline: [] });

test("a post to X has no link in it, and the same post on Bluesky keeps its link", () => {
  const { dir, start } = repoWithRestock(undefined, newRelease);
  const r = sendFor(dir, start);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // One post to X: the new release. The restock isn't posted to X unless the config says so.
  assert.deepEqual(r.x, ["New: Brand New Test Edition\nNintendo Switch 2 · $59.99 · Expected 2099\nDetails: editiontracker dot com\n#Nintendo #Switch2"]);
  assert.doesNotMatch(r.x[0], NO_LINK);
  // Bluesky gets both, with the link in the text, as a clickable part of it, and as the preview card.
  assert.equal(r.bluesky.length, 2);
  const card = r.bluesky.find(x => x.text.startsWith("New: Brand New Test Edition"));
  assert.ok(card.text.endsWith("https://editiontracker.com/brand-new-test/"));
  assert.equal(card.facets[0].features[0].uri, "https://editiontracker.com/brand-new-test/");
  assert.equal(card.embed.external.uri, "https://editiontracker.com/brand-new-test/");
  assert.deepEqual(r.other, []); // nothing went anywhere else
  // The log shows what X gets, so it can be looked at before it's real.
  assert.match(r.stdout, /On X, without the link:\n    New: Brand New Test Edition\n    Nintendo Switch 2 · \$59\.99 · Expected 2099\n    Details: editiontracker dot com\n    #Nintendo #Switch2/);
});

test("restocks reach X only when the config says so, and still without a link", () => {
  const off = repoWithRestock();
  assert.deepEqual(sendFor(off.dir, off.start).x, []);
  assert.doesNotMatch(social(off.dir, off.start).stdout, /On X/); // and the log doesn't pretend they will
  const on = repoWithRestock(undefined, undefined, c => { c.social.restockToX = true; });
  const r = sendFor(on.dir, on.start);
  assert.equal(r.x.length, 1);
  assert.equal(r.x[0].split("\n")[0], `Back in stock: ${on.name} at Best Buy`);
  assert.match(r.x[0], /\nStore links: editiontracker dot com\n#/);
  assert.doesNotMatch(r.x[0], NO_LINK);
  assert.ok(r.bluesky[0].text.endsWith(`https://editiontracker.com/${PICK.id}/`));
});

test("a message typed by hand goes to X with its links taken out", () => {
  const { dir, start } = repoWithRestock();
  const r = sendFor(dir, start, ["--text", "Big news. Read https://www.ign.com/articles/x and https://editiontracker.com/calendar/ today"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.x, ["Big news. Read and editiontracker dot com today"]);
  assert.equal(r.bluesky.length, 1);
  assert.match(r.bluesky[0].text, /https:\/\/www\.ign\.com\/articles\/x and https:\/\/editiontracker\.com\/calendar\//);
  // No link at all in the message: Bluesky gets the homepage added, X gets the site's name.
  const plain = sendFor(dir, start, ["--text", "Restocks are on the way"]);
  assert.deepEqual(plain.x, ["Restocks are on the way\neditiontracker dot com"]);
  assert.ok(plain.bluesky[0].text.endsWith("https://editiontracker.com"));
});

test("the scheduled posts go to X without links too", () => {
  const edit = d => { Object.assign(d.items[0], { status: "preorder", releaseDate: "2099-06-04", releaseWindow: null }); };
  const { dir, start } = repoWithRestock(undefined, edit);
  const r = sendFor(dir, start, ["--scheduled", "--date", "2099-06-04"]); // a Thursday, so the week ahead is posted too
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.x.length, 2); // the week ahead, and Out today
  assert.ok(r.x.some(t => t.startsWith("Coming out this week:") && t.includes("\nFull calendar: editiontracker dot com")));
  assert.ok(r.x.some(t => t.startsWith("Out today: ") && t.includes("\nDetails: editiontracker dot com")));
  for (const t of r.x) assert.doesNotMatch(t, NO_LINK);
  assert.ok(r.bluesky.every(x => /https:\/\/editiontracker\.com\//.test(x.text)));
});
