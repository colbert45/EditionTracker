import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainData, pickItems } from "./helpers/stock.mjs";
import { validate } from "../lib/validate.js";
import { planAlerts } from "../lib/alerts.js";

// Runs scripts/restock.mjs against a throwaway repo whose "origin" is a local bare repo,
// so the commit, the push and the push-race retry are all tested for real.
const ROOT = new URL("..", import.meta.url).pathname;
const SCRIPT = join(ROOT, "scripts/restock.mjs");
const NO_GLOBAL = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...NO_GLOBAL } }).trim();

const { item: PICK, other: OTHER } = pickItems(plainData());
const BB = "https://www.bestbuy.com/site/example/6000000.p?skuId=6000000";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "et-restock-"));
  const origin = join(dir, "origin.git"), work = join(dir, "work");
  git(dir, "init", "--bare", "-q", "-b", "main", origin);
  git(dir, "init", "-q", "-b", "main", work);
  mkdirSync(join(work, "data"));
  writeFileSync(join(work, "data/releases.json"), JSON.stringify(plainData(), null, 2) + "\n");
  copyFileSync(join(ROOT, "site.config.json"), join(work, "site.config.json"));
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "Start");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "main");
  return { dir, origin, work, start: git(work, "rev-parse", "HEAD") };
}
const onOrigin = (s, file = "data/releases.json") => JSON.parse(git(s.origin, "show", `main:${file}`));
const head = s => git(s.origin, "rev-parse", "main");

function run(s, env = {}, { date = "2026-10-09" } = {}) {
  const out = join(s.dir, `out-${Math.random().toString(36).slice(2)}`), sum = out + "-summary";
  writeFileSync(out, ""); writeFileSync(sum, "");
  const r = spawnSync("node", [SCRIPT, "--date", date], {
    encoding: "utf8",
    env: { ...process.env, ...NO_GLOBAL, RESTOCK_ROOT: s.work, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, RESTOCK_ITEM: PICK.id, RESTOCK_RETAILER: "best buy", RESTOCK_LINK: BB, ...env }
  });
  const outputs = Object.fromEntries(readFileSync(out, "utf8").split("\n").filter(Boolean).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { ...r, outputs, summary: readFileSync(sum, "utf8") };
}

test("a restock is committed to main, and the sha before it is passed on for the alert", () => {
  const s = setup();
  const r = run(s);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.outputs, { changed: "true", before: s.start, alert: "true" });
  const data = onOrigin(s);
  const it = data.items.find(i => i.id === PICK.id);
  assert.equal(it.status, "restock");
  assert.deepEqual(it.restocks, [{ date: "2026-10-09", store: "bestbuy", url: BB, source: null }]);
  assert.equal(data.updated, "2026-10-09");
  assert.deepEqual(validate(data).errors, []);
  assert.equal(git(s.origin, "log", "-1", "--format=%an|%s", "main"), `github-actions[bot]|Back in stock: ${PICK.name} at Best Buy`);
  assert.match(git(s.origin, "log", "-1", "--format=%b", "main"), /Listing: https:\/\/www.bestbuy.com\/site\/example\/6000000.p\?skuId=6000000/);
  // Only that one release changed, and it makes exactly one restock email.
  const [a, ...rest] = planAlerts(JSON.parse(git(s.origin, "show", `${s.start}:data/releases.json`)), data, "https://editiontracker.com");
  assert.equal(rest.length, 0);
  assert.equal(a.kind, "restock");
  assert.match(r.summary, /### Saved/);
});

test("a dry run changes nothing and shows the email", () => {
  const s = setup();
  const r = run(s, { RESTOCK_DRY_RUN: "true" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(head(s), s.start);
  assert.equal(git(s.work, "status", "--porcelain"), "");
  assert.match(r.stdout, /DRY RUN: nothing was changed/);
  assert.match(r.stdout, new RegExp(`Subject: Back in stock: ${PICK.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at Best Buy`));
  assert.match(r.stdout, /Go to the listing/);
  assert.deepEqual(r.outputs, { changed: "false" });
  assert.match(r.summary, /Dry run: nothing was changed or sent/);
});

test("bad input stops with the reason in plain words and nothing is saved", () => {
  const s = setup();
  const r = run(s, { RESTOCK_LINK: "https://www.walmart.com/ip/1", RESTOCK_RETAILER: "best buy" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /goes to walmart\.com, but Best Buy sells from bestbuy\.com/);
  assert.deepEqual(r.outputs, { changed: "false" });
  assert.match(r.summary, /### Nothing was changed/);
  assert.equal(head(s), s.start);
  assert.equal(git(s.work, "status", "--porcelain"), "");
});

test("running the same restock twice only saves it once", () => {
  const s = setup();
  assert.equal(run(s).status, 0);
  const saved = head(s);
  const again = run(s);
  assert.equal(again.status, 0);
  assert.deepEqual(again.outputs, { changed: "false" });
  assert.match(again.stdout, /already logged/);
  assert.match(again.stdout, /run Resend restock email/);
  assert.equal(head(s), saved);
});

test("if main moved while it was running, it starts again from the latest main", () => {
  const s = setup();
  // Someone else lands a change on main (a merged pull request, say) from another clone.
  const other = join(s.dir, "other");
  git(s.dir, "clone", "-q", s.origin, other);
  const data = JSON.parse(readFileSync(join(other, "data/releases.json"), "utf8"));
  data.items.find(i => i.id === OTHER.id).price = "$1.23";
  writeFileSync(join(other, "data/releases.json"), JSON.stringify(data, null, 2) + "\n");
  git(other, "commit", "-q", "-am", "Someone else's change");
  git(other, "push", "-q", "origin", "main");
  const theirs = git(other, "rev-parse", "HEAD");

  const r = run(s);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Attempt 1: the push was refused/);
  assert.equal(r.outputs.before, theirs); // the alert compares against their commit, not the old one
  const now = onOrigin(s);
  assert.equal(now.items.find(i => i.id === OTHER.id).price, "$1.23"); // their change is kept
  assert.equal(now.items.find(i => i.id === PICK.id).status, "restock"); // and so is the restock
  assert.equal(git(s.origin, "rev-list", "--count", "main"), "3"); // Start, theirs, ours: no merge commit, no lost work
  assert.deepEqual(validate(now).errors, []);
});

test("it gives up after three refused pushes and says what git said", () => {
  const s = setup();
  const hook = join(s.origin, "hooks/pre-receive");
  mkdirSync(join(s.origin, "hooks"), { recursive: true });
  writeFileSync(hook, "#!/bin/sh\necho 'protected branch, pull request required' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const r = run(s);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Couldn't save after 3 tries[\s\S]*protected branch/);
  assert.deepEqual(r.outputs, { changed: "false" });
  assert.equal(head(s), s.start);
  assert.equal(git(s.work, "status", "--porcelain"), "");
});

test("sold out again flips the status, quietly", () => {
  const s = setup();
  assert.equal(run(s).status, 0);
  const r = run(s, { RESTOCK_ACTION: "soldout" }, { date: "2026-10-10" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.outputs.alert, "false");
  assert.equal(r.outputs.changed, "true");
  const it = onOrigin(s).items.find(i => i.id === PICK.id);
  assert.equal(it.status, "soldout");
  assert.equal(it.restocks.length, 1);
  assert.equal(git(s.origin, "log", "-1", "--format=%s", "main"), `Sold out again: ${PICK.name} [no alerts]`);
  // Marking it again is a no-op.
  const again = run(s, { RESTOCK_ACTION: "soldout" }, { date: "2026-10-10" });
  assert.equal(again.status, 0);
  assert.equal(again.outputs.changed, "false");
});

test("sold out again with no release name stops", () => {
  const s = setup();
  const r = run(s, { RESTOCK_ACTION: "soldout", RESTOCK_ITEM: "" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Type the release's name/);
  assert.ok(existsSync(join(s.work, "data/releases.json")));
  assert.equal(head(s), s.start);
});

// What the "Resend restock email" workflow runs, on a real checkout: the code sits next to the data.
function resend(s) {
  mkdirSync(join(s.work, "scripts"), { recursive: true });
  copyFileSync(join(ROOT, "scripts/alerts.mjs"), join(s.work, "scripts/alerts.mjs"));
  cpSync(join(ROOT, "lib"), join(s.work, "lib"), { recursive: true });
  const env = { ...process.env, ...NO_GLOBAL };
  delete env.BUTTONDOWN_API_KEY;
  return spawnSync("node", ["scripts/alerts.mjs", "send", "HEAD~1", "--dry-run"], { cwd: s.work, encoding: "utf8", env });
}

test("if the email failed, the resend command plans exactly that restock's email from the latest commit", () => {
  const s = setup();
  assert.equal(run(s).status, 0);
  const r = resend(s);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^Would send "Back in stock: .+ at Best Buy" to item:${PICK.id} or type:`));
});

test("the resend command sends nothing for a sold out again commit", () => {
  const s = setup();
  assert.equal(run(s).status, 0);
  assert.equal(run(s, { RESTOCK_ACTION: "soldout" }, { date: "2026-10-10" }).status, 0);
  assert.match(git(s.work, "log", "-1", "--format=%s"), /^Sold out again: /); // the workflow's own guard stops here, and so does [no alerts]
  assert.match(resend(s).stdout, /A commit says \[no alerts\]\. Not sending\./);
});
