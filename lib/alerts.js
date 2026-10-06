// Works out which alert emails a change to data/releases.json should send.
// Pure functions: no network, so it's easy to test.
//
// Subscribers pick alerts with Buttondown tags:
//   type:<category>  e.g. type:nintendo   (everything in that category)
//   item:<id>        e.g. item:switch-2-zelda-40th   (one release)
//
// Who hears about what:
//   - A new release goes to its type.
//   - A big change (status, release date, preorders opening) goes to the item and its type.
//   - A smaller change (price, a new timeline entry) goes to the item only.

export const typeTag = cat => `type:${cat}`;
export const itemTag = id => `item:${id}`;

const longDate = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const whenText = i => i.releaseDate ? longDate(i.releaseDate) : (i.releaseWindow || "TBA");

// What one release changed, as plain sentences. major = worth telling the whole type.
export function changesFor(before, after, statuses) {
  const lines = [];
  let major = false;
  if (before.status !== after.status) {
    major = true;
    lines.push(`Status: ${statuses[before.status] || before.status} → ${statuses[after.status] || after.status}.`);
  }
  if ((before.releaseDate || null) !== (after.releaseDate || null) || (!after.releaseDate && (before.releaseWindow || null) !== (after.releaseWindow || null))) {
    major = true;
    lines.push(`Release: ${whenText(before)} → ${whenText(after)}.`);
  }
  if (!before.preordersOpened && after.preordersOpened && before.status === after.status) {
    major = true;
    lines.push(`Preorders opened ${longDate(after.preordersOpened)}.`);
  }
  if (before.price !== after.price) lines.push(`Price: ${before.price} → ${after.price}.`);
  const seen = new Set((before.timeline || []).map(t => t.date + "|" + t.text));
  const fresh = (after.timeline || []).filter(t => !seen.has(t.date + "|" + t.text)).sort((a, b) => b.date.localeCompare(a.date));
  for (const t of fresh) lines.push(`${longDate(t.date)}: ${t.text}`);
  return { major, lines };
}

function subjectFor(kind, after, statuses) {
  if (kind === "new") return `New: ${after.name}`;
  if (kind === "status") {
    const s = { preorder: "Preorders open", out: "Out now", soldout: "Sold out", announced: "Announced" }[after.status];
    return `${s || statuses[after.status]}: ${after.name}`;
  }
  return `Update: ${after.name}`;
}

// oldData / newData: parsed releases.json. Returns one alert per release that changed.
export function planAlerts(oldData, newData, siteUrl) {
  const SITE = siteUrl.replace(/\/$/, "");
  const statuses = newData.statuses;
  const before = new Map((oldData?.items || []).map(i => [i.id, i]));
  const alerts = [];
  for (const it of newData.items) {
    const prev = before.get(it.id);
    const url = `${SITE}/${it.id}/`;
    const facts = [`**Price:** ${it.price}`, `**Release:** ${whenText(it)}`, `**Status:** ${statuses[it.status] || it.status}`];
    if (!prev) {
      if (it.status === "rumor") continue; // rumors wait until they're announced
      alerts.push({ id: it.id, name: it.name, category: it.category, kind: "new",
        tags: [typeTag(it.category)], subject: subjectFor("new", it, statuses),
        lines: [it.notes?.[0] || ""].filter(Boolean), facts, url });
      continue;
    }
    const { major, lines } = changesFor(prev, it, statuses);
    if (!lines.length) continue;
    // A rumor becoming announced is news for the whole type; other rumor tweaks only reach the item.
    const kind = prev.status !== it.status ? "status" : "update";
    alerts.push({ id: it.id, name: it.name, category: it.category, kind,
      tags: major ? [itemTag(it.id), typeTag(it.category)] : [itemTag(it.id)],
      subject: subjectFor(kind, it, statuses), lines, facts, url });
  }
  return groupNew(alerts, newData.categories);
}

// Several new releases in one category become one email instead of one each.
function groupNew(alerts, categories) {
  const out = [], byCat = new Map();
  for (const a of alerts) {
    if (a.kind !== "new") { out.push(a); continue; }
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }
  for (const [cat, list] of byCat) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const names = list.map(a => a.name);
    out.push({ id: list.map(a => a.id).join("+"), name: `${list.length} new ${categories[cat]} releases`, category: cat,
      kind: "new", tags: list[0].tags, items: list,
      subject: `${list.length} new ${categories[cat]}: ${names.slice(0, 2).join(", ")}${names.length > 2 ? " and more" : ""}` });
  }
  return out;
}

// The email body (Buttondown takes Markdown).
export function emailBody(alert, categories) {
  const why = alert.tags.length > 1
    ? `You're getting this because you asked for alerts on this release or on ${categories[alert.category]}.`
    : alert.kind === "new"
      ? `You're getting this because you asked for ${categories[alert.category]} alerts.`
      : `You're getting this because you asked for alerts on this release.`;
  if (alert.items) return [
    ...alert.items.flatMap(a => [`## [${a.name}](${a.url})`, "", ...a.lines, "", a.facts.join("  \n"), ""]),
    `<small>${why} You can change your alert picks from the link at the bottom of this email.</small>`
  ].join("\n");
  return [
    `## [${alert.name}](${alert.url})`,
    "",
    ...alert.lines.map(l => `- ${l}`),
    "",
    alert.facts.join("  \n"),
    "",
    `[See prices and where to buy →](${alert.url})`,
    "",
    `<small>${why} You can change your alert picks from the link at the bottom of this email.</small>`
  ].join("\n");
}

// ---------- weekly roundup ----------
// Subscribers who keep the "Weekly roundup" box ticked carry this tag. Anyone without it
// only gets the alerts they picked.
export const ROUNDUP_TAG = "roundup";

// One email listing everything that changed this week, new releases first.
export function roundupEmail(alerts, categories) {
  const entries = alerts.flatMap(a => a.items || [a]);
  const fresh = entries.filter(e => e.kind === "new"), changed = entries.filter(e => e.kind !== "new");
  const block = e => [
    `### [${e.name}](${e.url})`,
    "",
    ...(e.kind === "new" ? e.lines : e.lines.map(l => `- ${l}`)),
    "",
    e.facts.join("  \n"),
    ""
  ];
  const count = [fresh.length && `${fresh.length} new`, changed.length && `${changed.length} updated`].filter(Boolean).join(", ");
  const subject = `This week on Edition Tracker: ${count}`;
  const body = [
    `Here's everything that changed on [editiontracker.com](https://editiontracker.com) this week.`,
    "",
    ...(fresh.length ? ["## New releases", "", ...fresh.flatMap(block)] : []),
    ...(changed.length ? ["## Updates", "", ...changed.flatMap(block)] : []),
    `<small>You're getting the weekly roundup because you ticked it when you signed up. To stop it and only get the alerts you picked, use the manage link at the bottom of this email.</small>`
  ].join("\n");
  return { subject, body, count: entries.length };
}
