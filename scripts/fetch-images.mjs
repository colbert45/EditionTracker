// Takes each release's main product image from its official page (the page's
// share image), shrinks it, and saves it to static/images/. Runs as a GitHub
// Action that opens a pull request, so every image is looked at before it goes live.
//   node scripts/fetch-images.mjs
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { robotsAllows, decode } from "../lib/feeds.js";
import { validate } from "../lib/validate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data/releases.json");
const UA = JSON.parse(readFileSync(join(ROOT, "config/feeds.json"), "utf8")).userAgent;
const sources = JSON.parse(readFileSync(process.env.IMAGE_SOURCES_FILE || join(ROOT, "config/image-sources.json"), "utf8")).items;
const data = JSON.parse(readFileSync(DATA, "utf8"));
const sharp = (await import("sharp")).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = (url, accept) => fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(20000) });

const robots = new Map();
async function allowed(url) {
  const u = new URL(url);
  if (!robots.has(u.origin)) {
    let txt = "";
    try { const r = await get(`${u.origin}/robots.txt`, "text/plain"); if (r.ok) txt = await r.text(); } catch {}
    robots.set(u.origin, txt);
  }
  return robotsAllows(robots.get(u.origin), UA, u.pathname + u.search);
}

function shareImage(html, base) {
  for (const re of [/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i, /<meta[^>]+name=["']twitter:image["'][^>]*>/i]) {
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) return new URL(decode(content), base).href;
  }
  return null;
}

async function imageFrom(page) {
  if (!(await allowed(page))) throw new Error("robots.txt disallows");
  const r = await get(page, "text/html");
  if (!r.ok) throw new Error(`page HTTP ${r.status}`);
  const src = shareImage(await r.text(), r.url);
  if (!src) throw new Error("no share image on page");
  const img = await get(src, "image/*");
  if (!img.ok) throw new Error(`image HTTP ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (!meta.width || meta.width < 300) throw new Error(`image too small (${meta.width}px)`);
  const out = await sharp(buf).resize({ width: 1000, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return { out, src, width: meta.width, height: meta.height };
}

mkdirSync(join(ROOT, "static/images"), { recursive: true });
const rows = [];
for (const [id, s] of Object.entries(sources)) {
  const item = data.items.find(i => i.id === id);
  if (!item) { rows.push([id, "skipped", "not on the site"]); continue; }
  if (item.image) { rows.push([id, "skipped", "already has an image"]); continue; }
  let done = false, errors = [];
  for (const page of s.pages) {
    try {
      const { out, src, width, height } = await imageFrom(page);
      const file = `/images/${id}.jpg`;
      writeFileSync(join(ROOT, "static", file), out);
      item.image = file;
      item.imageCredit = s.credit;
      rows.push([id, "added", `${width}×${height} from ${page}`, src]);
      done = true;
      break;
    } catch (e) { errors.push(`${new URL(page).hostname}: ${e.message}`); }
    await sleep(1000);
  }
  if (!done) rows.push([id, "failed", errors.join("; ")]);
  console.log(id, done ? "added" : "failed " + errors.join("; "));
}

const { errors } = validate(data, { staticDir: join(ROOT, "static") });
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");

const added = rows.filter(r => r[1] === "added");
const branch = process.env.BRANCH;
const raw = id => branch ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${branch}/static/images/${id}.jpg` : "";
const md = [`Took ${added.length} product image(s) from official pages. Check each one is the right product before merging.`, ""];
for (const [id, , note] of added) md.push(`**${id}**: ${note}`, "", `<img src="${raw(id)}" width="320">`, "");
const other = rows.filter(r => r[1] !== "added");
if (other.length) { md.push("<details><summary>Not added</summary>", ""); for (const [id, st, note] of other) md.push(`- ${id}: ${st}, ${note}`); md.push("", "</details>"); }
writeFileSync(join(ROOT, ".images-report.md"), md.join("\n"));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.length}\n`);
console.log(`${added.length} added, ${other.length} not added`);
