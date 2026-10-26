// Watching a restock account on X (config/x-watch.json, Wario64 to start), as plain functions so the tests can
// check every case without the network. The news check asks X's search for that account's new posts that name
// something on the list (Zelda and so on) and say it's in stock, and treats each one like a headline: the AI reads
// them, and a real restock ends up in the pull request for review. X charges for every post it sends back, so the
// search only asks for matching posts, only for ones newer than the last it saw, and stops at a cap (100 posts in 10 days).
import { createHmac, randomBytes } from "node:crypto";

export const X_SEARCH = "https://api.x.com/2/tweets/search/recent";

// Words that mean "you can buy it now". The search only returns posts with one of these and one of the topics.
const STOCK_WORDS = ['"in stock"', "restock", "restocked", '"back in stock"', "available", "live", "preorder", '"pre-order"', '"pre-orders"', "preorders", "drop"];

const quoteWord = w => /^[a-z0-9]+$/i.test(w) ? w : `"${w.replace(/"/g, "")}"`;

// from:Wario64 (zelda OR ocarina ...) ("in stock" OR restock ...) -is:retweet
export function searchQuery(cfg) {
  const account = String(cfg.account || "").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(account)) throw new Error(`"${cfg.account}" isn't an X username`);
  const topics = (cfg.keywords || []).map(k => String(k).trim()).filter(Boolean).map(quoteWord);
  if (!topics.length) throw new Error("x-watch.json lists no keywords");
  return `from:${account} (${topics.join(" OR ")}) (${STOCK_WORDS.join(" OR ")}) -is:retweet`;
}

// The search's address: only posts after the last one seen (since_id), or on the first run only the last few hours,
// so turning this on doesn't read (and pay for) days of old posts.
export function searchUrl(cfg, { sinceId, now = new Date(), firstHours = 3 } = {}) {
  const p = new URLSearchParams({ query: searchQuery(cfg), max_results: String(Math.min(Math.max(cfg.maxResults || 25, 10), 100)),
    "tweet.fields": "created_at,entities,note_tweet" });
  if (sinceId && /^\d+$/.test(String(sinceId))) p.set("since_id", String(sinceId));
  else p.set("start_time", new Date(now.getTime() - firstHours * 3600000).toISOString().replace(/\.\d{3}Z$/, "Z"));
  return `${X_SEARCH}?${p}`;
}

// Deal accounts link through affiliate redirects (goto.walmart.com/c/...?u=<the real page>). The real page is the one
// worth keeping, and it's the only kind the site would ever link: these go to the address in the redirect, if any.
export function unwrapLink(raw) {
  let link = String(raw || "");
  for (let i = 0; i < 3; i++) {
    let u;
    try { u = new URL(link); } catch { return link; }
    const inner = ["u", "url", "murl", "dest", "destination", "redirect", "redirect_url"].map(k => u.searchParams.get(k)).find(v => /^https?:\/\//i.test(v || ""));
    if (!inner) return link;
    link = inner;
  }
  return link;
}

// X's answer -> headlines the news check can use: the post's text, the real store links in it, and the post itself as the source.
export function postsToHeadlines(json, account) {
  const handle = String(account || "").replace(/^@/, "");
  return (Array.isArray(json?.data) ? json.data : []).filter(t => /^\d+$/.test(String(t?.id))).map(t => {
    const text = String(t.note_tweet?.text || t.text || "");
    const links = (t.entities?.urls || []).map(u => unwrapLink(u.unwound_url || u.expanded_url || u.url)).filter(Boolean);
    return {
      title: text.replace(/https:\/\/t\.co\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 280),
      link: `https://x.com/${handle}/status/${t.id}`,
      sourceName: `${handle} on X`,
      summary: [...new Set(links)].join(" "),
      published: t.created_at || null
    };
  });
}

// OAuth 1.0a for a request with a query string: the query's parameters are signed along with the oauth ones.
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export function oauthHeader(method, url, creds, { nonce = randomBytes(16).toString("hex"), timestamp = String(Math.floor(Date.now() / 1000)), body = {} } = {}) {
  const u = new URL(url);
  const o = { oauth_consumer_key: creds.key, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: timestamp, oauth_token: creds.token, oauth_version: "1.0" };
  const all = [...u.searchParams.entries(), ...Object.entries(body), ...Object.entries(o)].map(([k, v]) => [enc(k), enc(v)]);
  all.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(all.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  o.oauth_signature = createHmac("sha1", `${enc(creds.secret)}&${enc(creds.tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(o).sort().map(k => `${enc(k)}="${enc(o[k])}"`).join(", ");
}
