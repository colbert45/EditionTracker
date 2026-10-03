// Checks data/releases.json and explains any problems in plain words.
//   npm run validate
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../lib/validate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let data;
try {
  data = JSON.parse(readFileSync(join(ROOT, "data/releases.json"), "utf8"));
} catch (e) {
  console.error("data/releases.json isn't valid JSON (often a missing comma or quote):\n  " + e.message);
  process.exit(1);
}
const { errors, warnings } = validate(data, { staticDir: join(ROOT, "static") });
warnings.forEach(w => console.warn("warning: " + w));
if (errors.length) {
  console.error(`\n${errors.length} problem(s) in data/releases.json:\n` + errors.map(e => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(`data/releases.json looks good: ${data.items.length} releases.`);
