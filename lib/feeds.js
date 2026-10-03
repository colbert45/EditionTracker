// Small, dependency-free helpers for reading RSS/Atom feeds politely.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function decode(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}
export const stripHtml = s => decode(decode(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};

// Returns [{ title, link, published (ISO or null), summary }]
export function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = stripHtml(tag(b, "title"));
    let link = decode(tag(b, "link")).trim();
    if (!link) {
      const alt = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) || b.match(/<link\b[^>]*>/i);
      const href = alt && alt[0].match(/href=["']([^"']+)["']/i);
      link = href ? decode(href[1]) : "";
    }
    if (!link) link = decode(tag(b, "guid")).trim();
    const date = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const t = Date.parse(decode(date).trim());
    const summary = stripHtml(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400);
    if (title && /^https?:\/\//.test(link)) out.push({ title, link, published: Number.isNaN(t) ? null : new Date(t).toISOString(), summary });
  }
  return out;
}

// robots.txt: is `path` allowed for our user agent? Longest matching rule wins, Allow beats Disallow on ties.
export function robotsAllows(robotsTxt, userAgent, path) {
  const token = userAgent.split("/")[0].toLowerCase();
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    const k = key.toLowerCase();
    if (k === "user-agent") {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: value });
    }
  }
  const mine = groups.filter(g => g.agents.some(a => a !== "*" && token.includes(a)));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes("*"))).flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue; // "Disallow:" with nothing means allow all
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

export function matchesKeywords(text, keywords) {
  const t = text.toLowerCase();
  return keywords.some(k => t.includes(k.toLowerCase()));
}
