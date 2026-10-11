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

function setup(edit, editConfig) {
  const dir = mkdtempSync(join(tmpdir(), "et-restock-"));
  const origin = join(dir, "origin.git"), work = join(dir, "work");
  git(dir, "init", "--bare", "-q", "-b", "main", origin);
  git(dir, "init", "-q", "-b", "main", work);
  mkdirSync(join(work, "data"));
  const data = plainData();
  if (edit) edit(data);
  writeFileSync(join(work, "data/releases.json"), JSON.stringify(data, null, 2) + "\n");
  const config = JSON.parse(readFileSync(join(ROOT, "site.config.json"), "utf8"));
  config.social.restockToX = true; // pinned, so these tests don't depend on what the live config says
  if (editConfig) editConfig(config);
  writeFileSync(join(work, "site.config.json"), JSON.stringify(config, null, 2));
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

test("with the Store box blank, the store comes from the link", () => {
  // A store whose website no other store shares, so a store added to the real list later can't make the link ambiguous.
  const s = setup(d => { d.stores.onlyone = { name: "Only One Shop", url: "https://shop.onlyone.test/" }; });
  const r = run(s, { RESTOCK_RETAILER: "", RESTOCK_LINK: "https://shop.onlyone.test/p/1?utm_source=share" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(git(s.origin, "log", "-1", "--format=%s", "main"), `Back in stock: ${PICK.name} at Only One Shop`);
  const [entry] = onOrigin(s).items.find(i => i.id === PICK.id).restocks;
  assert.equal(entry.store, "onlyone");
  assert.equal(entry.url, "https://shop.onlyone.test/p/1");
});

test("a dry run changes nothing and shows the email", () => {
  const s = setup();
  const r = run(s, { RESTOCK_DRY_RUN: "true" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(head(s), s.start);
  assert.equal(git(s.work, "status", "--porcelain"), "");
  assert.match(r.stdout, /DRY RUN: nothing was changed, committed, sent or posted/);
  assert.match(r.stdout, new RegExp(`Subject: Back in stock: ${PICK.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at Best Buy`));
  assert.match(r.stdout, /Go to the listing/);
  assert.deepEqual(r.outputs, { changed: "false" });
  assert.match(r.summary, /Dry run: nothing was changed, sent or posted/);
  // It shows the posts too: Bluesky with its link, and X with none.
  assert.match(r.stdout, new RegExp(`The posts that would go out[^\\n]*\\n\\nOn Bluesky:\\nBack in stock: ${PICK.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at Best Buy\\n[^\\n]*\\nhttps://editiontracker.com/${PICK.id}/\\n\\nOn X, with no link:\\nBack in stock: [^\\n]*\\n[^\\n]*\\nStore links: editiontracker dot com\\n#Restock`));
  assert.match(r.summary, /The posts that would go out/);
  assert.equal(head(s), s.start);
});

test("a dry run doesn't show an X post when restocks are kept off X", () => {
  const s = setup(undefined, c => { c.social.restockToX = false; });
  const r = run(s, { RESTOCK_DRY_RUN: "true" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /On Bluesky:/);
  assert.doesNotMatch(r.stdout, /On X/);
});

test("a dry run of sold out again has no posts", () => {
  const s = setup();
  assert.equal(run(s).status, 0);
  const r = run(s, { RESTOCK_ACTION: "soldout", RESTOCK_DRY_RUN: "true" }, { date: "2026-10-10" });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /The posts that would go out/);
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

test("the send command leaves out a news report that is days old by the time it's merged", () => {
  const s = setup();
  const ago = n => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  // A commit like the merge of a news check pull request: a reported restock, dated `date`.
  const report = date => {
    const data = JSON.parse(readFileSync(join(s.work, "data/releases.json"), "utf8"));
    const it = data.items.find(i => i.id === PICK.id);
    it.status = "restock";
    it.restocks = [{ date, store: "bestbuy", url: "https://www.bestbuy.com/site/searchpage.jsp?st=x", source: "https://news.example/report", reported: true }];
    writeFileSync(join(s.work, "data/releases.json"), JSON.stringify(data, null, 2) + "\n");
    git(s.work, "commit", "-q", "-am", "News check: proposed release updates");
  };
  report(ago(1));
  assert.match(resend(s).stdout, new RegExp(`Would send "Reported back in stock: .+ at Best Buy" to item:${PICK.id}\\n?$`));
  git(s.work, "reset", "-q", "--hard", s.start);
  report(ago(6));
  assert.match(resend(s).stdout, /No release changes worth an alert\./);
});
