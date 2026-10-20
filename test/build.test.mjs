import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, cpSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Build a copy of the site where one item has a photo.
test("a photo replaces the illustration", () => {
  const dir = mkdtempSync(join(tmpdir(), "et-"));
  for (const p of ["lib", "scripts", "static", "og", "site.config.json", "package.json"]) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  const cfg = JSON.parse(readFileSync(join(dir, "site.config.json")));
  writeFileSync(join(dir, "site.config.json"), JSON.stringify({ ...cfg, photos: "all" }));
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  const it = data.items[0]; // any release will do
  it.image = "https://images.example/x25.jpg";
  it.imageCredit = "Photo: Microsoft";
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(data));
  execFileSync("node", ["scripts/build.mjs"], { cwd: dir });
  const html = readFileSync(join(dir, `_site/${it.id}/index.html`), "utf8");
  assert.match(html, /<img src="https:\/\/images.example\/x25.jpg"/);
  assert.match(html, /<figcaption>Photo: Microsoft<\/figcaption>/);
  assert.doesNotMatch(html, /Illustration, not a product photo/);
  assert.match(html, /og:image" content="https:\/\/images.example\/x25.jpg"/);
  const home = readFileSync(join(dir, "_site/index.html"), "utf8");
  assert.match(home, /<span class="thumb"><img src="https:\/\/images.example\/x25.jpg"/);
});

test("every page has its own title, description, canonical and Product data", () => {
  execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT });
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  const titles = new Set(), descs = new Set();
  for (const i of data.items) {
    const html = readFileSync(join(ROOT, "_site", i.id, "index.html"), "utf8");
    titles.add(html.match(/<title>(.*?)<\/title>/)[1]);
    descs.add(html.match(/<meta name="description" content="(.*?)">/)[1]);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://editiontracker.com/${i.id}/">`));
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    assert.equal(ld[0]["@type"], "Product");
  }
  assert.equal(titles.size, data.items.length);
  assert.equal(descs.size, data.items.length);
  const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
  assert.equal((sitemap.match(/<loc>/g) || []).length, data.items.length + 3); // homepage + calendar + about
});

test("no page has affiliate links, tags or sponsored markup", async () => {
  execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT });
  const { readdirSync, statSync } = await import("node:fs");
  const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : []; });
  const pages = walk(join(ROOT, "_site"));
  assert.ok(pages.length > 30);
  for (const f of pages) {
    const html = readFileSync(f, "utf8");
    assert.doesNotMatch(html, /rel="[^"]*sponsored/, f);
    assert.doesNotMatch(html, /[?&]tag=[a-z0-9-]+-20/i, f);
    assert.doesNotMatch(html, /Amazon Associate/i, f);
    // Links only: a sentence like "Not sold on Amazon." in a note or a "How to get one" box is fine.
    assert.doesNotMatch(html, /(?:href|src|action|content)="(?:https?:)?\/\/(?:[^"\/]*\.)?(?:amazon\.[a-z.]+|amzn\.[a-z.]+|a\.co)[\/"?#:]/i, f);
  }
  const home = readFileSync(join(ROOT, "_site/index.html"), "utf8");
  assert.match(home, /No ads\. No affiliate links\./);
});

test("the validator rejects affiliate links", async () => {
  const { validate } = await import("../lib/validate.js");
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  assert.deepEqual(validate(data).errors, []);
  data.items.find(i => i.stores.length).stores[0].affiliateUrl = "https://example.com/x";
  assert.ok(validate(data).errors.some(e => e.includes("affiliate")));
});



test("every release has a type, and the homepage has a type button for each type in use", async () => {
  const { validate } = await import("../lib/validate.js");
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  for (const bad of [undefined, "spaceship", "toString"]) {
    const d = JSON.parse(JSON.stringify(data));
    d.items[0].type = bad;
    assert.ok(validate(d).errors.some(e => e.includes("type (what kind of thing it is)")), String(bad));
  }
  execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT });
  const home = readFileSync(join(ROOT, "_site/index.html"), "utf8");
  assert.match(home, /<div class="chips types" role="group" aria-label="Filter by type"><button type="button" data-type="all" aria-pressed="true">All types<\/button>/);
  const used = new Set(data.items.map(i => i.type));
  for (const [k, v] of Object.entries(data.types)) {
    const button = `data-type="${k}" aria-pressed="false">${v.replace(/&/g, "&amp;")}</button>`;
    assert.equal(home.includes(button), used.has(k), k);
  }
  for (const i of data.items) assert.ok(home.includes(`data-cat="${i.category}" data-type="${i.type}"`), i.id);
});

test("a release's brand goes into its Product data, and a release without one has none", async () => {
  const { validate } = await import("../lib/validate.js");
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  for (const bad of ["", " Sony", 7, "x".repeat(61)]) {
    const d = JSON.parse(JSON.stringify(data));
    d.items[0].brand = bad;
    assert.ok(validate(d).errors.some(e => e.includes("brand")), JSON.stringify(bad));
  }
  execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT });
  const product = id => JSON.parse(readFileSync(join(ROOT, "_site", id, "index.html"), "utf8").match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  for (const i of data.items) {
    const p = product(i.id);
    if (i.brand) assert.deepEqual(p.brand, { "@type": "Brand", name: i.brand }, i.id);
    else assert.equal(p.brand, undefined, i.id);
  }
  assert.ok(data.items.some(i => i.brand) && data.items.some(i => !i.brand)); // both cases are checked
});
