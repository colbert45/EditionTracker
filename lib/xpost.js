// How a post is written for X.
//
// X's API charges $0.20 for a post that has a link in it and about 2 cents for one that doesn't, so nothing sent to
// X has a link. X also turns anything that looks like a web address into a link, even without "https://", so the site
// is written out ("editiontracker dot com") and any other address in the text is taken out or written the same way.
// A couple of hashtags from the release's category and platform help people find the post instead.
// Pure functions: no network, so the tests can check every word.

import { TLDS } from "./tlds.js";

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

const SCHEME_URL = /\b(?:https?|ftp):\/\/[^\s<>"'\u201c\u201d]+/gi;
// Like X's own address finder: a name made of letters, digits, marks, "_" and "-" (any alphabet), a dot, an ending of letters,
// and then anything but a letter or digit of the Latin alphabet, or "@". So "Walmart.com-exclusive", "my_store.example.com"
// and "gamestop.com" stuck to Japanese text all count. What comes before can be anything but a letter, a digit, a mark, "_" or
// "@": a dash or dots in front ("-gamestop.com", "stock...gamestop.com") don't hide it. An address after an "@" is an email
// address or a name, and is left alone.
const BARE_DOMAIN = /(?<![\p{L}\p{N}\p{M}_@])(?:[\p{L}\p{N}_](?:[\p{L}\p{N}\p{M}_-]*[\p{L}\p{N}\p{M}_])?\.)+(?:[a-z]{2,}(?![a-z0-9@])|\p{L}{2,}(?![\p{L}\p{N}\p{M}@]))(?::\d+)?(?:\/[^\s]*)?/giu;
// The ending at the start of a part of an address: the same two shapes the pattern above ends in.
const ENDING = /^(?:[a-z]{2,}(?![a-z0-9])|\p{L}{2,}(?![\p{L}\p{N}\p{M}]))/iu;
const hostOf = s => s.replace(/^[a-z]+:\/\//i, "").split(/[\/:?#]/)[0].replace(/^www\./i, "").toLowerCase();
// What can end an address: a real ending ("Store", "In"), or one in a single case ("shop", "SHOP", "рф") even if it isn't
// one yet. A capitalised word that isn't a real ending after a full stop ("sold out.Check", "Dr.Mario") is a missing space or a name.
const canEnd = t => TLDS.has(t.toLowerCase()) || !(/\p{Ll}/u.test(t) && /\p{Lu}/u.test(t));

// Replaces each address in `text` with what `fn` makes of it. A match that turns out not to be an address ("Dr.Mario/Luigi",
// where "Mario" is not an ending) is skipped, and the search goes on from the next character, so that an address inside what
// it swallowed (its "path") is still found.
function replaceAddresses(text, fn) {
  let out = "", at = 0;
  BARE_DOMAIN.lastIndex = 0;
  for (let m; (m = BARE_DOMAIN.exec(text));) {
    const now = fn(m[0]);
    if (now === null) { BARE_DOMAIN.lastIndex = m.index + 1; continue; }
    out += text.slice(at, m.index) + now;
    at = m.index + m[0].length;
  }
  return out + text.slice(at);
}

function pass(text, own, spoken) {
  const isOwn = host => Boolean(own) && (host === own || host.endsWith("." + own));
  const withoutLinks = text.replace(SCHEME_URL, m => {
    const tail = (m.match(/[.,;:!?)\]}]+$/) || [""])[0]; // punctuation that belongs to the sentence, not the address
    return (isOwn(hostOf(tail ? m.slice(0, -tail.length) : m)) ? spoken : "") + tail;
  });
  return replaceAddresses(withoutLinks, m => {
    const name = m.split(/[\/:]/)[0];
    const labels = name.split(".");
    // The longest start of it that ends the way an address does, which is how X reads it: "x.co.Check" is "x.co" and then
    // ".Check", and "sold out.Check" has none.
    for (let j = labels.length - 1; j >= 1; j--) {
      const end = labels[j].match(ENDING)?.[0];
      if (!end || !canEnd(end)) continue;
      const address = [...labels.slice(0, j), end].join(".");
      // The whole name with a path or port after it: the path goes too, but not the sentence's own punctuation at the end of it.
      const after = j === labels.length - 1 && name !== m ? (m.match(/[.,;:!?)\]}]+$/) || [""])[0] : m.slice(address.length);
      return (isOwn(hostOf(address)) ? spoken : address.replace(/\./g, " dot ")) + after;
    }
    return null;
  })
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Text with every web address taken out. This site's own address is written out in words; any other address is
// dropped (a full link) or has its dots spelled out (a bare "gamestop.com"). It repeats until nothing changes, because
// taking one address out can join the text on either side of it into a new one ("x.co:1x.co", or "gamestop.c(())om"
// once the empty brackets go). So running it again on its own result never changes it, which the length checks depend on.
// Every round that changes anything takes away a dot or a bracket or some spacing, so it always ends; the limit is only
// there so a mistake in the rules can't make it run forever.
export function forX(text, siteUrl) {
  const own = ownHost(siteUrl), spoken = spokenHost(siteUrl);
  let now = String(text ?? "");
  for (let rounds = now.length + 10; rounds > 0; rounds--) {
    const next = pass(now, own, spoken);
    if (next === now) break;
    now = next;
  }
  return now;
}

// What is actually sent to X for a post: its X version (or, failing that, the Bluesky text) with every address out,
// and never more than X accepts. Refusing here beats sending a post X would reject.
export function xBody(post, siteUrl) {
  const text = forX(post.xText ?? post.text, siteUrl);
  if (xLength(text) > X_LIMIT) throw new Error(`The X post is ${xLength(text)} characters long once its links are out (the limit is ${X_LIMIT}).`);
  return text;
}

// Hashtags, worked out from the release's own data and never invented: its franchise when the name has a well-known
// one, its category, its platform when it's exactly one of the well-known ones, and two that fit everything on the site.
// There can be five; when space is tight xTextFor drops them from the end, so the most specific ones last longest.
// A category, platform or franchise that isn't listed just gets no hashtag.
const FRANCHISE_TAGS = [[/zelda|ocarina|majora/i, "#Zelda"], [/pok[eé]mon/i, "#Pokemon"], [/\bgta\b|grand theft auto/i, "#GTAVI"], [/sonic/i, "#Sonic"],
  [/\blego\b/i, "#LEGO"], [/final fantasy/i, "#FinalFantasy"], [/star wars/i, "#StarWars"], [/assassin'?s creed/i, "#AssassinsCreed"], [/tomb raider/i, "#TombRaider"],
  [/wolverine/i, "#Wolverine"], [/god of war/i, "#GodOfWar"], [/gears of war/i, "#GearsOfWar"], [/gran turismo/i, "#GranTurismo"], [/amiibo/i, "#amiibo"]];
const CATEGORY_TAGS = { nintendo: "#Nintendo", playstation: "#PlayStation", xbox: "#Xbox", pc: "#PCGaming", games: "#Gaming", retro: "#RetroGaming", collect: "#Collectibles" };
const PLATFORM_TAGS = [[/\bswitch 2\b/i, "#Switch2"], [/\bps5\b/i, "#PS5"], [/\bxbox series\b/i, "#XboxSeriesX"]];
export function xTags(item) {
  if (!item) return [];
  const tags = [];
  const franchise = FRANCHISE_TAGS.find(([re]) => re.test(item.name || ""));
  if (franchise) tags.push(franchise[1]);
  if (CATEGORY_TAGS[item.category]) tags.push(CATEGORY_TAGS[item.category]);
  const hits = PLATFORM_TAGS.filter(([re]) => re.test(item.platform || ""));
  if (hits.length === 1) tags.push(hits[0][1]); // "PS5, Xbox Series X|S" is two platforms, so neither
  if (tags.length) tags.push("#SpecialEdition", "#GameCollecting");
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
