// Switches releases to "Preorders open" once their announced preorder date (preordersStart)
// arrives. Edits data/releases.json only; the workflow opens a pull request for review.
//   node scripts/preorders-due.mjs [--date YYYY-MM-DD]
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { duePreorders, duePreordersMarkdown } from "../lib/scheduled.js";
import { validate } from "../lib/validate.js";

const FILE = new URL("../data/releases.json", import.meta.url);
const i = process.argv.indexOf("--date");
const today = i > 0 ? process.argv[i + 1] : new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

const { data, changed } = duePreorders(JSON.parse(readFileSync(FILE, "utf8")), today);
if (!changed.length) { console.log(`No preorder dates due on ${today}.`); out("changed", "false"); process.exit(0); }
const { errors } = validate(data);
if (errors.length) { console.error("Would break releases.json:\n" + errors.join("\n")); process.exit(1); }
writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
mkdirSync(".scheduled", { recursive: true });
writeFileSync(".scheduled/pr-body.md", duePreordersMarkdown(changed));
for (const c of changed) console.log(`Preorders open: ${c.name} (${c.date})`);
out("changed", "true");
out("names", changed.map(c => c.name).join(", ").slice(0, 200));
