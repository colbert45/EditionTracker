import { test } from "node:test";
import assert from "node:assert/strict";
import { forX, xBody, spokenHost, xLength, xTags, fitX, xTextFor, xCustom, X_LIMIT } from "../lib/xpost.js";
import { readReal } from "./helpers/build-copy.mjs";

const SITE = "https://editiontracker.com";

test("the site's address is written in words, so X can't turn it into a link", () => {
  assert.equal(spokenHost(SITE), "editiontracker dot com");
  assert.equal(spokenHost("https://www.Example.co.uk/"), "example dot co dot uk");
  assert.equal(spokenHost("not a url"), "our website");
});

test("a web address in text is taken out, with or without https", () => {
  const t = (text, want) => assert.equal(forX(text, SITE), want, text);
  t("See https://editiontracker.com/switch-2-zelda-40th/ now", "See editiontracker dot com now");
  t("Visit https://editiontracker.com.", "Visit editiontracker dot com.");
  t("editiontracker.com is the site; EditionTracker.COM too", "editiontracker dot com is the site; editiontracker dot com too");
  t("tail https://example.com/a?x=1&y=2", "tail");
  t("See (https://www.ign.com/articles/x).", "See .");
  t("Available at gamestop.com/foo and www.target.com/p/1, also Xbox.com.", "Available at gamestop dot com and www dot target dot com, also Xbox dot com.");
  t("Go to bestbuy.com/site/x.", "Go to bestbuy dot com.");
  // Running it twice changes nothing.
  assert.equal(forX(forX("a https://x.com/y b gamestop.com", SITE), SITE), forX("a https://x.com/y b gamestop.com", SITE));
});

test("an address X would link is taken out whatever it looks like around the edges", () => {
  const t = (text, want) => assert.equal(forX(text, SITE), want, text);
  // Text stuck to the end of an address ("Walmart.com-exclusive"), an underscore in the name, and capitals in the ending.
  t("Walmart.com-exclusive color is back", "Walmart dot com-exclusive color is back");
  t("Order at my_store.example.com today", "Order at my_store dot example dot com today");
  t("Try Target.Store or www.Funko.Shop now", "Try Target dot Store or www dot Funko dot Shop now");
  // A path after it (a store's product page) goes, and so does a port.
  t("See Walmart.Shop/ip/123456 for details", "See Walmart dot Shop for details");
  t("Try shop.example.com:8080/x?y=1 now", "Try shop dot example dot com now");
  t("Try Walmart.Example/ip/12 or www.Funko.Example now", "Try Walmart dot Example or www dot Funko dot Example now"); // a path or "www." makes it an address whatever the ending
  // Other alphabets, and an address written with punycode.
  t("Купите на пример.рф сегодня", "Купите на пример dot рф сегодня");
  t("a.日本", "a dot 日本");
  t("xn--80ak6aa92e.com", "xn--80ak6aa92e dot com");
  // Dashes or dots right in front of it don't hide it.
  t("Use -gamestop.com or stock...gamestop.com", "Use -gamestop dot com or stock...gamestop dot com");
  // An address that follows an ordinary word with a full stop and a capital is a missing space, but an address in front of it isn't hidden by it.
  t("x.co.Check", "x dot co.Check");
  t("Sold out.Check back", "Sold out.Check back");
  // Taking one address out can join the text on either side into a new one, so it's repeated until nothing is left.
  t("x.co:1x.co", "x dot cox dot co");
  t("h0.com:1h1.com:1h2.com:1h3.com:1", "h0 dot comh1 dot comh2 dot comh3 dot com");
  // An email address isn't a web address, and this site's own addresses become the same words everywhere.
  t("Email tips@editiontracker.com", "Email tips@editiontracker.com");
  t("EDITIONTRACKER.COM and www.EditionTracker.com/zelda?x=1.", "editiontracker dot com and editiontracker dot com.");
  t("https://shop.editiontracker.com/a and HTTPS://UPPER.EXAMPLE.COM/Y ftp://files.example.org/x", "editiontracker dot com and");
});

test("running the address remover again on its own result never changes it", () => {
  // Made-up text from a fixed random sequence, so a failure can be run again. Pieces that make addresses, almost-addresses,
  // joins between them, punctuation and other alphabets.
  let seed = 20261011;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const pick = list => list[Math.floor(random() * list.length)];
  const PIECES = ["a", "b", "x", "Z", "co", "com", "COM", "Shop", "io", "ly", "1", "2", "9", "_", "-", ".", ".", ".", "/", ":", ":1", "://", "http", "https", "www.",
    "ftp", " ", " ", "  ", "\n", "(", ")", "<", ">", "\"", "'", "\u201c", "\u201d", "@", "#", "?", "=", "&", ",", ";", "!", "é", "п", "р", "ф", "日", "本", "…", "•",
    "editiontracker", "editiontracker.com", "gamestop.com", "x.co", "a.b", "e.g.", "U.S.", "v1.2", "$5.99", "...", "..", "--", "xn--p1ai"];
  // What X links that is left in a result: a scheme and an address, or a name and a well-known ending (emails aside).
  const SCHEME = /\b(?:https?|ftp):\/\/[^\s<>"'\u201c\u201d]/i;
  const ADDRESS = /(?<![\p{L}\p{N}_@])(?:[\p{L}\p{N}_](?:[\p{L}\p{N}_-]*[\p{L}\p{N}_])?\.)+(?:com|net|org|edu|gov|io|co|gg|tv|me|app|dev|xyz|info|shop|store|uk|de|fr|jp|ca|au)(?![\p{L}\p{N}])/iu;
  for (let i = 0; i < 30000; i++) {
    let text = "";
    for (let k = 1 + Math.floor(random() * 24); k > 0; k--) text += pick(PIECES);
    const once = forX(text, SITE);
    assert.equal(forX(once, SITE), once, JSON.stringify(text));
    assert.doesNotMatch(once, SCHEME, JSON.stringify(text));
    assert.doesNotMatch(once.replace(/\S*@\S*/g, " "), ADDRESS, JSON.stringify(text));
  }
});

test("what is sent to X is the X version with every address out, and never more than X takes", () => {
  // The X version of a post is used; with none, the Bluesky text is, with its links out.
  assert.equal(xBody({ text: "Hi https://editiontracker.com/x/", xText: "Hello from gamestop.com" }, SITE), "Hello from gamestop dot com");
  assert.equal(xBody({ text: "Hi https://editiontracker.com/x/ and https://example.com/y" }, SITE), "Hi editiontracker dot com and");
  // An X version that still has an address in it (a hand-made one) is cleaned too.
  assert.equal(xBody({ text: "x", xText: "Buy at https://www.target.com/p/1 now" }, SITE), "Buy at now");
  // Too long is refused, counted the way X counts: 140 arrows fit, 141 are 282.
  assert.equal(xBody({ text: "x", xText: "\u2192".repeat(140) }, SITE), "\u2192".repeat(140));
  assert.throws(() => xBody({ text: "x", xText: "\u2192".repeat(141) }, SITE), /282 characters long once its links are out \(the limit is 280\)/);
  assert.equal(xBody({ text: "w".repeat(280) }, SITE), "w".repeat(280));
  assert.throws(() => xBody({ text: "w".repeat(281) }, SITE), /281 characters long once its links are out/);
  // A long link doesn't count against it: it's taken out first.
  assert.equal(xBody({ text: `Read this ${"https://example.com/" + "a".repeat(400)} now` }, SITE), "Read this now");
});

test("prices, versions, abbreviations and a missing space after a full stop are left alone", () => {
  for (const text of ["It costs $519.99 and 2.5GHz, v1.2.3, U.S.A, No.1", "Sold out.Check back", "Dr.Mario", "someone@example.com", "Nintendo Switch 2 · $99.99 · Out Nov 5, 2026"]) {
    assert.equal(forX(text, SITE), text);
  }
  // But capitals don't hide a real address.
  assert.equal(forX("Try GameStop.Com or EDITIONTRACKER.COM", SITE), "Try GameStop dot Com or editiontracker dot com");
});

test("X's way of counting: most characters are 1, bullets, arrows, the ellipsis and emoji are 2", () => {
  assert.equal(xLength("abc"), 3);
  assert.equal(xLength("Pokémon · $5"), 12); // é and · count as 1
  assert.equal(xLength("é"), 1); // an e and an accent are one character once combined
  assert.equal(xLength("•"), 2);
  assert.equal(xLength("…"), 2);
  assert.equal(xLength("→"), 2);
  assert.equal(xLength("😀"), 2);
  assert.equal(xLength("a\nb"), 3);
});

test("hashtags come from the category and, when it's exactly one known platform, the platform", () => {
  assert.deepEqual(xTags({ category: "nintendo", platform: "Nintendo Switch 2" }), ["#Nintendo", "#Switch2"]);
  assert.deepEqual(xTags({ category: "playstation", platform: "PS5 Digital Edition" }), ["#PlayStation", "#PS5"]);
  assert.deepEqual(xTags({ category: "xbox", platform: "Xbox Series X|S, PC" }), ["#Xbox", "#XboxSeriesX"]);
  assert.deepEqual(xTags({ category: "games", platform: "PS5, Xbox Series X|S" }), ["#Gaming"]); // two platforms: neither
  assert.deepEqual(xTags({ category: "collect", platform: "LEGO" }), ["#Collectibles"]);
  assert.deepEqual(xTags({ category: "retro", platform: "Sega Genesis" }), ["#RetroGaming"]);
  assert.deepEqual(xTags({ category: "pc", platform: "Windows handheld" }), ["#PCGaming"]);
  assert.deepEqual(xTags({ category: "somethingnew", platform: "Whatever" }), []); // nothing invented
  assert.deepEqual(xTags(undefined), []);
  // Every category the site has today has a hashtag, and every hashtag on the real releases is plain letters and digits.
  for (const cat of ["nintendo", "playstation", "xbox", "pc", "games", "retro", "collect"]) assert.equal(xTags({ category: cat, platform: "" }).length, 1, cat);
  for (const item of readReal("data/releases.json").items) for (const tag of xTags(item)) assert.match(tag, /^#[A-Za-z0-9]+$/);
});

test("extra lines are dropped from the end when they don't fit, and the body is kept", () => {
  const site = "Details: editiontracker dot com"; // 31 characters
  assert.equal(fitX("Body", [site, "#Tag"]), `Body\n${site}\n#Tag`);
  const a = "x".repeat(240); // 240 + 1 + 31 + 1 + 4 = 277
  assert.equal(fitX(a, [site, "#Tag"]), `${a}\n${site}\n#Tag`);
  const b = "x".repeat(246); // 246 + 1 + 31 = 278 fits, the hashtag after it doesn't
  assert.equal(fitX(b, [site, "#Tag"]), `${b}\n${site}`);
  const c = "x".repeat(250); // 282 with the site's line, so that goes too
  assert.equal(fitX(c, [site, "#Tag"]), c);
  // Too long on its own: the first line is shortened, unless told not to (a message typed by hand is reported instead).
  const huge = "y".repeat(300);
  assert.ok(xLength(fitX(huge, [site])) <= X_LIMIT);
  assert.match(fitX(huge, [site]), /^y+…$/);
  assert.equal(fitX(huge, [site], { shorten: false }), huge);
  // Bullets count double, and the first line is the one that gives.
  const bullets = `Head ${"y".repeat(100)}\n${"• item\n".repeat(25).trim()}`;
  const fitted = fitX(bullets, [site]);
  assert.ok(xLength(fitted) <= X_LIMIT, xLength(fitted));
  assert.ok(fitted.endsWith("• item"));
});

test("a post's text for X has no link, names the site, and ends with the hashtags", () => {
  const post = { text: "New: Thing\nSwitch 2 · $99.99\nhttps://editiontracker.com/thing/", url: "https://editiontracker.com/thing/" };
  assert.equal(xTextFor(post, SITE, { tags: ["#Nintendo", "#Switch2"] }), "New: Thing\nSwitch 2 · $99.99\nDetails: editiontracker dot com\n#Nintendo #Switch2");
  assert.equal(xTextFor(post, SITE, { call: "Store links" }), "New: Thing\nSwitch 2 · $99.99\nStore links: editiontracker dot com");
  // A name that looks like an address is written in words too.
  const odd = { text: "New: Xbox.com Edition\nXbox\nhttps://editiontracker.com/x/", url: "https://editiontracker.com/x/" };
  assert.match(xTextFor(odd, SITE), /^New: Xbox dot com Edition\n/);
  for (const t of [xTextFor(post, SITE, { tags: ["#Nintendo"] }), xTextFor(odd, SITE)]) assert.doesNotMatch(t, /https?:|\.com|\.org/);
});

test("when space is tight the hashtags go one at a time before the site's line does", () => {
  const url = "https://editiontracker.com/x/";
  const tags = ["#Restock", "#Nintendo", "#Switch2"];
  const post = n => ({ text: `${"x".repeat(n)}\nline\n${url}`, url });
  const last = n => xTextFor(post(n), SITE, { call: "Store links", tags }).split("\n").slice(2); // what comes after the two body lines
  assert.deepEqual(last(211), ["Store links: editiontracker dot com", "#Restock #Nintendo #Switch2"]); // 280 exactly
  assert.deepEqual(last(212), ["Store links: editiontracker dot com", "#Restock #Nintendo"]);
  assert.deepEqual(last(221), ["Store links: editiontracker dot com", "#Restock"]);
  assert.deepEqual(last(231), ["Store links: editiontracker dot com"]);
  assert.deepEqual(last(240), []);
  for (const n of [211, 212, 221, 231, 240]) assert.ok(xLength(xTextFor(post(n), SITE, { call: "Store links", tags })) <= X_LIMIT, n);
  // Even the body alone too long: it's shortened rather than failing.
  assert.ok(xLength(xTextFor(post(400), SITE, { tags })) <= X_LIMIT);
});

test("a message typed by hand loses its links and names the site", () => {
  assert.equal(xCustom("Big news today", SITE), "Big news today\neditiontracker dot com");
  assert.equal(xCustom("Big news, see https://editiontracker.com/calendar/", SITE), "Big news, see editiontracker dot com"); // already names it
  assert.equal(xCustom("Read https://www.ign.com/a", SITE), "Read\neditiontracker dot com");
  assert.equal(xCustom("https://example.com/only-a-link", SITE), "editiontracker dot com");
  // Too long is reported by the caller, not cut here.
  const long = "z".repeat(300);
  assert.equal(xCustom(long, SITE), long);
});
