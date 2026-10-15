// Checks Best Buy's stock for the releases in config/stock-check.json, and starts the "Post a restock" action for any
// that just came back. That action does the rest: it logs the restock on the release's page, emails the people
// following it, posts it, and redeploys the site. So a restock found here is on the site and in inboxes within a minute.
//   node scripts/stock-check.mjs [--show]
//   --show   prints what Best Buy says for each product and what would happen. Changes and starts nothing.
// Needs BESTBUY_API_KEY (a free key from developer.bestbuy.com) and, to start the action, GH_TOKEN. Without the key
// it does nothing. STOCK_STATE_FILE is where the last answers are kept between runs (the workflow keeps it on a branch).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBestBuy, planStock, bestBuyListing, isSku } from "../lib/stockcheck.js";
import { STOCKABLE } from "../lib/restock.js";

const ROOT = process.env.STOCK_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const show = process.argv.includes("--show");
const STATE = env.STOCK_STATE_FILE || join(ROOT, ".stock-state/bestbuy.json");
const log = (...a) => console.log(...a);
const output = (k, v) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
output("state_changed", "false");

if (!env.BESTBUY_API_KEY) { log("BESTBUY_API_KEY isn't set, so nothing was checked."); process.exit(0); }
const config = JSON.parse(readFileSync(join(ROOT, "config/stock-check.json"), "utf8"));
const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json"), "utf8"));
const known = new Map(data.items.map(i => [i.id, i]));
const entries = [];
for (const e of config.bestbuy || []) {
  if (!isSku(e.sku)) { log(`${e.item}: no valid Best Buy number (SKU), skipped.`); continue; }
  if (!known.has(e.item)) { log(`${e.item}: not a release on the site, skipped.`); continue; }
  entries.push(e);
}
if (!entries.length) { log("Nothing to check."); process.exit(0); }

// One request for all of them. The key is part of the address, so the address is never printed.
let seen;
try {
  const url = `https://api.bestbuy.com/v1/products(sku in(${entries.map(e => e.sku).join(",")}))?apiKey=${encodeURIComponent(env.BESTBUY_API_KEY)}&show=sku,name,onlineAvailability,orderable&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Best Buy answered ${res.status}`);
  seen = parseBestBuy(await res.json());
} catch (e) {
  // A bad moment at Best Buy isn't worth a failed run (and an alert about it): the next check tries again.
  log(`::warning title=Best Buy check skipped::${String(e.message).replace(/apiKey=[^&\s]*/g, "apiKey=***")}`);
  process.exit(0);
}

let before = {};
if (existsSync(STATE)) { try { before = JSON.parse(readFileSync(STATE, "utf8")); } catch { before = {}; } }
const { after, restocks, notes } = planStock(entries, seen, before);
for (const n of notes) log(n);
if (show) {
  for (const e of entries) { const s = seen.get(e.sku); log(`  ${e.item} (${e.sku}): ${s ? `${s.available ? "available" : "not available"} (Best Buy says orderable: ${s.orderable ?? "nothing"}; ${s.name})` : "no answer"}`); }
  process.exit(0);
}

// Start the restock action for each one that came back. A start that fails isn't remembered, so the next check tries again.
for (const r of restocks) {
  const item = known.get(r.item);
  if (!STOCKABLE.has(item.status)) { log(`${r.item} is "${item.status}" on the site, so a restock can't be logged. Skipped.`); continue; }
  try {
    execFileSync(env.STOCK_GH || "gh", ["workflow", "run", "post-restock.yml", "--ref", "main", "-f", `item=${r.item}`, "-f", `link=${bestBuyListing(r.sku)}`, "-f", "retailer=Best Buy"], { stdio: "inherit" });
    log(`Started the restock action for ${r.item}.`);
  } catch (e) { log(`Couldn't start the restock action for ${r.item}: ${e.message}`); after[r.sku] = false; }
}

if (JSON.stringify(after) !== JSON.stringify(before)) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(after, null, 1) + "\n");
  output("state_changed", "true");
}
