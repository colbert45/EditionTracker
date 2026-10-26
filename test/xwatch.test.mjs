import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchQuery, searchUrl, unwrapLink, postsToHeadlines, oauthHeader } from "../lib/xwatch.js";
import { plainData } from "./helpers/stock.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CFG = { account: "Wario64", keywords: ["zelda", "ocarina", "hyrule"], monthlyCap: 600, maxResults: 25 };

test("OAuth signing matches X's own worked example", () => {
  const h = oauthHeader("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
    { key: "xvz1evFS4wEEPTGEFPHBog", token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" },
    { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958", body: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" } });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test("the search asks only for the account's posts that name a topic and say it's in stock", () => {
  const q = searchQuery(CFG);
  assert.match(q, /^from:Wario64 \(zelda OR ocarina OR hyrule\) \("in stock" OR restock .* OR preorder .*\) -is:retweet$/);
  assert.throws(() => searchQuery({ ...CFG, account: "not a name" }));
  assert.throws(() => searchQuery({ ...CFG, keywords: [] }));
  assert.match(searchQuery({ ...CFG, keywords: ["tears of the kingdom"] }), /\("tears of the kingdom"\)/);
  const first = new URL(searchUrl(CFG, { now: new Date("2026-10-26T15:00:00Z") }));
  assert.equal(first.searchParams.get("start_time"), "2026-10-26T12:00:00Z"); // only the last 3 hours on the first run
  assert.equal(first.searchParams.get("since_id"), null);
  const next = new URL(searchUrl(CFG, { sinceId: "1850000000000000001" }));
  assert.equal(next.searchParams.get("since_id"), "1850000000000000001");
  assert.equal(next.searchParams.get("start_time"), null);
  assert.equal(new URL(searchUrl({ ...CFG, maxResults: 500 })).searchParams.get("max_results"), "100");
});

test("affiliate redirects are unwrapped to the store's own page", () => {
  assert.equal(unwrapLink("https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fip%2F123%3Fathbdg%3DL1600&veh=aff"), "https://www.walmart.com/ip/123?athbdg=L1600");
  assert.equal(unwrapLink("https://bestbuy.7tiv.net/c/1/2/3?u=https%3A%2F%2Fwww.bestbuy.com%2Fsite%2F-%2F6691841.p%3FskuId%3D6691841"), "https://www.bestbuy.com/site/-/6691841.p?skuId=6691841");
  assert.equal(unwrapLink("https://www.target.com/p/-/A-1"), "https://www.target.com/p/-/A-1");
  assert.equal(unwrapLink("https://x.com/i?u=javascript:alert(1)"), "https://x.com/i?u=javascript:alert(1)"); // only a web address counts
});

test("X's answer becomes headlines: the post's words, the real links, and the post as the source", () => {
  const hs = postsToHeadlines({ data: [
    { id: "1850000000000000002", created_at: "2026-10-26T14:50:00.000Z", text: "Switch 2 Zelda 40th Edition in stock at Walmart https://t.co/abc",
      entities: { urls: [{ url: "https://t.co/abc", expanded_url: "https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fip%2F123" }] } },
    { id: "nope", text: "bad id" }] }, "@Wario64");
  assert.deepEqual(hs, [{ title: "Switch 2 Zelda 40th Edition in stock at Walmart", link: "https://x.com/Wario64/status/1850000000000000002",
    sourceName: "Wario64 on X", summary: "https://www.walmart.com/ip/123", published: "2026-10-26T14:50:00.000Z" }]);
  assert.deepEqual(postsToHeadlines({}, "Wario64"), []);
});

// ---------- the news check's quick runs, with X, Claude and Best Buy replaced ----------
const NOW = "2026-10-26T15:00:00Z"; // 11am in New York: the morning half, already read in the state below
function setup({ state = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "et-xwatch-"));
  for (const d of ["config", "data", ".news-state"]) mkdirSync(join(dir, d));
  const data = plainData();
  const zelda = data.items.find(i => i.id === "switch-2-zelda-40th");
  zelda.status = "soldout";
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(data, null, 2) + "\n");
  writeFileSync(join(dir, "config/feeds.json"), readFileSync(join(ROOT, "config/feeds.json")));
  writeFileSync(join(dir, "config/x-watch.json"), JSON.stringify(CFG));
  writeFileSync(join(dir, "config/stock-check.json"), JSON.stringify({ bestbuy: [{ item: "switch-2-zelda-40th", sku: "6691841" }] }));
  writeFileSync(join(dir, ".news-state/state.json"), JSON.stringify({ seen: {}, http: {}, lastCheck: "2026-10-26", lastHalfDay: "2026-10-26 AM", ...state }));
  return { dir, fetchLog: join(dir, "fetch.log"), out: join(dir, "out") };
}
const POST = { data: [{ id: "1850000000000000002", created_at: "2026-10-26T14:50:00.000Z", text: "Switch 2 Zelda 40th Anniversary Edition in stock at Walmart https://t.co/abc",
  entities: { urls: [{ url: "https://t.co/abc", expanded_url: "https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fip%2FZelda-40th%2F123456%3Fathbdg%3DL1600" }] } }],
  meta: { newest_id: "1850000000000000002", result_count: 1 } };
const RESTOCK = { proposals: [{ kind: "update", itemId: "switch-2-zelda-40th", confidence: "high", headlineIds: [1], timelineEntry: null, newItem: null,
  summary: "Wario64 on X says it's in stock at Walmart.", changes: { status: null, price: null, releaseDate: null, releaseWindow: null, preordersOpened: null,
    preordersStart: null, appendNote: null, stores: [], restock: { store: "walmart", date: "2026-10-26", listingUrl: "https://www.walmart.com/ip/Zelda-40th/123456?athbdg=L1600" } } }] };
function run(s, { x = { meta: { result_count: 0 } }, claude = { proposals: [] }, bestbuy = { products: [] }, env = {}, now = NOW } = {}) {
  writeFileSync(join(s.dir, "x.json"), JSON.stringify(x)); writeFileSync(join(s.dir, "claude.json"), JSON.stringify(claude));
  writeFileSync(join(s.dir, "bb.json"), JSON.stringify(bestbuy)); writeFileSync(s.fetchLog, ""); writeFileSync(s.out, "");
  const r = spawnSync("node", ["scripts/news-check.mjs"], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, NEWS_ROOT: s.dir, NEWS_NOW: now,
    ONCE_PER_HALF_DAY: "true", GITHUB_OUTPUT: s.out, GITHUB_REPOSITORY_OWNER: "someone-42", ANTHROPIC_API_KEY: "test-key",
    X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_TOKEN_SECRET: "ts",
    FAKE_X: join(s.dir, "x.json"), FAKE_CLAUDE: join(s.dir, "claude.json"), FAKE_BESTBUY: join(s.dir, "bb.json"), FAKE_FETCH_LOG: s.fetchLog,
    NODE_OPTIONS: `--import=${join(ROOT, "test/helpers/fake-net.mjs")}`, ...env } });
  const read = f => existsSync(join(s.dir, f)) ? readFileSync(join(s.dir, f), "utf8") : null;
  return { ...r, output: readFileSync(s.out, "utf8"), calls: readFileSync(s.fetchLog, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)),
    data: JSON.parse(read("data/releases.json")), body: read(".news-state/pr-body.md"), state: JSON.parse(read(".news-state/state.json")) };
}
const to = (r, host) => r.calls.filter(c => c.url.startsWith(`https://${host}/`));

test("a Wario64 in-stock post becomes a proposed restock in the pull request, with the store's own page and a mention", () => {
  const s = setup();
  const r = run(s, { x: POST, claude: RESTOCK });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const [xcall] = to(r, "api.x.com");
  const q = new URL(xcall.url);
  assert.match(q.searchParams.get("query"), /^from:Wario64 \(zelda OR ocarina OR hyrule\)/);
  assert.equal(q.searchParams.get("start_time"), "2026-10-26T12:00:00Z");
  assert.match(xcall.auth, /^OAuth oauth_consumer_key="k"/);
  assert.equal(to(r, "api.anthropic.com").length, 1);
  assert.equal(r.calls.filter(c => !/api\.(x|anthropic)\.com/.test(c.url)).length, 0); // no news feeds, no Best Buy without its key
  assert.match(r.output, /changed=true/);
  assert.doesNotMatch(r.output, /checked=true/);
  const it = r.data.items.find(i => i.id === "switch-2-zelda-40th");
  assert.equal(it.status, "restock");
  assert.deepEqual(it.restocks.at(-1), { date: "2026-10-26", store: "walmart", url: "https://www.walmart.com/ip/Zelda-40th/123456",
    source: "https://x.com/Wario64/status/1850000000000000002", reported: true });
  assert.match(r.body, /^@someone-42 Something is reported back in stock \(Wario64 on X\)\./);
  assert.match(r.body, /### Restock check, 2026-10-26 15:00 UTC\n\nRead 1 new headline\(s\)\. Proposed 1 change\(s\)\./);
  assert.equal(r.state.xWatch.sinceId, "1850000000000000002");
  assert.equal(r.state.xWatch.reads, 1);
  assert.equal(r.state.xWatch.month, "2026-10");
  assert.ok(r.state.seen["https://x.com/Wario64/status/1850000000000000002"]);
  assert.equal(r.state.lastHalfDay, "2026-10-26 AM");
  // Next run: only newer posts are asked for, and with none, Claude isn't called and nothing changes.
  const again = run(s, { now: "2026-10-26T15:15:00Z" });
  assert.equal(new URL(to(again, "api.x.com")[0].url).searchParams.get("since_id"), "1850000000000000002");
  assert.equal(to(again, "api.anthropic.com").length, 0);
  assert.match(again.output, /changed=false/);
});

test("the X watch stops at the monthly cap, starts again next month, and does nothing without the X keys", () => {
  const capped = setup({ state: { xWatch: { month: "2026-10", reads: 600, sinceId: "5" } } });
  const r = run(capped, { x: POST, claude: RESTOCK });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(to(r, "api.x.com").length, 0);
  assert.match(r.stdout, /X watch: paused, 600 posts read this month \(cap 600\)/);
  const nextMonth = run(capped, { now: "2026-11-02T15:00:00Z", env: {} });
  // A new half-day reads the news too; here only the X request matters, and it happens again in a new month.
  assert.equal(to(nextMonth, "api.x.com").length, 1);
  const nokeys = setup();
  const n = run(nokeys, { x: POST, env: { X_API_KEY: "" } });
  assert.equal(to(n, "api.x.com").length, 0);
  assert.match(n.stdout, /X watch: skipped \(no X_\* secrets\)/);
});

test("an error from X is only a warning, and the run still checks the rest", () => {
  const s = setup();
  writeFileSync(join(s.dir, "x.json"), "not json");
  const r = run(s, { x: "not json" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.output, /changed=false/);
});

test("Best Buy is asked at most once an hour, even with runs every 15 minutes", () => {
  const s = setup();
  const bb = { products: [{ sku: 6691841, name: "Zelda", onlineAvailability: false, orderable: "SoldOut" }] };
  const env = { BESTBUY_API_KEY: "bb-key" };
  const first = run(s, { bestbuy: bb, env });
  assert.equal(to(first, "api.bestbuy.com").length, 1);
  const soon = run(s, { bestbuy: bb, env, now: "2026-10-26T15:15:00Z" });
  assert.equal(to(soon, "api.bestbuy.com").length, 0);
  assert.match(soon.stdout, /Best Buy: checked within the hour, skipped/);
  const later = run(s, { bestbuy: bb, env, now: "2026-10-26T16:01:00Z" });
  assert.equal(to(later, "api.bestbuy.com").length, 1);
});
