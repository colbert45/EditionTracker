// Works out which social posts a change to data/releases.json should make.
// Pure functions: no network, so it's easy to test. Posts are built from the data
// with fixed wording (no AI), one per release, and only for news worth a post:
// a new release, or a big change (status, release date, preorders opening).
// Each post has `text` (ends with the link, for Bluesky) and `xText` (no link, for X: see xpost.js).
import { planAlerts } from "./alerts.js";
import { discordEscape } from "./discord.js";
import { xTextFor, xTags, forX, fitX, spokenHost } from "./xpost.js";

export const MAX_LENGTH = 280; // X's limit; Bluesky allows 300

const longDate = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

function whenLine(i) {
  if (i.status === "out") return i.releaseDate ? `Out now (${longDate(i.releaseDate)})` : "Out now";
  if (i.releaseDate) return `Out ${longDate(i.releaseDate)}`;
  return i.releaseWindow && i.releaseWindow !== "TBA" ? `Expected ${i.releaseWindow}` : "Release date TBA";
}

const HEADS = { preorder: "Preorders open", out: "Out now", soldout: "Sold out", announced: "Announced" };

// Stock news in a timeline update is worth a post even though other small updates aren't.
export const STOCK_NEWS = /\b(restock(s|ed|ing)?|back in stock|in stock again|available again|(extra|additional|more|new) (units|stock|consoles|controllers|inventory)|stock drop|another drop|(second|next|new) wave)\b/i;

function postFor(entry, it, url, stockLine = "", siteUrl = "") {
  let head;
  if (stockLine) head = `Stock news: ${it.name}`;
  else if (entry.kind === "new") head = it.status === "preorder" ? `New, preorders open: ${it.name}` : `New: ${it.name}`;
  else if (entry.kind === "status" && HEADS[it.status]) head = `${HEADS[it.status]}: ${it.name}`;
  else head = `Update: ${it.name}`;
  const detail = [it.platform, it.price !== "TBA" && it.price, it.status === "out" && entry.kind === "status" ? null : whenLine(it)].filter(Boolean).join(" · ");
  // Timeline lines look like "Oct 9, 2026: text"; the date is redundant in a post.
  const extra = stockLine ? stockLine.replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4}: /, "")
    : entry.kind === "update" && entry.lines[0] ? entry.lines[0] : "";
  const lines = [head, detail, extra].filter(Boolean);
  let text = `${lines.join("\n")}\n${url}`;
  // Too long: drop the extra line, then shorten the headline.
  if (text.length > MAX_LENGTH && extra) text = `${head}\n${detail}\n${url}`;
  if (text.length > MAX_LENGTH) {
    const room = MAX_LENGTH - (text.length - head.length) - 1;
    text = `${head.slice(0, Math.max(10, room)).trimEnd()}…\n${detail}\n${url}`;
  }
  const post = { id: it.id, text, url, title: it.name, description: detail, image: it.image || null };
  return { ...post, xText: xTextFor(post, siteUrl || url, { call: "Details", tags: xTags(it) }) };
}

const listNames = names => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// A restock gets its own post: Bluesky and Discord (and X only if the config says so).
// `discord` is the longer Discord version, with a link for each store. Store links are wrapped in <> so
// Discord doesn't unfurl them, which leaves the release page's picture as the one preview.
function restockPostFor(a, it, siteUrl) {
  const stores = listNames([...new Set(a.restocks.map(r => r.retailer))]);
  const head = `${a.allReported ? "Reported back in stock" : "Back in stock"}: ${it.name} at ${stores}`;
  const detail = [a.msrp ? `MSRP ${a.msrp}. Don't pay more.` : "Buy from the store itself.", a.allReported ? "It may already be gone." : ""].filter(Boolean).join(" ");
  let text = `${head}\n${detail}\n${a.url}`;
  if (text.length > MAX_LENGTH) {
    const room = MAX_LENGTH - (text.length - head.length) - 1;
    text = `${head.slice(0, Math.max(10, room)).trimEnd()}…\n${detail}\n${a.url}`;
  }
  const lines = a.restocks.map(r => r.reported
    ? `${discordEscape(r.retailer)}, reported${r.source ? ` per ${hostOf(r.source)}` : ""}: <${r.url}>`
    : `${discordEscape(r.retailer)}: <${r.url}>`);
  const discord = [`**${discordEscape(head)}**`, detail, ...lines, a.url].join("\n");
  const post = { id: it.id, text, url: a.url, title: it.name, description: detail, image: it.image || null, restock: true, discord };
  return { ...post, xText: xTextFor(post, siteUrl, { call: "Store links", tags: xTags(it) }) };
}

// `opts.today` works as it does for planAlerts: a news report that has gone stale isn't posted.
export function socialPosts(oldData, newData, siteUrl, opts = {}) {
  const byId = new Map(newData.items.map(i => [i.id, i]));
  const posts = [];
  for (const a of planAlerts(oldData, newData, siteUrl, opts)) {
    for (const e of a.items || [a]) {
      const it = byId.get(e.id);
      if (!it) continue;
      if (e.kind === "restock") { posts.push(restockPostFor(e, it, siteUrl)); continue; }
      // Other changes to a release that's back in stock (a status flip made by hand, say) aren't posted.
      if (it.status === "restock") continue;
      const major = e.kind === "new" || e.tags.length > 1;
      const stockLine = major ? "" : (e.lines || []).find(l => STOCK_NEWS.test(l)) || "";
      if (major || stockLine) posts.push(postFor(e, it, e.url, stockLine, siteUrl));
    }
  }
  return posts;
}

// ---------- scheduled posts (no merge needed) ----------
const shortDate = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const SITE_OF = siteUrl => siteUrl.replace(/\/$/, "");

// Release day: one post per release whose date is today (rumors excluded).
export function outTodayPosts(data, today, siteUrl) {
  return data.items
    .filter(i => i.releaseDate === today && i.status !== "rumor")
    .map(i => {
      const url = `${SITE_OF(siteUrl)}/${i.id}/`;
      const detail = [i.platform, i.price !== "TBA" && i.price, i.status === "soldout" && "Sold out at launch"].filter(Boolean).join(" · ");
      let head = `Out today: ${i.name}`;
      const room = MAX_LENGTH - detail.length - url.length - 2;
      if (head.length > room) head = head.slice(0, room - 1).trimEnd() + "…";
      const post = { id: i.id, text: `${head}\n${detail}\n${url}`, url, title: i.name, description: detail, image: i.image || null };
      return { ...post, xText: xTextFor(post, siteUrl, { call: "Details", tags: xTags(i) }) };
    });
}

// Thursdays: the releases coming out in the next 7 days, linking the calendar.
export function weekAheadPost(data, today, siteUrl) {
  const end = addDays(today, 6);
  const list = data.items
    .filter(i => i.releaseDate && i.releaseDate >= today && i.releaseDate <= end && i.status !== "rumor")
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name));
  if (!list.length) return null;
  const url = `${SITE_OF(siteUrl)}/calendar/`;
  const head = "Coming out this week:";
  const lines = list.map(i => `• ${shortDate(i.releaseDate)}: ${i.name.length > 60 ? i.name.slice(0, 59).trimEnd() + "…" : i.name}`);
  let shown = lines.length;
  const build = n => [head, ...lines.slice(0, n), n < lines.length ? `+ ${lines.length - n} more` : null, url].filter(Boolean).join("\n");
  while (shown > 1 && build(shown).length > MAX_LENGTH) shown--;
  const text = build(shown);
  // The X version keeps its "Full calendar" line by listing fewer releases if it has to.
  const calls = [`Full calendar: ${spokenHost(siteUrl)}`, "#SpecialEdition"];
  const xLines = lines.map(l => forX(l, siteUrl));
  const xBody = n => [head, ...xLines.slice(0, n), n < xLines.length ? `+ ${xLines.length - n} more` : null].filter(Boolean).join("\n");
  let xShown = xLines.length;
  while (xShown > 1 && fitX(xBody(xShown), calls) !== [xBody(xShown), ...calls].join("\n")) xShown--;
  return { id: `week-${today}`, text, url, title: "Release calendar", description: `${list.length} special edition release${list.length === 1 ? "" : "s"} this week`, image: null,
    xText: fitX(xBody(xShown), calls) };
}
