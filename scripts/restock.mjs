// Stock changes you make from your phone (the "Post a restock" and "Sold out again" actions).
//   node scripts/restock.mjs [--date 2026-10-09]
// What to do comes from the environment, which the workflows fill in from the form:
//   RESTOCK_ACTION   restock (default) or soldout
//   RESTOCK_ITEM, RESTOCK_RETAILER, RESTOCK_LINK, RESTOCK_SOURCE   the form boxes
//   RESTOCK_DRY_RUN  true = change nothing, just show what would happen (the email and the posts)
// It edits data/releases.json, checks it, commits to main and pushes. If main moved in the
// meantime it starts again from the latest main, up to 3 times. It sends no email or post itself:
// the workflow runs `alerts.mjs send` and `social.mjs` next, then asks for a fresh deploy.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyRestock, applySoldOut, InputError } from "../lib/restock.js";
import { planAlerts, emailBody } from "../lib/alerts.js";
import { socialPosts } from "../lib/social.js";
import { validate } from "../lib/validate.js";

const ROOT = process.env.RESTOCK_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data/releases.json");
const env = process.env;
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const today = arg("--date") || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const action = (env.RESTOCK_ACTION || "restock").toLowerCase();
const dry = /^(true|1|yes)$/i.test(env.RESTOCK_DRY_RUN || "");
const branch = env.RESTOCK_BRANCH || "main";
const config = JSON.parse(readFileSync(join(ROOT, "site.config.json"), "utf8"));
const siteUrl = config.siteUrl;

const readData = () => JSON.parse(readFileSync(DATA, "utf8"));
const output = (k, v) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const summary = md => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n"); };
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const BOT = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];

function stop(message) {
  console.error(message);
  // Shows up as a red note at the top of the run page, which is easier to read on a phone than the log.
  if (env.GITHUB_ACTIONS) console.log(`::error title=Nothing was changed::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  summary(`### Nothing was changed\n\n\`\`\`\n${message}\n\`\`\``);
  output("changed", "false");
  process.exit(1);
}

const plan = data => action === "soldout"
  ? applySoldOut(data, { item: env.RESTOCK_ITEM, today })
  : applyRestock(data, { item: env.RESTOCK_ITEM, retailer: env.RESTOCK_RETAILER, link: env.RESTOCK_LINK, source: env.RESTOCK_SOURCE, today });

// Runs the plan on the current data; explains and stops on bad input, or on an edit the validator rejects.
function tryPlan(data) {
  let r;
  try { r = plan(data); } catch (e) { if (e instanceof InputError) stop(e.message); throw e; }
  if (r.changed) {
    const { errors } = validate(r.data);
    if (errors.length) stop("That edit would break data/releases.json:\n" + errors.map(e => "  - " + e).join("\n"));
  }
  return r;
}

const headline = r => action === "soldout"
  ? `Sold out again: ${r.item.name}`
  : `Back in stock: ${r.item.name} at ${r.store.name}`;

function describe(r) {
  const lines = [`**${headline(r)}**`, ""];
  if (action === "restock") {
    lines.push(`- Date: ${r.entry.date}`, `- Listing: ${r.entry.url}`, `- Source: ${r.entry.source || "(none)"}`);
  }
  lines.push(`- Release page: ${siteUrl.replace(/\/$/, "")}/${r.item.id}/`);
  return lines.join("\n");
}

// ---------- dry run ----------
if (dry) {
  const before = readData();
  const r = tryPlan(before);
  if (!r.changed) { console.log(r.note); summary(`### Dry run\n\n${r.note}`); output("changed", "false"); process.exit(0); }
  const mail = action === "restock"
    ? planAlerts(before, r.data, siteUrl).map(a => `To: ${a.tags.join(" or ")}\nSubject: ${a.subject}\n\n${emailBody(a, r.data.categories)}`).join("\n\n---\n\n")
    : "";
  // The posts that go out right after the email: Bluesky with its link, and X with no link (when restocks go to X).
  const posts = action === "restock"
    ? socialPosts(before, r.data, siteUrl, { today }).map(p => [
      `On Bluesky:\n${p.text}`,
      config.social?.restockToX === true && p.xText ? `On X, with no link:\n${p.xText}` : null
    ].filter(Boolean).join("\n\n")).join("\n\n---\n\n")
    : "";
  const text = [
    "DRY RUN: nothing was changed, committed, sent or posted.", "",
    describe(r).replace(/\*\*/g, ""), "",
    `Status: ${before.items.find(i => i.id === r.item.id).status} -> ${r.item.status}`,
    mail ? `\nThe email people would get:\n\n${mail}` : "\nNo email goes out for this.",
    posts ? `\nThe posts that would go out (Discord too, if it's set up):\n\n${posts}` : ""
  ].join("\n");
  console.log(text);
  summary(`### Dry run: nothing was changed, sent or posted\n\n${describe(r)}\n\n${mail ? "The email people would get:\n\n```\n" + mail + "\n```" : "No email goes out for this."}${posts ? "\n\nThe posts that would go out (Discord too, if it's set up):\n\n```\n" + posts + "\n```" : ""}`);
  output("changed", "false");
  process.exit(0);
}

// ---------- the real thing ----------
let lastError = "";
for (let attempt = 1; attempt <= 3; attempt++) {
  const r = tryPlan(readData());
  if (!r.changed) { console.log(r.note); summary(`### ${r.note}`); output("changed", "false"); process.exit(0); }

  const before = git("rev-parse", "HEAD");
  writeFileSync(DATA, JSON.stringify(r.data, null, 2) + "\n");
  git("add", "data/releases.json");
  git(...BOT, "commit", "-m", r.message);
  try {
    git("push", "origin", `HEAD:${branch}`);
  } catch (e) {
    lastError = String(e.stderr || e.message).trim();
    console.log(`Attempt ${attempt}: the push was refused (${lastError.split("\n").pop()}). Starting again from the latest ${branch}.`);
    git("fetch", "origin", branch);
    git("reset", "--hard", `origin/${branch}`);
    continue;
  }
  console.log(`Saved to ${branch}: ${r.message.split("\n")[0]}`);
  summary(`### Saved\n\n${describe(r)}\n\n${action === "restock" ? "Emailing the people who follow this release, then the site redeploys (a minute or two)." : "The site redeploys in a minute or two. No email goes out for this."}`);
  output("changed", "true");
  output("before", before);
  output("alert", action === "restock" ? "true" : "false");
  process.exit(0);
}
stop(`Couldn't save after 3 tries, so nothing was changed. The last error from git:\n${lastError}`);
