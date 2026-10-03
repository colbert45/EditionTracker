import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyAll, prMarkdown, slugify } from "../lib/proposals.js";

const data = JSON.parse(readFileSync(new URL("../data/releases.json", import.meta.url)));
const h = new Map([[1, { id: 1, title: "Zelda Switch 2 sold out again", link: "https://news.example/zelda", sourceName: "Example News" }],
                   [2, { id: 2, title: "Sony reveals Astro Bot DualSense", link: "https://news.example/astro", sourceName: "Example News" }]]);
const noChange = { status: null, price: null, releaseDate: null, releaseWindow: null, preordersOpened: null, appendNote: null, stores: null };

test("applies an update with timeline and source", () => {
  const { data: next, applied, skipped } = applyAll(data, [{
    kind: "update", itemId: "switch-2-zelda-40th", summary: "Sold out", confidence: "high", headlineIds: [1],
    changes: { ...noChange, status: "soldout" }, timelineEntry: { date: "2026-10-02", text: "Sold out again." }, newItem: null
  }], h, "2026-10-03");
  assert.equal(skipped.length, 0);
  const it = next.items.find(i => i.id === "switch-2-zelda-40th");
  assert.equal(it.status, "soldout");
  assert.equal(it.timeline.at(-1).text, "Sold out again.");
  assert.equal(it.sources.at(-1).url, "https://news.example/zelda");
  assert.equal(next.updated, "2026-10-03");
  assert.ok(prMarkdown({ applied, skipped, reviewed: 2, when: "now" }).includes("https://news.example/zelda"));
  assert.equal(data.items.find(i => i.id === "switch-2-zelda-40th").status, "preorder", "original untouched");
});

test("adds a new release", () => {
  const { data: next, applied } = applyAll(data, [{
    kind: "new", itemId: "DualSense Astro Bot", summary: "New controller", confidence: "medium", headlineIds: [2],
    changes: noChange, timelineEntry: null,
    newItem: { name: "DualSense Astro Bot Limited Edition", category: "playstation", platform: "PS5", status: "announced", price: "$79.99",
      releaseDate: null, releaseWindow: "November 2026", preordersOpened: null, searchQuery: "DualSense Astro Bot",
      notes: ["Blue and white controller."], inTheBox: [], stores: ["psdirect", "bestbuy"], artType: "pad", artColors: ["#2E6FD8", "#FFFFFF", "#1A1A1A"] }
  }], h, "2026-10-03");
  assert.equal(applied.length, 1);
  const it = next.items.at(-1);
  assert.equal(it.id, "dualsense-astro-bot");
  assert.equal(it.releaseWindow, "November 2026");
  assert.deepEqual(it.sources, [{ label: "Example News", url: "https://news.example/astro" }]);
});

test("drops bad proposals instead of breaking the data", () => {
  const { applied, skipped } = applyAll(data, [
    { kind: "update", itemId: "does-not-exist", summary: "x", confidence: "low", headlineIds: [1], changes: noChange, timelineEntry: null, newItem: null },
    { kind: "update", itemId: "switch-2-zelda-40th", summary: "x", confidence: "low", headlineIds: [99], changes: { ...noChange, price: "$1" }, timelineEntry: null, newItem: null },
    { kind: "update", itemId: "switch-2-zelda-40th", summary: "x", confidence: "low", headlineIds: [1], changes: { ...noChange, releaseDate: "Oct 29" }, timelineEntry: null, newItem: null }
  ], h, "2026-10-03");
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 3);
});

test("slugify", () => {
  assert.equal(slugify("LEGO Zelda: Ocarina of Time Link & Epona"), "lego-zelda-ocarina-of-time-link-and-epona");
});
