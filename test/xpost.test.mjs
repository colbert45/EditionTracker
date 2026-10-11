import { test } from "node:test";
import assert from "node:assert/strict";
import { forX, spokenHost, xLength, xTags, fitX, xTextFor, xCustom, X_LIMIT } from "../lib/xpost.js";
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

test("a message typed by hand loses its links and names the site", () => {
  assert.equal(xCustom("Big news today", SITE), "Big news today\neditiontracker dot com");
  assert.equal(xCustom("Big news, see https://editiontracker.com/calendar/", SITE), "Big news, see editiontracker dot com"); // already names it
  assert.equal(xCustom("Read https://www.ign.com/a", SITE), "Read\neditiontracker dot com");
  assert.equal(xCustom("https://example.com/only-a-link", SITE), "editiontracker dot com");
  // Too long is reported by the caller, not cut here.
  const long = "z".repeat(300);
  assert.equal(xCustom(long, SITE), long);
});
