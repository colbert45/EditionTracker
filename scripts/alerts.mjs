// Buttondown alerts.
//   node scripts/alerts.mjs sync-tags          make sure every type:/item: tag exists in Buttondown
//   node scripts/alerts.mjs send <before-sha>   email subscribers about what changed since <before-sha>
// Needs BUTTONDOWN_API_KEY. Without it, or with --dry-run, it only prints what it would do.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planAlerts, emailBody, typeTag, itemTag } from "../lib/alerts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(ROOT, p), "utf8");
const config = JSON.parse(read("site.config.json"));
const data = JSON.parse(read("data/releases.json"));
const KEY = process.env.BUTTONDOWN_API_KEY || "";
const DRY = process.argv.includes("--dry-run") || !KEY;
const MAX_EMAILS = 8; // a bigger batch than this is almost always a bulk edit, not news

const API = "https://api.buttondown.com/v1";
async function bd(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Token ${KEY}`, "Content-Type": "application/json",
      // Buttondown refuses to send email through the API without this opt-in header.
      ...(method === "POST" && path === "/emails" ? { "X-Buttondown-Live-Dangerously": "true" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Buttondown ${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function allTags() {
  const tags = [];
  let path = "/tags?page_size=100";
  while (path) {
    const page = await bd("GET", path);
    tags.push(...page.results);
    path = page.next ? page.next.replace(API, "") : null;
  }
  return new Map(tags.map(t => [t.name, t]));
}

// The tags the site's forms can send, with what subscribers see in their preferences.
function wantedTags() {
  const t = Object.entries(data.categories).map(([k, v]) => ({
    name: typeTag(k), color: "#D7263D", subscriber_editable: true,
    description: `Alerts for every ${v} release`, public_description: `${v} alerts`
  }));
  for (const i of data.items) t.push({
    name: itemTag(i.id), color: "#2563A8", subscriber_editable: true,
    description: `Alerts for ${i.name}`, public_description: `Alerts: ${i.name}`
  });
  return t;
}

async function syncTags() {
  const want = wantedTags();
  if (DRY) { console.log(`Dry run: would make sure ${want.length} tags exist.`); return; }
  const have = await allTags();
  let made = 0;
  for (const t of want) if (!have.has(t.name)) { await bd("POST", "/tags", t); made++; }
  console.log(`Tags: ${want.length} wanted, ${made} created.`);
}

async function send(beforeSha) {
  if (!beforeSha || /^0+$/.test(beforeSha)) { console.log("No previous commit to compare with. Nothing to send."); return; }
  const msg = execFileSync("git", ["log", "--format=%B", `${beforeSha}..HEAD`], { cwd: ROOT, encoding: "utf8" });
  if (/\[no alerts\]/i.test(msg)) { console.log("A commit says [no alerts]. Not sending."); return; }
  let oldData;
  try { oldData = JSON.parse(execFileSync("git", ["show", `${beforeSha}:data/releases.json`], { cwd: ROOT, encoding: "utf8" })); }
  catch { console.log("Couldn't read the previous releases.json. Nothing to send."); return; }

  const alerts = planAlerts(oldData, data, config.siteUrl);
  if (!alerts.length) { console.log("No release changes worth an alert."); return; }
  if (alerts.length > MAX_EMAILS) {
    console.log(`${alerts.length} releases changed at once, which looks like a bulk edit. Not sending. Changed: ${alerts.map(a => a.id).join(", ")}`);
    return;
  }
  for (const a of alerts) console.log(`${DRY ? "Would send" : "Sending"} "${a.subject}" to ${a.tags.join(" or ")}`);
  if (DRY) return;

  const have = await allTags();
  for (const a of alerts) {
    const ids = a.tags.map(n => have.get(n)?.id).filter(Boolean);
    if (!ids.length) { console.log(`  skipped ${a.id}: no one has those tags yet`); continue; }
    await bd("POST", "/emails", {
      subject: a.subject,
      body: emailBody(a, data.categories),
      status: "about_to_send",
      archival_mode: "disabled",
      filters: { predicate: "or", groups: [], filters: ids.map(id => ({ field: "subscriber.tags", operator: "contains", value: id })) }
    });
    console.log(`  sent ${a.id}`);
  }
}

const [cmd, arg] = process.argv.slice(2).filter(a => a !== "--dry-run");
if (cmd === "sync-tags") await syncTags();
else if (cmd === "send") await send(arg);
else { console.error("Usage: node scripts/alerts.mjs sync-tags | send <before-sha> [--dry-run]"); process.exit(1); }
