// Releases whose announced preorder date has arrived. Pure function, no network:
// returns the edited data and what changed, for a pull request the editor merges.
const clone = o => JSON.parse(JSON.stringify(o));
const longDate = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

export function duePreorders(data, today) {
  const next = clone(data);
  const changed = [];
  for (const it of next.items) {
    if (it.status !== "announced" || !it.preordersStart || it.preordersStart > today) continue;
    it.status = "preorder";
    it.preordersOpened = it.preordersStart;
    const text = "Preorders opened.";
    if (!it.timeline.some(t => t.date === it.preordersStart && t.text === text)) it.timeline.push({ date: it.preordersStart, text });
    changed.push({ id: it.id, name: it.name, date: it.preordersStart });
  }
  if (changed.length) next.updated = today;
  return { data: next, changed };
}

export function duePreordersMarkdown(changed) {
  return [
    "These releases had a preorder date announced, and that date has arrived. Each one switches from **Announced** to **Preorders open**.",
    "",
    "**Check the store first** (preorders sometimes slip). If one didn't actually open, remove it here, or close this pull request.",
    "",
    "| Release | Preorders opened |",
    "|---|---|",
    ...changed.map(c => `| [${c.name}](https://editiontracker.com/${c.id}/) | ${longDate(c.date)} |`),
    "",
    "Merging emails subscribers who picked these releases (or their category) and posts to Bluesky and X."
  ].join("\n");
}
