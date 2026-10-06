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
