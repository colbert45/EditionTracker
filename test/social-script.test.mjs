import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { applyRestock } from "../lib/restock.js";

// Runs scripts/social.mjs on a throwaway repo whose last commit logs a restock, with no keys set,
// so it can only say what it would post. Nothing is sent anywhere.
const ROOT = new URL("..", import.meta.url).pathname;
const NO_GLOBAL = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...NO_GLOBAL } }).trim();
const { item: PICK } = pickItems(plainData());
const BB = "https://www.bestbuy.com/site/example/6000000.p?skuId=6000000";

function repoWithRestock(message) {
  const dir = mkdtempSync(join(tmpdir(), "et-social-"));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "data")); mkdirSync(join(dir, "scripts"));
  copyFileSync(join(ROOT, "site.config.json"), join(dir, "site.config.json"));
  copyFileSync(join(ROOT, "scripts/social.mjs"), join(dir, "scripts/social.mjs"));
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  const before = plainData();
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(before, null, 2) + "\n");
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "Start");
  const start = git(dir, "rev-parse", "HEAD");
  const r = applyRestock(before, { item: PICK.id, retailer: "best buy", link: BB, source: "", today: "2026-10-09" });
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
