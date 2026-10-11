// What the "Post a restock" and "Sold out again" actions do to data/releases.json.
// Pure functions (no network, no files), so they're easy to test. They turn what you type on
// your phone ("zelda", "best buy", a link) into one exact edit, or say in plain words why not.
import { dropTracking, isAmazonHost } from "./links.js";

export class InputError extends Error {}

const clone = o => JSON.parse(JSON.stringify(o));
const normalize = s => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const squash = s => normalize(s).replace(/ /g, "");
const shown = s => String(s ?? "").trim();

// ---------- which release ----------
// Matches the id, the full name, or any part of the name ("zelda 40th"). Never guesses between two.
export function resolveItem(data, query) {
  const q = normalize(query);
  if (!q) throw new InputError("Type the release's name, or its id (the last part of its page address).");
  const exact = data.items.filter(i => normalize(i.id) === q || normalize(i.name) === q);
  const hits = exact.length ? exact : data.items.filter(i => {
    const hay = normalize(`${i.name} ${i.id}`);
    return q.split(" ").every(t => hay.includes(t));
  });
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new InputError(`No release matches "${shown(query)}". Try its id, the last part of its page address, like switch-2-zelda-40th.`);
  throw new InputError(`More than one release matches "${shown(query)}". Use the id of the one you mean:\n` +
    hits.slice(0, 10).map(i => `  ${i.id}  (${i.name})`).join("\n"));
}

// ---------- which store ----------
// Matches the store's key or name, with or without spaces ("best buy", "bestbuy", "bestbuy.com").
export function resolveStore(data, query) {
  const q = squash(query);
  if (!q) throw new InputError("Type the store's name, like Best Buy or Target.");
  const all = Object.entries(data.stores);
  let hits = all.filter(([k, s]) => squash(k) === q || squash(s.name) === q);
  if (!hits.length && q.length >= 3) {
    hits = all.filter(([k, s]) => [squash(k), squash(s.name)].some(n => n.includes(q) || (n.length >= 4 && q.includes(n))));
  }
  if (hits.length === 1) return { key: hits[0][0], store: hits[0][1] };
  const names = all.map(([, s]) => s.name).join(", ");
  if (!hits.length) throw new InputError(`No store matches "${shown(query)}". Stores on the site: ${names}.`);
  throw new InputError(`More than one store matches "${shown(query)}": ${hits.map(([, s]) => s.name).join(", ")}. Type more of the name.`);
}

// ---------- links ----------
// Share buttons add tracking and affiliate tags. They're dropped so the site never passes one on.
const bareHost = u => u.hostname.replace(/^www\./, "").toLowerCase();
const count = (s, c) => s.split(c).length - 1;

// A link pasted from a share sheet can come wrapped in quotes or brackets, or with a full stop after it.
// Those are dropped, but a closing bracket that has an opening one stays: Nintendo_(company)
function trimEnd(link) {
  let s = link;
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:!?'"\u2019\u201d]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      if (s.endsWith(close) && count(s, close) > count(s, open)) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

// A pasted link, made safe to publish: a full https address with the tracking tags removed.
// A share sheet often pastes a sentence with the link inside it, so the link is picked out.
export function cleanLink(raw, label = "The link") {
  const text = shown(raw);
  if (!text) throw new InputError(`${label} is empty. Paste the address of the page.`);
  const found = text.match(/https?:\/\/[^\s"<>\u201c\u201d\u2018\u2019\u00ab\u00bb]+/i);
  const candidate = trimEnd(found ? found[0] : text);
  let u;
  try { u = new URL(candidate); } catch { throw new InputError(`${label} isn't a full web address. Paste the whole thing, starting with https://`); }
  if (u.protocol !== "https:") throw new InputError(`${label} has to start with https://`);
  if (u.username || u.password) throw new InputError(`${label} has a username or password in it. Paste the plain address.`);
  if (u.port) throw new InputError(`${label} has a port number in it. Paste the plain address of the page.`);
  if (isAmazonHost(u.hostname)) throw new InputError(`${label} goes to Amazon. This site doesn't link there.`);
  dropTracking(u);
  u.hash = "";
  if (u.href.length > 1500) throw new InputError(`${label} is very long. Paste the plain product page address.`);
  return u.href;
}

// The websites a store sells from: its own site, its search page's site, and any extra `domains`.
export function storeHosts(store) {
  const hosts = new Set();
  for (const link of [store.url, store.searchUrl]) {
    try { if (link) hosts.add(bareHost(new URL(link))); } catch { /* skipped */ }
  }
  for (const d of store.domains || []) hosts.add(String(d).toLowerCase().replace(/^www\./, ""));
  return [...hosts];
}

// The link to the store's own product page. It has to be on the store's website, so a
// reseller's listing or a shortened link can't end up in front of readers as "the store has it".
export function listingLink(store, raw) {
  const link = cleanLink(raw, "The link");
  const u = new URL(link);
  const host = bareHost(u);
  const allowed = storeHosts(store);
  if (!allowed.some(d => host === d || host.endsWith("." + d)))
    throw new InputError(`The link goes to ${host}, but ${store.name} sells from ${allowed.join(" or ")}. Paste the store's own product page. ` +
      `(If ${store.name} really sells from ${host}, add it to that store's "domains" in data/releases.json first.)`);
  if (u.pathname === "/" || u.pathname === "")
    throw new InputError(`The link is ${store.name}'s home page. Paste the link to the product page.`);
  return link;
}

// The store a link belongs to, for when the Store box is left blank.
export function storeFromLink(data, link) {
  const host = bareHost(new URL(link));
  const hits = Object.entries(data.stores).filter(([, s]) => storeHosts(s).some(d => host === d || host.endsWith("." + d)));
  if (hits.length === 1) return { key: hits[0][0], store: hits[0][1] };
  if (!hits.length) throw new InputError(`I can't tell which store ${host} is. Type the store's name in the Store box.`);
  throw new InputError(`${host} could be ${hits.map(([, s]) => s.name).join(" or ")}. Type the store's name in the Store box.`);
}

// ---------- the edits ----------
export const STOCKABLE = new Set(["preorder", "out", "soldout", "restock"]);

const notStockable = it => new InputError(`${it.name} is still marked "${it.status}", so there's nothing to restock yet.`);

// Logs a restock on a release and switches it to "Back in stock".
//   { item, retailer, link, source, today } -> { data, item, store, entry, changed, note, message }
// Several mistakes are reported together, so a typo on a phone costs one retry, not three.
export function applyRestock(data, { item: itemQuery, retailer, link, source, today }) {
  const next = clone(data);
  const problems = [];
  const attempt = fn => {
    try { return fn(); } catch (e) { if (e instanceof InputError) { problems.push(e.message); return undefined; } throw e; }
  };
  const it = attempt(() => {
    const found = resolveItem(next, itemQuery);
    if (!STOCKABLE.has(found.status)) throw notStockable(found);
    return found;
  });
  const store = attempt(() => shown(retailer) ? resolveStore(next, retailer) : storeFromLink(next, cleanLink(link)));
  const url = store && attempt(() => listingLink(store.store, link));
  const src = shown(source) ? attempt(() => cleanLink(source, "The source link")) : null;
  if (problems.length) throw new InputError(problems.join("\n"));

  const entry = { date: today, store: store.key, url, source: src === url ? null : src };
  const base = { data: next, item: it, store: store.store, entry };
  // A second restock at the same store on the same day is a double tap (the same page can be pasted
  // a dozen ways), unless the release was marked sold out in between.
  if (it.status === "restock" && (it.restocks || []).some(r => r.date === entry.date && r.store === entry.store))
    return { ...base, data, changed: false,
      note: `That restock is already logged (${store.store.name}, ${today}), so nothing changed. If it sold out and came back, run Sold out again first. If its email didn't go out, run Resend restock email.` };
  it.restocks = [...(it.restocks || []), entry];
  it.status = "restock";
  next.updated = today;
  return { ...base, changed: true, message: restockMessage({ item: it, store: store.store, entry }) };
}

// Switches a release back to "Sold out". Nothing is emailed for it.
export function applySoldOut(data, { item: itemQuery, today }) {
  const next = clone(data);
  const it = resolveItem(next, itemQuery);
  if (!STOCKABLE.has(it.status)) throw notStockable(it);
  if (it.status === "soldout") return { data, item: it, changed: false, note: `${it.name} already shows Sold out, so nothing changed.` };
  it.status = "soldout";
  next.updated = today;
  return { data: next, item: it, changed: true, message: `Sold out again: ${it.name} [no alerts]` };
}

export const restockMessage = ({ item, store, entry }) => [
  `Back in stock: ${item.name} at ${store.name}`,
  "",
  `Listing: ${entry.url}`,
  ...(entry.source ? [`Source: ${entry.source}`] : [])
].join("\n");
