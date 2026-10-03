// Turns the news check's suggestions into edits to releases.json, one at a time,
// keeping only edits that pass validation. Nothing here touches git or the network.
import { validate } from "./validate.js";
import { ART_TYPES } from "./art.js";

const clone = o => JSON.parse(JSON.stringify(o));
export const slugify = s => s.toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

// The JSON schema Claude must answer with. Enums come from the live data so it can't invent keys.
export function proposalSchema(data) {
  const str = { type: "string" };
  const nstr = { anyOf: [{ type: "null" }, { type: "string" }] };
  const storeEnum = Object.keys(data.stores);
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
              required: ["status", "price", "releaseDate", "releaseWindow", "preordersOpened", "appendNote", "stores"],
              properties: {
                status: { anyOf: [{ type: "null" }, { type: "string", enum: Object.keys(data.statuses) }] },
                price: nstr, releaseDate: nstr, releaseWindow: nstr, preordersOpened: nstr, appendNote: nstr,
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
                required: ["name", "category", "platform", "status", "price", "releaseDate", "releaseWindow", "preordersOpened", "searchQuery", "notes", "inTheBox", "stores", "artType", "artColors"],
                properties: {
                  name: str, category: { type: "string", enum: Object.keys(data.categories) }, platform: str,
                  status: { type: "string", enum: Object.keys(data.statuses) }, price: str,
                  releaseDate: nstr, releaseWindow: nstr, preordersOpened: nstr, searchQuery: str,
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
    for (const f of ["status", "price", "releaseDate", "releaseWindow", "preordersOpened"]) {
      if (c[f] != null && c[f] !== item[f]) { diff.push([f, item[f], c[f]]); item[f] = c[f]; }
    }
    // A confirmed date replaces a vague window.
    if (c.releaseDate && item.releaseWindow != null && c.releaseWindow == null) { diff.push(["releaseWindow", item.releaseWindow, null]); item.releaseWindow = null; }
    if (c.appendNote) { item.notes.push(c.appendNote); diff.push(["notes", "(added paragraph)", c.appendNote]); }
    for (const s of c.stores || []) {
      const have = item.stores.find(x => x.store === s.store);
      if (have && have.listed !== s.listed) { diff.push([`stores.${s.store}.listed`, have.listed, s.listed]); have.listed = s.listed; }
      if (!have) { item.stores.push({ store: s.store, listed: s.listed, affiliateUrl: null }); diff.push(["stores", "", `added ${s.store}`]); }
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
    let id = slugify(p.itemId || n.name) || slugify(n.name);
    if (next.items.some(i => i.id === id)) throw new Error(`a release with id "${id}" already exists`);
    if (next.items.some(i => i.name.toLowerCase() === n.name.toLowerCase())) throw new Error(`"${n.name}" is already listed`);
    const item = {
      id, name: n.name, category: n.category, platform: n.platform, status: n.status, price: n.price || "TBA",
      releaseDate: n.releaseDate || null, releaseWindow: n.releaseDate ? null : (n.releaseWindow || "TBA"),
      preordersOpened: n.preordersOpened || null, searchQuery: n.searchQuery || n.name,
      image: null, imageCredit: null,
      art: { type: n.artType, colors: n.artColors },
      notes: n.notes, inTheBox: n.inTheBox || [],
      stores: [...new Set(n.stores)].map(store => ({ store, listed: n.status !== "rumor" && n.status !== "announced", affiliateUrl: null })),
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
