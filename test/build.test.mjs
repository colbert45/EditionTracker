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
  const it = data.items.find(i => i.id === "xbox-series-x25");
  it.image = "https://images.example/x25.jpg";
  it.imageCredit = "Photo: Microsoft";
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(data));
  execFileSync("node", ["scripts/build.mjs"], { cwd: dir });
  const html = readFileSync(join(dir, "_site/xbox-series-x25/index.html"), "utf8");
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
  assert.equal((sitemap.match(/<loc>/g) || []).length, data.items.length + 2); // homepage + calendar
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
    assert.doesNotMatch(html, /amazon\./i, f);
  }
  const home = readFileSync(join(ROOT, "_site/index.html"), "utf8");
  assert.match(home, /No ads\. No affiliate links\./);
});

test("the validator rejects affiliate links", async () => {
  const { validate } = await import("../lib/validate.js");
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  assert.deepEqual(validate(data).errors, []);
  data.items[0].stores[0].affiliateUrl = "https://example.com/x";
  assert.ok(validate(data).errors.some(e => e.includes("affiliate")));
});


