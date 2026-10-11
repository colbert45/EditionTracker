// Turns the news check's suggestions into edits to releases.json, one at a time,
// keeping only edits that pass validation. Nothing here touches git or the network.
import { validate } from "./validate.js";
import { ART_TYPES } from "./art.js";
import { cleanLink, listingLink, STOCKABLE } from "./restock.js";

const clone = o => JSON.parse(JSON.stringify(o));
export const slugify = s => s.toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

// The JSON schema Claude must answer with. Enums come from the live data so it can't invent keys.
export function proposalSchema(data) {
  const str = { type: "string" };
  const nstr = { anyOf: [{ type: "null" }, { type: "string" }] };
  const storeEnum = Object.keys(data.stores);
  // "Back in stock" is never picked as a status. A restock is its own change (below), and the site sets the status.
  const statusEnum = Object.keys(data.statuses).filter(s => s !== "restock");
  return {
    type: "object", additionalProperties: false, required: ["proposals"],
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["kind", "itemId", "summary", "confidence", "headlineIds", "changes", "timelineEntry", "newItem"],
          properties: {
            kind: { type: "string", enum: ["update", "new"] },
            itemId: str,
            summary: str,
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            headlineIds: { type: "array", items: { type: "integer" } },
            changes: {
              type: "object", additionalProperties: false,
              required: ["status", "price", "releaseDate", "releaseWindow", "preordersOpened", "preordersStart", "appendNote", "stores", "restock"],
              properties: {
                status: { anyOf: [{ type: "null" }, { type: "string", enum: statusEnum }] },
                price: nstr, releaseDate: nstr, releaseWindow: nstr, preordersOpened: nstr, preordersStart: nstr, appendNote: nstr,
                // A source reports the release available to buy again at a store on the list.
                restock: {
                  anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["store", "date", "listingUrl"],
                    properties: { store: { type: "string", enum: storeEnum }, date: str, listingUrl: nstr } }]
                },
                stores: {
                  anyOf: [{ type: "null" }, { type: "array", items: {
                    type: "object", additionalProperties: false, required: ["store", "listed"],
                    properties: { store: { type: "string", enum: storeEnum }, listed: { type: "boolean" } } } }]
                }
              }
            },
            timelineEntry: {
              anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["date", "text"], properties: { date: str, text: str } }]
            },
            newItem: {
              anyOf: [{ type: "null" }, {
                type: "object", additionalProperties: false,
                required: ["name", "category", "platform", "status", "price", "releaseDate", "releaseWindow", "preordersOpened", "preordersStart", "searchQuery", "notes", "inTheBox", "stores", "artType", "artColors"],
                properties: {
                  name: str, category: { type: "string", enum: Object.keys(data.categories) }, platform: str,
                  status: { type: "string", enum: statusEnum }, price: str,
                  releaseDate: nstr, releaseWindow: nstr, preordersOpened: nstr, preordersStart: nstr, searchQuery: str,
                  notes: { type: "array", items: str }, inTheBox: { type: "array", items: str },
                  stores: { type: "array", items: { type: "string", enum: storeEnum } },
                  artType: { type: "string", enum: ART_TYPES }, artColors: { type: "array", items: str }
                }
              }]
            }
          }
        }
      }
    }
  };
}

const sourceFrom = h => ({ label: h.sourceName, url: h.link });

function addSources(item, headlines) {
  for (const h of headlines) if (!item.sources.some(s => s.url === h.link)) item.sources.push(sourceFrom(h));
}

const isDate = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
const daysBetween = (a, b) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);

// A news report of a restock becomes a "reported" entry in the release's log, with the report as its source.
// Nobody checked the store, so the entry says so, and the emails and pages word it that way.
function recordRestock(next, item, r, used, today, diff) {
  if (!STOCKABLE.has(item.status)) throw new Error(`${item.name} is still "${item.status}", so there's nothing to restock yet`);
  const store = next.stores[r.store];
  if (!store) throw new Error(`no store "${r.store}"`);
  if (!isDate(r.date)) throw new Error(`the restock has no usable date ("${r.date}")`);
  const date = r.date > today ? today : r.date; // a report from "tomorrow" is a time zone, not news
  if (daysBetween(today, date) > 4) throw new Error(`that restock report is from ${date}, too old to send as news`);
  let source;
  try { source = cleanLink(used[0].link, "The source link"); } catch (e) { throw new Error(e.message); }
  // The store's own product page, but only if the report's own text has it and it's on the store's website.
  // Otherwise the log links the store's search for the release, which is what "Check stock" does.
  let url = null;
  if (r.listingUrl && used.some(h => `${h.title} ${h.summary} ${h.link}`.includes(r.listingUrl))) {
    try { url = listingLink(store, r.listingUrl); } catch { url = null; }
  }
  url ??= store.searchUrl ? store.searchUrl + encodeURIComponent(item.searchQuery) : store.url;
  if ((item.restocks || []).some(x => x.date === date && x.store === r.store)) throw new Error(`a restock at ${store.name} is already logged for ${date}`);
  const before = item.status;
  item.restocks = [...(item.restocks || []), { date, store: r.store, url, source, reported: true }];
  item.status = "restock";
  diff.push(["restock", "", `${store.name}, reported ${date}`]);
  if (before !== "restock") diff.push(["status", before, "restock"]);
}

// Apply a single proposal to a copy of data. Returns { data, diff } or throws with a reason.
export function applyOne(data, p, headlinesById, today) {
  const next = clone(data);
  const used = (p.headlineIds || []).map(id => headlinesById.get(id)).filter(Boolean);
  if (!used.length) throw new Error("no matching source headline");
  const diff = [];

  if (p.kind === "update") {
    const item = next.items.find(i => i.id === p.itemId);
    if (!item) throw new Error(`no release with id "${p.itemId}"`);
    const c = p.changes || {};
    if (c.status === "restock") throw new Error("the status \"Back in stock\" is set by recording a restock, not chosen");
    if (c.restock && c.status != null) throw new Error("a restock can't also change the status");
    for (const f of ["status", "price", "releaseDate", "releaseWindow", "preordersOpened", "preordersStart"]) {
      if (c[f] != null && c[f] !== item[f]) { diff.push([f, item[f], c[f]]); item[f] = c[f]; }
    }
    if (c.restock) recordRestock(next, item, c.restock, used, today, diff);
    // A confirmed date replaces a vague window.
    if (c.releaseDate && item.releaseWindow != null && c.releaseWindow == null) { diff.push(["releaseWindow", item.releaseWindow, null]); item.releaseWindow = null; }
    if (c.appendNote) { item.notes.push(c.appendNote); diff.push(["notes", "(added paragraph)", c.appendNote]); }
    for (const s of c.stores || []) {
      const have = item.stores.find(x => x.store === s.store);
      if (have && have.listed !== s.listed) { diff.push([`stores.${s.store}.listed`, have.listed, s.listed]); have.listed = s.listed; }
      if (!have) { item.stores.push({ store: s.store, listed: s.listed }); diff.push(["stores", "", `added ${s.store}`]); }
    }
    if (p.timelineEntry && !item.timeline.some(t => t.date === p.timelineEntry.date && t.text === p.timelineEntry.text)) {
      item.timeline.push(p.timelineEntry); diff.push(["timeline", "", `${p.timelineEntry.date}: ${p.timelineEntry.text}`]);
    }
    const before = item.sources.length;
    addSources(item, used);
    if (item.sources.length > before) diff.push(["sources", "", used.map(h => h.link).join(", ")]);
    if (!diff.length) throw new Error("nothing would change");
  } else if (p.kind === "new") {
    const n = p.newItem;
    if (!n) throw new Error("new release without details");
    if (n.status === "restock") throw new Error("a new release can't start out as back in stock");
    let id = slugify(p.itemId || n.name) || slugify(n.name);
    if (next.items.some(i => i.id === id)) throw new Error(`a release with id "${id}" already exists`);
    if (next.items.some(i => i.name.toLowerCase() === n.name.toLowerCase())) throw new Error(`"${n.name}" is already listed`);
    const item = {
      id, name: n.name, category: n.category, platform: n.platform, status: n.status, price: n.price || "TBA",
      releaseDate: n.releaseDate || null, releaseWindow: n.releaseDate ? null : (n.releaseWindow || "TBA"),
      preordersOpened: n.preordersOpened || null, ...(n.preordersStart ? { preordersStart: n.preordersStart } : {}), searchQuery: n.searchQuery || n.name,
      image: null, imageCredit: null,
      art: { type: n.artType, colors: n.artColors },
      notes: n.notes, inTheBox: n.inTheBox || [],
      stores: [...new Set(n.stores)].map(store => ({ store, listed: n.status !== "rumor" && n.status !== "announced" })),
      timeline: p.timelineEntry ? [p.timelineEntry] : [],
      sources: []
    };
    addSources(item, used);
    next.items.push(item);
    diff.push(["(new release)", "", `${item.name} → /${id}/`]);
  } else throw new Error(`unknown kind "${p.kind}"`);

  next.updated = today;
  const { errors } = validate(next);
  if (errors.length) throw new Error("would break releases.json: " + errors.join("; "));
  return { data: next, diff, used };
}

export function applyAll(data, proposals, headlinesById, today) {
  let cur = data;
  const applied = [], skipped = [];
  for (const p of proposals) {
    try {
      const r = applyOne(cur, p, headlinesById, today);
      cur = r.data;
      applied.push({ p, diff: r.diff, used: r.used });
    } catch (e) {
      skipped.push({ p, reason: e.message });
    }
  }
  return { data: cur, applied, skipped };
}

const cell = v => v === "" ? "" : v == null ? "_empty_" : "`" + String(v).replace(/`/g, "'").replace(/\|/g, "\\|").slice(0, 200) + "`";

export function prMarkdown({ applied, skipped, reviewed, when }) {
  const lines = [`### News check, ${when}`, "", `Read ${reviewed} new headline(s). Proposed ${applied.length} change(s).`, ""];
  for (const { p, diff, used } of applied) {
    lines.push(`#### ${p.kind === "new" ? "New release" : "Update"}: ${p.kind === "new" ? p.newItem.name : p.itemId}`);
    lines.push(`${p.summary} _(confidence: ${p.confidence})_`, "");
    lines.push("| Field | Before | After |", "|---|---|---|");
    for (const [f, a, b] of diff) lines.push(`| ${f} | ${cell(a)} | ${cell(b)} |`);
    // Merging is the send button, so say what a restock sends.
    if (diff.some(d => d[0] === "restock")) lines.push("", `_Merging sends the "Reported back in stock" email to people following this release. Check that the source says it's available now._`);
    lines.push("", "Sources:");
    for (const h of used) lines.push(`- [${h.title.replace(/[[\]]/g, "")}](${h.link}) (${h.sourceName})`);
    lines.push("");
  }
  if (skipped.length) {
    lines.push("<details><summary>Suggestions that were dropped automatically</summary>", "");
    for (const { p, reason } of skipped) lines.push(`- ${p.itemId}: ${p.summary} (${reason})`);
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}
