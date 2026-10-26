import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBestBuy, proposeRestocks, planStock, bestBuyListing, isSku } from "../lib/stockcheck.js";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { applyRestock } from "../lib/restock.js";

const ROOT = new URL("..", import.meta.url).pathname;
const answer = (...products) => ({ products });
const prod = (sku, onlineAvailability, extra = {}) => ({ sku, name: `Product ${sku}`, onlineAvailability, orderable: onlineAvailability ? "Available" : "SoldOut", ...extra });

test("Best Buy's answer is read as available or not, and a sold out or coming soon label wins", () => {
  const seen = parseBestBuy(answer(prod(6691841, true), prod(6691849, false), prod(6691852, true, { orderable: "SoldOut" }), prod(6000001, true, { orderable: "ComingSoon" }), { sku: "bad" }, null));
  assert.deepEqual([...seen.entries()].map(([k, v]) => [k, v.available]), [["6691841", true], ["6691849", false], ["6691852", false], ["6000001", false]]);
  assert.equal(seen.get("6691841").name, "Product 6691841");
  assert.equal(parseBestBuy(undefined).size, 0);
  assert.equal(parseBestBuy({ products: "nope" }).size, 0);
  // Only "true" counts: a missing or odd value is not stock.
  assert.equal(parseBestBuy(answer({ sku: 6691841, onlineAvailability: "true" })).get("6691841").available, false);
});

test("the first look sets a starting point, and only not-in-stock to in-stock is a restock", () => {
  const entries = [{ item: "a", sku: "6691841" }, { item: "b", sku: "6691849" }];
  const look = (states, before) => planStock(entries, parseBestBuy(answer(...Object.entries(states).map(([s, v]) => prod(s, v)))), before);
  const first = look({ 6691841: true, 6691849: false }, {});
  assert.deepEqual(first.restocks, []);
  assert.deepEqual(first.after, { 6691841: true, 6691849: false });
  const back = look({ 6691841: true, 6691849: true }, first.after);
  assert.deepEqual(back.restocks.map(r => r.item), ["b"]);
  assert.equal(back.restocks[0].name, "Product 6691849");
  assert.deepEqual(look({ 6691841: true, 6691849: true }, back.after).restocks, []); // still in stock: said once
  const gone = look({ 6691841: false, 6691849: true }, back.after);
  assert.deepEqual(gone.restocks, []);
  assert.equal(gone.after[6691841], false);
  assert.deepEqual(look({ 6691841: true, 6691849: true }, gone.after).restocks.map(r => r.item), ["a"]); // and again after it sold out
  // A product Best Buy leaves out of its answer is left as it was.
  const missing = planStock(entries, parseBestBuy(answer(prod(6691841, true))), { 6691841: true, 6691849: false });
  assert.deepEqual(missing.after, { 6691841: true, 6691849: false });
  assert.match(missing.notes.join(" "), /didn't answer for 6691849/);
});

test("the listing link is one the restock log accepts as Best Buy's", () => {
  const d = plainData();
  const { item } = pickItems(d);
  const r = applyRestock(d, { item: item.id, retailer: "Best Buy", link: bestBuyListing("6691841"), today: "2026-10-15" });
  assert.equal(r.entry.url, "https://www.bestbuy.com/site/-/6691841.p?skuId=6691841");
  assert.ok(isSku("6691841") && !isSku("abc") && !isSku("12") && !isSku(undefined));
});

// ---------- the script, with Best Buy and `gh` replaced ----------
const { item: PICK } = pickItems(plainData());
function setup(statusOf) {
  const dir = mkdtempSync(join(tmpdir(), "et-stock-"));
  mkdirSync(join(dir, "config")); mkdirSync(join(dir, "data"));
  const data = plainData();
  if (statusOf) data.items.find(i => i.id === PICK.id).status = statusOf;
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(data));
  writeFileSync(join(dir, "config/stock-check.json"), JSON.stringify({ bestbuy: [{ item: PICK.id, sku: "6691841" }, { item: "no-such-release", sku: "6691849" }, { item: PICK.id, sku: "oops" }] }));
  const ghLog = join(dir, "gh.log"), gh = join(dir, "gh");
  writeFileSync(gh, `#!/bin/sh\necho "$@" >> "${ghLog}"\n[ -n "$FAKE_GH_FAIL" ] && exit 1\nexit 0\n`); chmodSync(gh, 0o755);
  return { dir, ghLog, state: join(dir, "state.json"), fetchLog: join(dir, "fetch.log") };
}
function run(s, products, { args = [], env = {} } = {}) {
  writeFileSync(join(s.dir, "bestbuy.json"), JSON.stringify(answer(...products)));
  writeFileSync(s.fetchLog, "");
  writeFileSync(s.ghLog, ""); // each run reports only its own calls
  const r = spawnSync("node", ["scripts/stock-check.mjs", ...args], { cwd: ROOT, encoding: "utf8",
    env: { ...process.env, STOCK_ROOT: s.dir, STOCK_STATE_FILE: s.state, STOCK_GH: join(s.dir, "gh"), BESTBUY_API_KEY: "secret-key-123",
      FAKE_BESTBUY: join(s.dir, "bestbuy.json"), FAKE_FETCH_LOG: s.fetchLog, NODE_OPTIONS: `--import=${join(ROOT, "test/helpers/fake-bestbuy.mjs")}`, ...env } });
  const calls = existsSync(s.ghLog) ? readFileSync(s.ghLog, "utf8").split("\n").filter(Boolean) : [];
  return { ...r, calls, state: existsSync(s.state) ? JSON.parse(readFileSync(s.state, "utf8")) : null };
}

test("the script sets a starting point first, then starts the restock action when a product comes back, once", () => {
  const s = setup();
  const first = run(s, [prod(6691841, false)]);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(first.calls, []);
  assert.deepEqual(first.state, { 6691841: false });
  const same = run(s, [prod(6691841, false)]);
  assert.deepEqual(same.calls, []);
  const back = run(s, [prod(6691841, true)]);
  assert.equal(back.status, 0, back.stderr);
  assert.deepEqual(back.calls, [`workflow run post-restock.yml --ref main -f item=${PICK.id} -f link=https://www.bestbuy.com/site/-/6691841.p?skuId=6691841 -f retailer=Best Buy`]);
  assert.deepEqual(back.state, { 6691841: true });
  const again = run(s, [prod(6691841, true)]);
  assert.deepEqual(again.calls, []); // already told
  // Only the release with a real SKU and a real id was asked about.
  const asked = JSON.parse(`[${readFileSync(s.fetchLog, "utf8").trim().split("\n").join(",")}]`);
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, /^https:\/\/api\.bestbuy\.com\/v1\/products\(sku in\(6691841\)\)\?apiKey=/);
  assert.match(back.stdout, /no valid Best Buy number|not a release on the site/);
});

test("a restock that couldn't be started is tried again at the next check", () => {
  const s = setup();
  run(s, [prod(6691841, false)]);
  const failed = run(s, [prod(6691841, true)], { env: { FAKE_GH_FAIL: "1" } });
  assert.equal(failed.status, 0);
  assert.match(failed.stdout, /Couldn't start the restock action/);
  assert.deepEqual(failed.state, { 6691841: false });
  const retry = run(s, [prod(6691841, true)]);
  assert.equal(retry.calls.length, 1);
  assert.deepEqual(retry.state, { 6691841: true });
});

test("a release the site doesn't treat as on sale can't have a restock logged, so none is started", () => {
  const s = setup("rumor");
  run(s, [prod(6691841, false)]);
  const r = run(s, [prod(6691841, true)]);
  assert.deepEqual(r.calls, []);
  assert.match(r.stdout, /is "rumor" on the site/);
});

test("a bad answer from Best Buy is a warning, never a failed run, and the key is never printed", () => {
  const s = setup();
  run(s, [prod(6691841, false)]);
  const r = run(s, [], { env: { FAKE_BESTBUY_STATUS: "503" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::warning title=Best Buy check skipped::Best Buy answered 503/);
  assert.deepEqual(r.state, { 6691841: false }); // unchanged
  assert.ok(!r.stdout.includes("secret-key-123") && !r.stderr.includes("secret-key-123"));
  // Even an error that repeats the whole address doesn't show the key.
  const thrown = run(s, [], { env: { FAKE_BESTBUY_THROW: "1" } });
  assert.equal(thrown.status, 0);
  assert.match(thrown.stdout, /Best Buy check skipped::network trouble reaching https:\/\/api\.bestbuy\.com\/v1\/products.*apiKey=\*\*\*/);
  assert.ok(!thrown.stdout.includes("secret-key-123"));
  // No key: nothing is checked at all.
  const none = run(s, [prod(6691841, true)], { env: { BESTBUY_API_KEY: "" } });
  assert.equal(none.status, 0);
  assert.match(none.stdout, /BESTBUY_API_KEY isn't set/);
  assert.equal(readFileSync(s.fetchLog, "utf8"), "");
});

test("--show says what Best Buy answers and changes nothing", () => {
  const s = setup();
  const r = run(s, [prod(6691841, true, { orderable: "Available" })], { args: ["--show"] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`${PICK.id} \\(6691841\\): available \\(Best Buy says orderable: Available;`));
  assert.deepEqual(r.calls, []);
  assert.equal(r.state, null);
});

test("the stock check workflow is wired safely", () => {
  const yml = readFileSync(`${ROOT}.github/workflows/stock-check.yml`, "utf8");
  // Instant mode is off for now: the twice-daily news check looks at Best Buy instead.
  assert.doesNotMatch(yml.replace(/^#.*$/gm, ""), /schedule:/);
  assert.match(yml, /permissions:\n  contents: write[^\n]*\n  actions: write/);
  assert.match(yml, /concurrency:\n  group: stock-check\n  cancel-in-progress: false/);
  assert.match(yml, /BESTBUY_API_KEY: \$\{\{ secrets\.BESTBUY_API_KEY \}\}/);
  // The form value only reaches the shell as an environment variable.
  const uses = yml.split("\n").filter(l => /\$\{\{\s*inputs\./.test(l));
  assert.deepEqual(uses.map(l => l.trim()), ["SHOW: ${{ inputs.show }}"]);
  assert.match(yml, /git push -f origin "\$COMMIT:refs\/heads\/stock-state"/);
  // With no key every step is skipped, so the schedule costs nothing until it's added.
  assert.match(yml, /HAS_KEY: \$\{\{ secrets\.BESTBUY_API_KEY != '' \}\}/);
  const steps = yml.split(/\n      - /).slice(1);
  assert.equal(steps.length, 5);
  for (const st of steps) assert.match(st, /if: env\.HAS_KEY == 'true'/);
  // It never pushes to main.
  assert.doesNotMatch(yml, /push[^\n]*\bmain\b/);
});

test("the news check proposes a restock for a product Best Buy sells while the site says sold out", async () => {
  const { applyAll, prMarkdown } = await import("../lib/proposals.js");
  const d = plainData();
  const [a, b, c] = d.items.filter(i => ["out", "soldout"].includes(i.status)).slice(0, 3);
  const pre = d.items.find(i => i.status === "preorder");
  a.status = "soldout"; b.status = "soldout"; c.status = "out"; pre.status = "preorder";
  const entries = [{ item: a.id, sku: "1000001" }, { item: b.id, sku: "1000002" }, { item: c.id, sku: "1000003" }, { item: pre.id, sku: "1000004" }, { item: "nope", sku: "1000005" }];
  const seen = parseBestBuy({ products: [
    { sku: 1000001, name: "A", onlineAvailability: true, orderable: "Available" },
    { sku: 1000002, name: "B", onlineAvailability: false, orderable: "SoldOut" },
    { sku: 1000003, name: "C", onlineAvailability: true, orderable: "Available" },
    { sku: 1000004, name: "P", onlineAvailability: true, orderable: "Available" },
    { sku: 1000005, name: "N", onlineAvailability: true, orderable: "Available" }] });
  const { proposals, headlines } = proposeRestocks(d.items, entries, seen, "2026-10-15");
  assert.deepEqual(proposals.map(p => p.itemId), [a.id, c.id]); // not the unavailable one, the preorder, or an unknown release
  const { data: next, applied, skipped } = applyAll(d, proposals, new Map(headlines.map(h => [h.id, h])), "2026-10-15");
  assert.equal(skipped.length, 0);
  assert.equal(applied.length, 2);
  const it = next.items.find(i => i.id === a.id);
  assert.equal(it.status, "restock");
  assert.deepEqual(it.restocks.at(-1), { date: "2026-10-15", store: "bestbuy", url: bestBuyListing("1000001"), source: bestBuyListing("1000001"), reported: true });
  const md = prMarkdown({ applied, skipped, reviewed: 0, when: "now", today: "2026-10-15" });
  assert.match(md, /Merge by the end of 2026-10-17/);
  assert.match(md, /Best Buy product page/);
  // Both are "Back in stock" on the site now: nothing more to propose.
  assert.equal(proposeRestocks(next.items, entries, seen, "2026-10-15").proposals.length, 0);
});

// ---------- the hourly Best Buy check inside the news check (scripts/news-check.mjs), with Best Buy replaced ----------
// 15:00 UTC on Oct 15 is 11am in New York: the morning half of the day, so a state that already read the news this
// morning makes the run check Best Buy only.
const NEWS_NOW = "2026-10-15T15:00:00Z";
function newsSetup({ alreadyRead = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "et-news-stock-"));
  for (const d of ["config", "data", ".news-state"]) mkdirSync(join(dir, d));
  const data = plainData();
  const a = data.items.find(i => i.id !== PICK.id && ["out", "soldout", "preorder"].includes(i.status));
  const b = data.items.find(i => i.id === PICK.id);
  a.status = "soldout"; b.status = "out";
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(data, null, 2) + "\n");
  writeFileSync(join(dir, "config/feeds.json"), readFileSync(join(ROOT, "config/feeds.json")));
  writeFileSync(join(dir, "config/stock-check.json"), JSON.stringify({ bestbuy: [{ item: a.id, sku: "1000001" }, { item: b.id, sku: "1000002" }] }));
  if (alreadyRead) writeFileSync(join(dir, ".news-state/state.json"), JSON.stringify({ seen: {}, http: {}, lastCheck: "2026-10-15", lastHalfDay: "2026-10-15 AM" }));
  return { dir, a, b, original: readFileSync(join(dir, "data/releases.json"), "utf8"), fetchLog: join(dir, "fetch.log"), out: join(dir, "gh-output") };
}
// Each run here stands for a new hour: Best Buy is asked at most once an hour (tested in xwatch.test.mjs), so the
// time of the last ask is cleared first.
function newsRun(s, products, env = {}) {
  const stateFile = join(s.dir, ".news-state/state.json");
  if (existsSync(stateFile)) { const st = JSON.parse(readFileSync(stateFile, "utf8")); delete st.lastBestBuy; writeFileSync(stateFile, JSON.stringify(st)); }
  writeFileSync(join(s.dir, "bestbuy.json"), JSON.stringify(answer(...products)));
  writeFileSync(s.fetchLog, ""); writeFileSync(s.out, "");
  const base = { ...process.env };
  delete base.ANTHROPIC_API_KEY;
  const r = spawnSync("node", ["scripts/news-check.mjs"], { cwd: ROOT, encoding: "utf8",
    env: { ...base, NEWS_ROOT: s.dir, NEWS_NOW, ONCE_PER_HALF_DAY: "true", GITHUB_REPOSITORY_OWNER: "someone-42", BESTBUY_API_KEY: "secret-key-123", GITHUB_OUTPUT: s.out,
      FAKE_BESTBUY: join(s.dir, "bestbuy.json"), FAKE_FETCH_LOG: s.fetchLog, NODE_OPTIONS: `--import=${join(ROOT, "test/helpers/fake-bestbuy.mjs")}`, ...env } });
  const read = f => existsSync(join(s.dir, f)) ? readFileSync(join(s.dir, f), "utf8") : null;
  return { ...r, output: readFileSync(s.out, "utf8"), fetches: readFileSync(s.fetchLog, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).url),
    data: JSON.parse(read("data/releases.json")), body: read(".news-state/pr-body.md"), state: JSON.parse(read(".news-state/state.json") || "null") };
}
const itemIn = (r, id) => r.data.items.find(i => i.id === id);

test("hourly runs after the news was read check Best Buy only, and propose a restock for review", () => {
  const s = newsSetup();
  const r = newsRun(s, [prod(1000001, true), prod(1000002, false)]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.fetches.length, 1); // no news feeds, one request to Best Buy
  assert.match(r.fetches[0], /^https:\/\/api\.bestbuy\.com\//);
  assert.match(r.output, /changed=true/);
  assert.doesNotMatch(r.output, /checked=true/); // not counted as a news check (no "last checked" update, no redeploy)
  assert.equal(itemIn(r, s.a.id).status, "restock");
  assert.deepEqual(itemIn(r, s.a.id).restocks.at(-1), { date: "2026-10-15", store: "bestbuy", url: bestBuyListing("1000001"), source: bestBuyListing("1000001"), reported: true });
  assert.equal(itemIn(r, s.b.id).status, "out"); // not available at Best Buy
  assert.match(r.body, /^@someone-42 Something is reported back in stock \(Best Buy\)\..*\n\n### Best Buy check, 2026-10-15 15:00 UTC\n\nProposed 1 change\(s\)\./);
  assert.doesNotMatch(r.body, /headline/);
  assert.match(r.body, /Merge by the end of 2026-10-17/);
  assert.equal(r.state.lastHalfDay, "2026-10-15 AM");
  assert.deepEqual(r.state.bestbuyOffered, { 1000001: true });
  assert.doesNotMatch(r.stdout + r.stderr, /secret-key-123/);
});

test("a restock already proposed isn't proposed again every hour, until Best Buy says it's gone and it comes back", () => {
  const s = newsSetup();
  newsRun(s, [prod(1000001, true)]);
  writeFileSync(join(s.dir, "data/releases.json"), s.original); // the pull request was closed without merging
  const again = newsRun(s, [prod(1000001, true)]);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.output, /changed=false/);
  assert.equal(itemIn(again, s.a.id).status, "soldout");
  const quiet = newsRun(s, []); // Best Buy didn't answer for it: nothing is forgotten
  assert.deepEqual(quiet.state.bestbuyOffered, { 1000001: true });
  const gone = newsRun(s, [prod(1000001, false)]);
  assert.deepEqual(gone.state.bestbuyOffered, {});
  const back = newsRun(s, [prod(1000001, true)]);
  assert.match(back.output, /changed=true/);
  assert.equal(itemIn(back, s.a.id).status, "restock");
});

test("the hourly Best Buy check does nothing without the key, and a Best Buy error is only logged", () => {
  const s = newsSetup();
  const nokey = newsRun(s, [prod(1000001, true)], { BESTBUY_API_KEY: "" });
  assert.equal(nokey.status, 0, nokey.stderr);
  assert.deepEqual(nokey.fetches, []);
  assert.match(nokey.output, /changed=false/);
  assert.equal(readFileSync(join(s.dir, "data/releases.json"), "utf8"), s.original);
  const broken = newsRun(s, [prod(1000001, true)], { FAKE_BESTBUY_THROW: "1" });
  assert.equal(broken.status, 0, broken.stderr);
  assert.match(broken.output, /changed=false/);
  assert.doesNotMatch(broken.stdout + broken.stderr, /secret-key-123/);
});
