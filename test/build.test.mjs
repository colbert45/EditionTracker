import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, cpSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Build a copy of the site where one item has a photo and an affiliate link.
test("image and affiliate link replace the illustration and search link", () => {
  const dir = mkdtempSync(join(tmpdir(), "et-"));
  for (const p of ["lib", "scripts", "static", "og", "site.config.json", "package.json"]) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  const cfg = JSON.parse(readFileSync(join(dir, "site.config.json")));
  writeFileSync(join(dir, "site.config.json"), JSON.stringify({ ...cfg, photos: "all" }));
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  const it = data.items.find(i => i.id === "xbox-series-x25");
  it.image = "https://images.example/x25.jpg";
  it.imageCredit = "Photo: Microsoft";
  it.stores.find(s => s.store === "bestbuy").affiliateUrl = "https://bestbuy.7tiv.net/x25";
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(data));
  execFileSync("node", ["scripts/build.mjs"], { cwd: dir });
  const html = readFileSync(join(dir, "_site/xbox-series-x25/index.html"), "utf8");
  assert.match(html, /<img src="https:\/\/images.example\/x25.jpg"/);
  assert.match(html, /<figcaption>Photo: Microsoft<\/figcaption>/);
  assert.doesNotMatch(html, /Illustration, not a product photo/);
  assert.match(html, /href="https:\/\/bestbuy.7tiv.net\/x25" target="_blank" rel="sponsored noopener"/);
  assert.match(html, /affiliate links/);
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
  assert.equal((sitemap.match(/<loc>/g) || []).length, data.items.length + 1);
});

test("every Amazon link carries the Associates tag and is sponsored", () => {
  execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT });
  const data = JSON.parse(readFileSync(join(ROOT, "data/releases.json")));
  let count = 0;
  for (const i of data.items) {
    const html = readFileSync(join(ROOT, "_site", i.id, "index.html"), "utf8");
    for (const [a] of html.matchAll(/<a [^>]*href="https:\/\/www\.amazon\.[^"]*"[^>]*>/g)) {
      count++;
      assert.match(a, /tag=editiontracker02-20/);
      assert.doesNotMatch(a, /triforcetra08-20/);
      assert.match(a, /rel="noopener sponsored"/);
    }
    if (html.includes("www.amazon.")) assert.match(html, /As an Amazon Associate I earn from qualifying purchases\./);
  }
  assert.ok(count > 0, "expected some Amazon links");
});

