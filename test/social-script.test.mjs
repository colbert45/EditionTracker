import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { applyRestock } from "../lib/restock.js";
import { forX } from "../lib/xpost.js";

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

test("a report that is too old to post doesn't count towards the bulk-edit limit", () => {
  const ago = n => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  // 7 price changes and the restock are 8 releases. A six-day-old report on one more is not news, so it is not a ninth.
  const edit = d => {
    const others = d.items.filter(i => i.id !== PICK.id);
    for (const it of others.slice(0, 7)) it.price = "$1.23";
    const old = others.at(-1);
    old.status = "restock";
    old.restocks = [{ date: ago(6), store: "bestbuy", url: "https://www.bestbuy.com/site/searchpage.jsp?st=x", source: "https://news.example/report", reported: true }];
  };
  const r = repoWithRestock(undefined, edit);
  const out = social(r.dir, r.start).stdout;
  assert.doesNotMatch(out, /bulk edit/);
  assert.match(out, /Back in stock: /);
  assert.doesNotMatch(out, /Reported back in stock/);
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
  const { dir, start } = repoWithRestock(undefined, newRelease, c => { c.social.restockToX = false; });
  const r = sendFor(dir, start);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // One post to X: the new release. With restocks switched off for X, the restock isn't posted there.
  assert.deepEqual(r.x, ["New: Brand New Test Edition\nNintendo Switch 2 · $59.99 · Expected 2099\nDetails: editiontracker dot com\n#Nintendo #Switch2 #SpecialEdition #GameCollecting"]);
  assert.doesNotMatch(r.x[0], NO_LINK);
  // Bluesky gets both, with the link in the text, as a clickable part of it, and as the preview card.
  assert.equal(r.bluesky.length, 2);
  const card = r.bluesky.find(x => x.text.startsWith("New: Brand New Test Edition"));
  assert.ok(card.text.endsWith("https://editiontracker.com/brand-new-test/"));
  assert.equal(card.facets[0].features[0].uri, "https://editiontracker.com/brand-new-test/");
  assert.equal(card.embed.external.uri, "https://editiontracker.com/brand-new-test/");
  assert.deepEqual(r.other, []); // nothing went anywhere else
  // The log shows what X gets, so it can be looked at before it's real.
  assert.match(r.stdout, /On X, without the link:\n    New: Brand New Test Edition\n    Nintendo Switch 2 · \$59\.99 · Expected 2099\n    Details: editiontracker dot com\n    #Nintendo #Switch2 #SpecialEdition #GameCollecting/);
});

test("restocks reach X when the config says so, still without a link, and not when it says no", () => {
  const off = repoWithRestock(undefined, undefined, c => { c.social.restockToX = false; });
  assert.deepEqual(sendFor(off.dir, off.start).x, []);
  assert.doesNotMatch(social(off.dir, off.start).stdout, /On X/); // and the log doesn't pretend they will
  const on = repoWithRestock(undefined, undefined, c => { c.social.restockToX = true; });
  const r = sendFor(on.dir, on.start);
  assert.equal(r.x.length, 1);
  assert.equal(r.x[0].split("\n")[0], `Back in stock: ${forX(on.name, "https://editiontracker.com")} at Best Buy`);
  assert.match(r.x[0], /\nStore links: editiontracker dot com\n#Restock\b/);
  assert.doesNotMatch(r.x[0], NO_LINK);
  assert.ok(r.bluesky[0].text.endsWith(`https://editiontracker.com/${PICK.id}/`));
  // The log shows it, too.
  assert.match(r.stdout, /On X, without the link:\n    Back in stock: /);
});

test("a refused post to X shows as a warning on the Actions run page, and Bluesky still gets the restock", () => {
  const { dir, start } = repoWithRestock(undefined, undefined, c => { c.social.restockToX = true; });
  const r = sendFor(dir, start, [], { FAKE_FETCH_FAIL: "api.x.com", GITHUB_ACTIONS: "true" });
  assert.equal(r.status, 1); // the step fails (the workflow lets it), so nobody thinks it worked
  assert.match(r.stdout, /X failed: POST https:\/\/api\.x\.com\/2\/tweets: 403/);
  assert.match(r.stdout, /::warning title=The post to X failed::POST https:\/\/api\.x\.com\/2\/tweets: 403/);
  assert.equal(r.bluesky.length, 1);
  // Outside Actions it's only a line in the log.
  const plain = sendFor(dir, start, [], { FAKE_FETCH_FAIL: "api.x.com", GITHUB_ACTIONS: "" });
  assert.match(plain.stdout, /X failed: /);
  assert.doesNotMatch(plain.stdout, /::warning/);
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

test("a message that is too long for X once its links are out is refused, and Bluesky alone can still take it", () => {
  const { dir, start } = repoWithRestock();
  // 200 characters, but X counts each arrow as two: 400.
  const arrows = "\u2192".repeat(200);
  const both = sendFor(dir, start, ["--text", arrows]);
  assert.equal(both.status, 1);
  assert.match(both.stdout, /Too long for X once its links are taken out: 400 \(limit 280\)\./);
  assert.deepEqual(both.calls, []); // nothing was posted anywhere, not even to Bluesky
  const bsky = sendFor(dir, start, ["--text", arrows, "--only", "bluesky"]);
  assert.equal(bsky.status, 0, bsky.stderr + bsky.stdout);
  assert.deepEqual(bsky.x, []);
  assert.equal(bsky.bluesky.length, 1);
  // 140 arrows is exactly 280 on X: with the site's name added it no longer fits, so it goes without it, and goes.
  const exact = sendFor(dir, start, ["--text", "\u2192".repeat(140)]);
  assert.equal(exact.status, 0, exact.stderr + exact.stdout);
  assert.deepEqual(exact.x, ["\u2192".repeat(140)]);
});

test("what is too long is worked out for each place a message goes, after the links are out for X", () => {
  const { dir, start } = repoWithRestock();
  const tried = (text, ...flags) => sendFor(dir, start, ["--text", text, ...flags]);
  // A long link doesn't count against X (it's taken out), but Bluesky keeps it: 330 characters is over its 300.
  const longLink = `Read ${"https://example.com/"}${"a".repeat(300)} today`;
  const both = tried(longLink);
  assert.equal(both.status, 1);
  assert.match(both.stdout, /Too long for Bluesky: 3\d\d \(limit 300\)\./);
  assert.deepEqual(both.calls, []);
  const onlyX = tried(longLink, "--only", "x");
  assert.equal(onlyX.status, 0, onlyX.stderr + onlyX.stdout);
  assert.deepEqual(onlyX.x, ["Read today\neditiontracker dot com"]);
  assert.equal(tried(longLink, "--only", "bluesky").status, 1);
  // The other way round: 288 on X once the site is named in words, 292 on Bluesky. Only Bluesky takes it.
  const plain = `${"a".repeat(265)} https://editiontracker.com`;
  const bothPlain = tried(plain);
  assert.equal(bothPlain.status, 1);
  assert.match(bothPlain.stdout, /Too long for X once its links are taken out: 288 \(limit 280\)\./);
  const bsky = tried(plain, "--only", "bluesky");
  assert.equal(bsky.status, 0, bsky.stderr + bsky.stdout);
  assert.equal(bsky.bluesky.length, 1);
  // Nothing comes near a thousand characters, so that is refused before anything else is worked out.
  const huge = tried("a ".repeat(501));
  assert.equal(huge.status, 1);
  assert.match(huge.stdout, /^Too long: 1001 characters\./);
  // A message that names no link gets the homepage added, which counts: 273 fits Bluesky, 274 doesn't.
  assert.equal(tried("b".repeat(273), "--only", "bluesky").status, 0);
  const over = tried("b".repeat(274), "--only", "bluesky");
  assert.equal(over.status, 1);
  assert.match(over.stdout, /Too long for Bluesky: 301 \(limit 300\)\./);
  // Bluesky counts what a reader sees as one each: 150 emoji are 150, not the 300 they are in memory (and 150 more with the homepage).
  assert.equal(tried("\u{1F600}".repeat(150), "--only", "bluesky").status, 0);
});

test("the log shows what the request to X carries, or why X would refuse it", () => {
  const { dir, start } = repoWithRestock(undefined, newRelease, c => { c.social.restockToX = true; });
  const r = social(dir, start);
  assert.match(r.stdout, /On X, without the link:\n    New: Brand New Test Edition\n/);
  assert.doesNotMatch(r.stdout, /On X, refused/);
  // A post whose X text can't be sent says so in the log instead of showing text that never goes out.
  const src = readFileSync(join(ROOT, "scripts/social.mjs"), "utf8");
  assert.match(src, /try \{ body = xBody\(p, config\.siteUrl\); \} catch \(e\) \{ return `  On X, refused: \$\{e\.message\}`; \}/);
  // And the request itself is made from the same function, nothing else.
  assert.match(src, /async function xPost\(p\) \{[^}]*const text = xBody\(p, config\.siteUrl\);[\s\S]*?body: JSON\.stringify\(\{ text \}\)/);
});

test("a message of your own goes to Discord only when asked, so the webhook can be tested", () => {
  const { dir, start } = repoWithRestock();
  const hook = "https://discord.com/api/webhooks/123456789/token-abc";
  const discord = r => r.calls.filter(c => c.url === hook);
  const asked = sendFor(dir, start, ["--text", "Testing the restock channel", "--only", "discord"], { DISCORD_WEBHOOK_URL: hook });
  assert.equal(asked.status, 0, asked.stderr + asked.stdout);
  assert.equal(discord(asked).length, 1);
  assert.match(JSON.parse(discord(asked)[0].body).content, /Testing the restock channel/);
  assert.deepEqual(asked.x, []);
  assert.deepEqual(asked.bluesky, []);
  assert.ok(!asked.stdout.includes("token-abc"));
  // The usual way (both) never sends it there.
  const usual = sendFor(dir, start, ["--text", "Testing"], { DISCORD_WEBHOOK_URL: hook });
  assert.equal(discord(usual).length, 0);
  assert.equal(usual.x.length, 1);
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
