// Works out which social posts a change to data/releases.json should make.
// Pure functions: no network, so it's easy to test. Posts are built from the data
// with fixed wording (no AI), one per release, and only for news worth a post:
// a new release, or a big change (status, release date, preorders opening).
import { planAlerts } from "./alerts.js";

export const MAX_LENGTH = 280; // X's limit; Bluesky allows 300

const longDate = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

function whenLine(i) {
  if (i.status === "out") return i.releaseDate ? `Out now (${longDate(i.releaseDate)})` : "Out now";
  if (i.releaseDate) return `Out ${longDate(i.releaseDate)}`;
  return i.releaseWindow && i.releaseWindow !== "TBA" ? `Expected ${i.releaseWindow}` : "Release date TBA";
}

const HEADS = { preorder: "Preorders open", out: "Out now", soldout: "Sold out", announced: "Announced" };

function postFor(entry, it, url) {
  let head;
  if (entry.kind === "new") head = it.status === "preorder" ? `New, preorders open: ${it.name}` : `New: ${it.name}`;
  else if (entry.kind === "status" && HEADS[it.status]) head = `${HEADS[it.status]}: ${it.name}`;
  else head = `Update: ${it.name}`;
  const detail = [it.platform, it.price !== "TBA" && it.price, it.status === "out" && entry.kind === "status" ? null : whenLine(it)].filter(Boolean).join(" · ");
  const extra = entry.kind === "update" && entry.lines[0] ? entry.lines[0] : "";
  const lines = [head, detail, extra].filter(Boolean);
  let text = `${lines.join("\n")}\n${url}`;
  // Too long: drop the extra line, then shorten the headline.
  if (text.length > MAX_LENGTH && extra) text = `${head}\n${detail}\n${url}`;
  if (text.length > MAX_LENGTH) {
    const room = MAX_LENGTH - (text.length - head.length) - 1;
    text = `${head.slice(0, Math.max(10, room)).trimEnd()}…\n${detail}\n${url}`;
  }
  return { id: it.id, text, url, title: it.name, description: detail, image: it.image || null };
}

export function socialPosts(oldData, newData, siteUrl) {
  const byId = new Map(newData.items.map(i => [i.id, i]));
  const posts = [];
  for (const a of planAlerts(oldData, newData, siteUrl)) {
    for (const e of a.items || [a]) {
      const major = e.kind === "new" || e.tags.length > 1;
      const it = byId.get(e.id);
      if (major && it) posts.push(postFor(e, it, e.url));
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
      return { id: i.id, text: `${head}\n${detail}\n${url}`, url, title: i.name, description: detail, image: i.image || null };
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
  return { id: `week-${today}`, text, url, title: "Release calendar", description: `${list.length} special edition release${list.length === 1 ? "" : "s"} this week`, image: null };
}
