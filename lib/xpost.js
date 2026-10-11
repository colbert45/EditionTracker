// How a post is written for X.
//
// X's API charges $0.20 for a post that has a link in it and about 1.5 cents for one that doesn't, so nothing sent to
// X has a link. X also turns anything that looks like a web address into a link, even without "https://", so the site
// is written out ("editiontracker dot com") and any other address in the text is taken out or written the same way.
// A couple of hashtags from the release's category and platform help people find the post instead.
// Pure functions: no network, so the tests can check every word.

export const X_LIMIT = 280;

// X counts most characters as 1, and emoji, arrows, bullets, the ellipsis and some alphabets as 2.
const weight = cp => (cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247)) ? 1 : 2;
export function xLength(text) {
  let n = 0;
  for (const c of String(text ?? "").normalize("NFC")) n += weight(c.codePointAt(0));
  return n;
}

const ownHost = siteUrl => { try { return new URL(siteUrl).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; } };

// "https://www.editiontracker.com" -> "editiontracker dot com"
export function spokenHost(siteUrl) {
  const host = ownHost(siteUrl);
  return host ? host.replace(/\./g, " dot ") : "our website";
}

// Common endings that X links whatever the capitals ("GameStop.Com"), unlike a missing space ("sold out.Check").
const COMMON_TLDS = new Set(["com", "net", "org", "edu", "gov", "io", "co", "gg", "tv", "me", "app", "dev", "xyz", "info", "biz", "us", "uk", "ca", "de", "fr", "jp", "it", "es", "nl", "au", "ly", "ai"]);
const SCHEME_URL = /\b(?:https?|ftp):\/\/[^\s<>"'“”]+/gi;
const BARE_DOMAIN = /(?<![\w.@-])(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}(?![\w-])(?::\d+)?(?:\/[^\s]*)?/gi;
const hostOf = s => s.replace(/^[a-z]+:\/\//i, "").split(/[\/:?#]/)[0].replace(/^www\./i, "").toLowerCase();

// Text with every web address taken out. This site's own address is written out in words; any other address is
// dropped (a full link) or has its dots spelled out (a bare "gamestop.com"). Safe to run twice.
export function forX(text, siteUrl) {
  const own = ownHost(siteUrl), spoken = spokenHost(siteUrl);
  const isOwn = host => Boolean(own) && (host === own || host.endsWith("." + own));
  return String(text ?? "")
    .replace(SCHEME_URL, m => {
      const tail = (m.match(/[.,;:!?)\]}]+$/) || [""])[0]; // punctuation that belongs to the sentence, not the address
      return (isOwn(hostOf(tail ? m.slice(0, -tail.length) : m)) ? spoken : "") + tail;
    })
    .replace(BARE_DOMAIN, m => {
      const name = m.split(/[\/:]/)[0];
      const tld = name.split(".").pop();
      if (/[a-z]/.test(tld) && /[A-Z]/.test(tld) && !COMMON_TLDS.has(tld.toLowerCase())) return m; // "sold out.Check" is a missing space, not an address
      const tail = name.length < m.length ? (m.match(/[.,;:!?)\]}]+$/) || [""])[0] : ""; // end of the sentence, after a path
      return (isOwn(hostOf(m)) ? spoken : name.replace(/\./g, " dot ")) + tail;
    })
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Hashtags: the release's category, and its platform when it's exactly one of the well-known ones. Fixed wording,
// worked out from the data, never invented. A category or platform that isn't listed just gets no hashtag.
const CATEGORY_TAGS = { nintendo: "#Nintendo", playstation: "#PlayStation", xbox: "#Xbox", pc: "#PCGaming", games: "#Gaming", retro: "#RetroGaming", collect: "#Collectibles" };
const PLATFORM_TAGS = [[/\bswitch 2\b/i, "#Switch2"], [/\bps5\b/i, "#PS5"], [/\bxbox series\b/i, "#XboxSeriesX"]];
export function xTags(item) {
  const tags = [];
  if (CATEGORY_TAGS[item?.category]) tags.push(CATEGORY_TAGS[item.category]);
  const hits = PLATFORM_TAGS.filter(([re]) => re.test(item?.platform || ""));
  if (hits.length === 1) tags.push(hits[0][1]); // "PS5, Xbox Series X|S" is two platforms, so neither
  return [...new Set(tags)];
}

// The body, then as many of the extra lines as fit in 280 (the last ones go first, so the hashtags are dropped
// before the site's name). If even the body is too long, its first line is shortened, unless `shorten` is false
// (for a message typed by hand, which is reported as too long instead of being cut).
export function fitX(body, extras = [], { shorten = true } = {}) {
  const lines = extras.filter(Boolean);
  for (let k = lines.length; k >= 0; k--) {
    const text = [body, ...lines.slice(0, k)].filter(Boolean).join("\n");
    if (xLength(text) <= X_LIMIT) return text;
  }
  if (!shorten) return body;
  const [head, ...rest] = body.split("\n");
  const tail = rest.length ? "\n" + rest.join("\n") : "";
  const chars = [...head];
  while (chars.length > 10 && xLength(chars.join("") + "…" + tail) > X_LIMIT) chars.pop();
  return chars.join("").trimEnd() + "…" + tail;
}

// A post's text for X: the same words with its link (the last line) taken off, then where to find the details
// and the hashtags. `call` says what the site has ("Details", "Store links", "Full calendar"). When it's tight the
// hashtags go from the end one at a time, then the site's line, and only then is the body shortened.
export function xTextFor(post, siteUrl, { call = "Details", tags = [] } = {}) {
  const at = post.text.lastIndexOf(post.url);
  const body = forX(at > 0 ? post.text.slice(0, at) : post.text, siteUrl);
  const site = `${call}: ${spokenHost(siteUrl)}`;
  const options = [];
  for (let k = tags.length; k >= 1; k--) options.push([body, site, tags.slice(0, k).join(" ")]);
  options.push([body, site], [body]);
  for (const parts of options) {
    const text = parts.filter(Boolean).join("\n");
    if (xLength(text) <= X_LIMIT) return text;
  }
  return fitX(body, [site]);
}

// A message typed by hand (the "Post to social" action): links come out, and the site is named unless the text already does.
export function xCustom(text, siteUrl) {
  const body = forX(text, siteUrl);
  const site = spokenHost(siteUrl);
  return fitX(body, [body.toLowerCase().includes(site) ? "" : site], { shorten: false });
}
