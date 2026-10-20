// Checks data/releases.json before anything is built or proposed.
// Errors stop the build (and fail the PR check). Warnings are printed but don't block.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ART_TYPES } from "./art.js";
import { dollars } from "./msrp.js";
import { isAmazonHost, paramNames, isAffiliateParam } from "./links.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
// Paths the site itself uses, so no release can take them.
const RESERVED_IDS = new Set(["assets", "fonts", "og", "images", "404", "sitemap", "robots", "favicon", "index"]);
// The design only has colors for these six.
const KNOWN_STATUSES = ["rumor", "announced", "preorder", "out", "soldout", "restock"];

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = v => typeof v === "string" && v.trim() !== "";
const isDate = v => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const isHttps = v => { try { return new URL(v).protocol === "https:"; } catch { return false; } };
const isMoney = v => typeof v === "string" && /^\$\d[\d,]*(\.\d{2})?$/.test(v.trim());
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
// This site has no affiliate links: a link that goes to Amazon or carries an affiliate tag is refused.
function linkProblem(v) {
  let u;
  try { u = new URL(v); } catch { return null; }
  if (isAmazonHost(u.hostname)) return "goes to Amazon, and this site doesn't link there";
  const tag = paramNames(v).find(isAffiliateParam);
  return tag ? `has an affiliate tag (${tag}), and this site has no affiliate links` : null;
}
const isHttpUrl = v => { try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

export function validate(data, { staticDir } = {}) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

  if (!isObj(data)) return { errors: ["releases.json must be a JSON object"], warnings };
  if (!isDate(data.updated)) err("updated", `must be a date like "2026-10-03"`);

  for (const key of ["categories", "types", "statuses", "stores"]) {
    if (!isObj(data[key])) err(key, "must be an object");
  }
  const cats = isObj(data.categories) ? data.categories : {};
  const types = isObj(data.types) ? data.types : {};
  const statuses = isObj(data.statuses) ? data.statuses : {};
  const stores = isObj(data.stores) ? data.stores : {};

  for (const [k, v] of Object.entries(cats)) if (!isStr(v)) err(`categories.${k}`, "needs a display name");
  for (const [k, v] of Object.entries(types)) if (!isStr(v)) err(`types.${k}`, "needs a display name");
  for (const [k, v] of Object.entries(statuses)) {
    if (!isStr(v)) err(`statuses.${k}`, "needs a display name");
    if (!KNOWN_STATUSES.includes(k)) err(`statuses.${k}`, `the design only has colors for ${KNOWN_STATUSES.join(", ")}`);
  }
  for (const [k, s] of Object.entries(stores)) {
    const where = `stores.${k}`;
    if (!isObj(s)) { err(where, "must be an object"); continue; }
    if (!isStr(s.name)) err(where, "needs a name");
    if (s.url == null && s.searchUrl == null) err(where, "needs either url or searchUrl");
    if (s.url != null && !isHttpUrl(s.url)) err(where, "url must be a full https:// link");
    if (s.searchUrl != null && !isHttpUrl(s.searchUrl)) err(where, "searchUrl must be a full https:// link");
    if (s.domains != null && (!Array.isArray(s.domains) || !s.domains.every(h => typeof h === "string" && HOSTNAME.test(h))))
      err(where, `domains must be a list of website names like ["microsoft.com"] (extra sites this store sells from)`);
  }

  if (!Array.isArray(data.items)) { err("items", "must be a list"); return { errors, warnings }; }
  if (data.featured != null) {
    if (!Array.isArray(data.featured)) err("featured", "must be a list of release ids");
    else data.featured.forEach(id => { if (!data.items.some(i => i.id === id)) err("featured", `"${id}" isn't a release id`); });
  }

  const seen = new Set();
  data.items.forEach((it, n) => {
    const where = `items[${n}]${it && isStr(it.id) ? ` (${it.id})` : ""}`;
    if (!isObj(it)) { err(where, "must be an object"); return; }

    if (!isStr(it.id) || !ID.test(it.id)) err(where, `id must be lowercase letters, numbers and dashes, like "switch-2-zelda-40th"`);
    else if (RESERVED_IDS.has(it.id)) err(where, `id "${it.id}" is reserved by the site, pick another`);
    else if (seen.has(it.id)) err(where, `id "${it.id}" is used twice`);
    seen.add(it.id);

    for (const f of ["name", "platform", "price", "searchQuery"]) if (!isStr(it[f])) err(where, `${f} is required`);
    if (!(it.category in cats)) err(where, `category must be one of: ${Object.keys(cats).join(", ")}`);
    if (!Object.hasOwn(types, it.type)) err(where, `type (what kind of thing it is) must be one of: ${Object.keys(types).join(", ")}`);
    if (it.brand !== undefined && !(isStr(it.brand) && it.brand.trim() === it.brand && it.brand.length <= 60))
      err(where, "brand (the company that makes it) must be a short name, or left out when it isn't known");
    if (!(it.status in statuses)) err(where, `status must be one of: ${Object.keys(statuses).join(", ")}`);

    if (it.releaseDate != null && !isDate(it.releaseDate)) err(where, `releaseDate must be null or a date like "2026-10-29"`);
    if (it.releaseWindow != null && !isStr(it.releaseWindow)) err(where, "releaseWindow must be null or text like \"Spring 2027\"");
    if (it.releaseDate == null && it.releaseWindow == null) warn(where, `no releaseDate or releaseWindow, "TBA" will be shown`);
    if (it.preordersOpened != null && !isDate(it.preordersOpened)) err(where, "preordersOpened must be null or a date");
    if (it.preordersStart != null && !isDate(it.preordersStart)) err(where, "preordersStart (the date preorders are announced to open) must be null or a date");

    if (it.image != null) {
      if (!isStr(it.image)) err(where, "image must be null, a full https:// link, or a path like /images/name.jpg");
      else if (it.image.startsWith("/")) {
        if (staticDir && !existsSync(join(staticDir, it.image))) err(where, `image ${it.image} not found, put the file in static${it.image}`);
      } else if (!isHttpUrl(it.image)) err(where, "image must be a full https:// link or a path starting with /");
      if (!isStr(it.imageCredit)) err(where, "imageCredit is required when there's an image (who took it / where it's from)");
    }

    if (!isObj(it.art)) err(where, "art is required (used whenever there's no image)");
    else {
      if (!ART_TYPES.includes(it.art.type)) err(where, `art.type must be one of: ${ART_TYPES.join(", ")}`);
      if (!Array.isArray(it.art.colors) || it.art.colors.length !== 3 || !it.art.colors.every(c => HEX.test(c)))
        err(where, `art.colors must be three colors like "#1F6B45"`);
    }

    if (!Array.isArray(it.notes) || !it.notes.length || !it.notes.every(isStr)) err(where, "notes must be a list with at least one paragraph");
    if (!Array.isArray(it.inTheBox) || !it.inTheBox.every(isStr)) err(where, "inTheBox must be a list (it can be empty: [])");

    if (!Array.isArray(it.stores)) err(where, "stores must be a list");
    else it.stores.forEach((s, j) => {
      const w = `${where} stores[${j}]`;
      if (!isObj(s)) { err(w, "must be an object"); return; }
      if (!(s.store in stores)) err(w, `store must be one of: ${Object.keys(stores).join(", ")}`);
      if (typeof s.listed !== "boolean") err(w, "listed must be true or false");
      if ("affiliateUrl" in s) err(w, "this site doesn't use affiliate links, so remove affiliateUrl");
    });

    if (it.msrp != null && !isMoney(it.msrp)) err(where, `msrp must be null or one price like "$519.99" (it only needs filling in when "price" isn't the MSRP)`);
    if (it.resale != null) {
      const w = `${where} resale`;
      const r = it.resale;
      if (!isObj(r)) err(w, `must look like { "low": "$800", "high": "$1,000", "checked": "2026-10-09" }`);
      else {
        if (!isMoney(r.low)) err(w, `low must be a price like "$800"`);
        if (r.high != null && !isMoney(r.high)) err(w, `high must be null or a price like "$1,000"`);
        else if (r.high != null && isMoney(r.low) && dollars(r.high) < dollars(r.low)) err(w, "high can't be lower than low");
        if (!isDate(r.checked)) err(w, `checked must be the date you looked at the listings, like "2026-10-09"`);
        if (r.where != null && (!isStr(r.where) || r.where.length > 40)) err(w, `where must be null or a short place name like "eBay"`);
      }
    }

    if (it.howToGet != null) {
      const w = `${where} howToGet`;
      const h = it.howToGet;
      if (!isObj(h)) err(w, `must look like { "where": "...", "limit": "...", "membership": "...", "tips": ["..."] }`);
      else {
        for (const k of Object.keys(h)) if (!["where", "limit", "membership", "tips"].includes(k)) err(w, `"${k}" isn't a field. Use where, limit, membership or tips`);
        // A blank field is just one that hasn't been filled in, so it's fine and nothing is shown for it.
        const blank = v => v == null || (typeof v === "string" && v.trim() === "");
        for (const k of ["where", "limit", "membership"]) {
          if (!blank(h[k]) && (typeof h[k] !== "string" || h[k].length > 400)) err(w, `${k} must be short text, under 400 characters`);
        }
        if (h.tips != null && (!Array.isArray(h.tips) || h.tips.length > 8 || !h.tips.every(t => blank(t) || (typeof t === "string" && t.length <= 250)))) err(w, "tips must be a list of up to 8 short sentences");
      }
    }

    if (it.restocks != null) {
      if (!Array.isArray(it.restocks)) err(where, "restocks must be a list");
      else it.restocks.forEach((r, j) => {
        const w = `${where} restocks[${j}]`;
        if (!isObj(r)) { err(w, "must be an object"); return; }
        if (!isDate(r.date)) err(w, `date must be a date like "2026-10-09"`);
        if (!(r.store in stores)) err(w, `store must be one of: ${Object.keys(stores).join(", ")}`);
        if (!isHttps(r.url)) err(w, "url must be the store's own listing, a full https:// link");
        if (r.source != null && !isHttps(r.source)) err(w, "source must be null or a full https:// link");
        if (r.reported != null && typeof r.reported !== "boolean") err(w, "reported must be true or false");
        if (r.reported === true && r.source == null) err(w, "a reported restock needs a source: the link where it was reported");
        for (const f of ["url", "source"]) {
          const problem = isHttps(r[f]) && linkProblem(r[f]);
          if (problem) err(w, `${f} ${problem}`);
        }
      });
    }
    if (it.status === "restock" && !(Array.isArray(it.restocks) && it.restocks.length)) warn(where, `status is "Back in stock" but there's no restock logged`);

    if (!Array.isArray(it.timeline)) err(where, "timeline must be a list (it can be empty: [])");
    else it.timeline.forEach((t, j) => {
      if (!isObj(t) || !isDate(t.date) || !isStr(t.text)) err(`${where} timeline[${j}]`, `needs a date like "2026-09-08" and text`);
    });

    if (!Array.isArray(it.sources) || !it.sources.length) err(where, "sources needs at least one link");
    else it.sources.forEach((s, j) => {
      if (!isObj(s) || !isStr(s.label) || !isHttpUrl(s.url)) err(`${where} sources[${j}]`, "needs a label and a full https:// url");
    });
  });

  return { errors, warnings };
}
