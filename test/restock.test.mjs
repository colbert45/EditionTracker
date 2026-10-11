import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveItem, resolveStore, cleanLink, listingLink, storeHosts, applyRestock, applySoldOut, InputError } from "../lib/restock.js";

// A small made-up catalog, so these tests never depend on what's on the live site.
const mini = () => ({
  updated: "2026-10-01",
  stores: {
    bestbuy: { name: "Best Buy", searchUrl: "https://www.bestbuy.com/site/searchpage.jsp?st=" },
    target: { name: "Target", searchUrl: "https://www.target.com/s?searchTerm=" },
    nintendo: { name: "Nintendo Store", url: "https://www.nintendo.com/us/store/" },
    xbox: { name: "Xbox Store", url: "https://www.xbox.com/", domains: ["microsoft.com"] },
    psdirect: { name: "PlayStation Direct", url: "https://direct.playstation.com/" },
    limitedrun: { name: "Limited Run Games", url: "https://limitedrungames.com/", searchUrl: "https://limitedrungames.com/search?q=" }
  },
  items: [
    { id: "switch-2-zelda-40th", name: "Switch 2 Zelda 40th Anniversary Edition", status: "preorder" },
    { id: "switch-2-pro-controller-zelda-40th", name: "Switch 2 Pro Controller, Zelda 40th Anniversary Edition", status: "soldout" },
    { id: "xbox-series-x25", name: "Xbox Series X 25th Anniversary", status: "out" },
    { id: "mystery-console", name: "Mystery Console", status: "rumor" },
    { id: "ps5-camo", name: "PS5 Camo Edition", status: "announced" }
  ]
});
const BB = "https://www.bestbuy.com/site/example/6000000.p?skuId=6000000";
const TODAY = "2026-10-09";
const restock = (over = {}, data = mini()) =>
  applyRestock(data, { item: "xbox-series-x25", retailer: "best buy", link: BB, source: "", today: TODAY, ...over });
const fails = (fn, pattern) => assert.throws(fn, e => e instanceof InputError && pattern.test(e.message), `expected an InputError matching ${pattern}`);

test("a release is found by id, by name, or by part of its name", () => {
  const d = mini();
  assert.equal(resolveItem(d, "xbox-series-x25").id, "xbox-series-x25");
  assert.equal(resolveItem(d, "Xbox Series X 25th Anniversary").id, "xbox-series-x25");
  assert.equal(resolveItem(d, "  XBOX series x25  ").id, "xbox-series-x25");
  assert.equal(resolveItem(d, "pro controller").id, "switch-2-pro-controller-zelda-40th");
  assert.equal(resolveItem(d, "switch-2-zelda-40th").id, "switch-2-zelda-40th"); // an exact id wins over a longer match
});

test("two possible releases are never guessed between", () => {
  fails(() => resolveItem(mini(), "zelda 40th"), /More than one release[\s\S]*switch-2-zelda-40th[\s\S]*switch-2-pro-controller-zelda-40th/);
  fails(() => resolveItem(mini(), "nothing like it"), /No release matches "nothing like it"/);
  fails(() => resolveItem(mini(), "  "), /Type the release's name/);
});

test("a store is found by key or name, with or without spaces", () => {
  const d = mini();
  for (const q of ["bestbuy", "Best Buy", "best buy", "BEST-BUY", "bestbuy.com"]) assert.equal(resolveStore(d, q).key, "bestbuy", q);
  assert.equal(resolveStore(d, "ps direct").key, "psdirect");
  assert.equal(resolveStore(d, "playstation").key, "psdirect");
  assert.equal(resolveStore(d, "limited run").key, "limitedrun");
  assert.equal(resolveStore(d, "Nintendo").key, "nintendo");
  fails(() => resolveStore(d, "store"), /More than one store[\s\S]*Nintendo Store, Xbox Store/);
  fails(() => resolveStore(d, "amazon"), /No store matches "amazon"[\s\S]*Best Buy, Target/);
  fails(() => resolveStore(d, ""), /Type the store's name/);
});

test("share-sheet junk is removed from a link, and nothing else is touched", () => {
  assert.equal(cleanLink(BB + "&utm_source=share&utm_medium=ios&irclickid=abc&ranMID=1&fbclid=x#reviews"), BB);
  assert.equal(cleanLink("https://www.target.com/p/thing/-/A-1?gclid=1&preselect=2"), "https://www.target.com/p/thing/-/A-1?preselect=2");
  const plain = "https://www.lego.com/en-us/product/zelda-10234?q=a%20b&skuId=1";
  assert.equal(cleanLink(plain), plain); // no tracking tags: the address stays exactly as pasted
  // A sentence with the link in it, as share buttons paste.
  assert.equal(cleanLink(`Switch 2 Zelda Edition - Best Buy ${BB}`), BB);
  assert.equal(cleanLink(`(${BB}).`), BB);
});

test("a link has to be a full https address", () => {
  fails(() => cleanLink(""), /is empty/);
  fails(() => cleanLink("bestbuy.com/site/x"), /isn't a full web address/);
  fails(() => cleanLink("http://www.bestbuy.com/site/x"), /https/);
  fails(() => cleanLink("https://user:pw@www.bestbuy.com/site/x"), /username or password/);
  fails(() => cleanLink("https://www.bestbuy.com/" + "a".repeat(1600)), /very long/);
  fails(() => cleanLink("nope", "The source link"), /^The source link/);
});

test("a link keeps its own brackets and encoding, and loses quotes and full stops", () => {
  assert.equal(cleanLink("https://en.wikipedia.org/wiki/Nintendo_(company)"), "https://en.wikipedia.org/wiki/Nintendo_(company)");
  assert.equal(cleanLink("(see https://en.wikipedia.org/wiki/Nintendo_(company))."), "https://en.wikipedia.org/wiki/Nintendo_(company)");
  assert.equal(cleanLink("see [this](https://example.com/a/b)"), "https://example.com/a/b");
  assert.equal(cleanLink(`\u201c${BB}\u201d`), BB); // pasted in curly quotes
  assert.equal(cleanLink(`"${BB}",`), BB);
  assert.equal(cleanLink(`<${BB}>`), BB);
  // The rest of the query is kept exactly as written, even when a tag is removed from beside it.
  assert.equal(cleanLink("https://www.bestbuy.com/site/x.p?sku=(1)&a=b%20c~d&utm_source=x"), "https://www.bestbuy.com/site/x.p?sku=(1)&a=b%20c~d");
  assert.equal(cleanLink("https://example.com/p?utm_source=x&utm_medium=y"), "https://example.com/p"); // nothing left: no "?"
  assert.equal(cleanLink("https://example.com/p?a=1&&b=2"), "https://example.com/p?a=1&&b=2"); // untouched when nothing is removed
});

test("affiliate and tracking tags are removed from a link, from any site", () => {
  const dirty = "https://example.com/a?keep=1&tag=dealsite-20&linkCode=ll1&siteID=abc&ref=nav&igsh=xyz&share_id=1&si=abc&aff=9&partner=z&TAG=x&gclid=1";
  assert.equal(cleanLink(dirty), "https://example.com/a?keep=1");
  // X adds ?s= and ?t= to shared posts. Only there.
  assert.equal(cleanLink("https://x.com/user/status/123?s=20&t=abc"), "https://x.com/user/status/123");
  assert.equal(cleanLink("https://example.com/a?s=20&t=abc"), "https://example.com/a?s=20&t=abc");
});

test("a link to Amazon, or with a port, is refused", () => {
  for (const bad of ["https://www.amazon.com/dp/B0ABC?tag=dealsite-20", "https://smile.amazon.co.uk/dp/B0", "https://amzn.to/3abc", "https://a.co/d/abc"]) {
    fails(() => cleanLink(bad), /goes to Amazon/);
    fails(() => cleanLink(bad, "The source link"), /^The source link goes to Amazon/);
  }
  fails(() => cleanLink("https://www.bestbuy.com:8443/site/x/1.p"), /port number/);
  assert.equal(cleanLink("https://www.bestbuy.com:443/site/x/1.p"), "https://www.bestbuy.com/site/x/1.p"); // the normal port isn't a port
  // A source can't sneak an affiliate link in either.
  fails(() => restock({ source: "https://www.amazon.com/dp/B0ABC?tag=dealsite-20" }), /source link goes to Amazon/);
});

test("the link has to be on the store's own website", () => {
  const { store } = resolveStore(mini(), "best buy");
  assert.equal(listingLink(store, BB), BB);
  assert.equal(listingLink(store, "https://bestbuy.com/site/x/1.p"), "https://bestbuy.com/site/x/1.p");
  assert.equal(listingLink(store, "https://api.bestbuy.com/x/1"), "https://api.bestbuy.com/x/1");
  // Lookalikes and redirects don't count.
  for (const bad of ["https://bestbuy.com.evil.com/site/1", "https://evilbestbuy.com/site/1", "https://www.bestbuy.com@evil.com/site/1", "https://bit.ly/abc", "https://www.amazon.com/dp/B0"]) {
    assert.throws(() => listingLink(store, bad), InputError, bad);
  }
  fails(() => listingLink(store, "https://www.walmart.com/ip/1"), /goes to walmart\.com, but Best Buy sells from bestbuy\.com[\s\S]*"domains"/);
  // A store's extra domains are accepted too.
  const xbox = resolveStore(mini(), "xbox").store;
  assert.deepEqual(storeHosts(xbox), ["xbox.com", "microsoft.com"]);
  assert.equal(listingLink(xbox, "https://www.microsoft.com/en-us/d/xbox-series-x/8k5kr3x2l3vn"), "https://www.microsoft.com/en-us/d/xbox-series-x/8k5kr3x2l3vn");
  // The store's home page isn't a listing.
  fails(() => listingLink(store, "https://www.bestbuy.com/"), /home page/);
  fails(() => listingLink(store, "https://www.bestbuy.com"), /home page/);
  fails(() => listingLink(store, "https://www.bestbuy.com/?intl=nosplash"), /home page/);
});

test("a restock is logged, the status switches, and the input is left alone", () => {
  const d = mini();
  const before = JSON.stringify(d);
  const r = restock({ source: " https://example.com/news/restock?utm_source=x " }, d);
  assert.equal(JSON.stringify(d), before);
  assert.equal(r.changed, true);
  const it = r.data.items.find(i => i.id === "xbox-series-x25");
  assert.equal(it.status, "restock");
  assert.deepEqual(it.restocks, [{ date: TODAY, store: "bestbuy", url: BB, source: "https://example.com/news/restock" }]);
  assert.equal(r.data.updated, TODAY);
  assert.equal(r.message, `Back in stock: Xbox Series X 25th Anniversary at Best Buy\n\nListing: ${BB}\nSource: https://example.com/news/restock`);
  assert.doesNotMatch(r.message, /\[no alerts\]/);
});

test("new restocks go on the end of the log, and a source that repeats the link is dropped", () => {
  const first = restock();
  const later = restock({ retailer: "target", link: "https://www.target.com/p/x/-/A-9", source: "https://www.target.com/p/x/-/A-9?utm_campaign=z" }, first.data);
  const log = later.data.items.find(i => i.id === "xbox-series-x25").restocks;
  assert.deepEqual(log.map(r => r.store), ["bestbuy", "target"]);
  assert.equal(log[1].source, null);
  assert.doesNotMatch(later.message, /Source:/);
});

test("a second restock at the same store on the same day is one entry, however the page was pasted", () => {
  const first = restock();
  for (const link of [BB, "https://bestbuy.com/site/example/6000000.p?skuId=6000000", BB + "&ref=app&irclickid=abc", BB.replace(".p?", ".p/?")]) {
    const again = restock({ link }, first.data);
    assert.equal(again.changed, false, link);
    assert.match(again.note, /already logged \(Best Buy, 2026-10-09\)/);
    assert.match(again.note, /Sold out again/);
    assert.match(again.note, /Resend restock email/);
    assert.equal(again.data, first.data); // returned untouched
  }
  // Another store, or the next day, is a new entry.
  assert.equal(restock({ retailer: "target", link: "https://www.target.com/p/x/-/A-9" }, first.data).changed, true);
  assert.equal(restock({ today: "2026-10-10" }, first.data).changed, true);
  // Sold out, then back at the same store the same day: a second wave, so a second entry.
  const sold = applySoldOut(first.data, { item: "xbox-series-x25", today: TODAY });
  const wave2 = restock({}, sold.data);
  assert.equal(wave2.changed, true);
  assert.equal(wave2.data.items.find(i => i.id === "xbox-series-x25").restocks.length, 2);
});

test("a news report of a restock doesn't stop you logging it yourself afterwards", () => {
  // The news check logged "Reported" at Best Buy today. You then check the store and post it: that's a new, confirmed entry.
  const d = mini();
  const it = d.items.find(i => i.id === "xbox-series-x25");
  it.status = "restock";
  it.restocks = [{ date: TODAY, store: "bestbuy", url: "https://www.bestbuy.com/site/searchpage.jsp?st=Xbox", source: "https://news.example/restock", reported: true }];
  const r = restock({}, d);
  assert.equal(r.changed, true);
  const log = r.data.items.find(i => i.id === "xbox-series-x25").restocks;
  assert.deepEqual(log.map(x => [x.store, Boolean(x.reported)]), [["bestbuy", true], ["bestbuy", false]]);
  // Doing it again is the double tap, as before.
  assert.equal(restock({}, r.data).changed, false);
});

test("the Store box can be left blank: the store is read from the link", () => {
  assert.equal(restock({ retailer: "" }).entry.store, "bestbuy");
  assert.equal(restock({ retailer: "   " }).entry.store, "bestbuy");
  assert.equal(restock({ retailer: "", link: "https://www.microsoft.com/en-us/d/xbox-series-x/8k5kr3x2l3vn" }).entry.store, "xbox");
  assert.equal(restock({ retailer: "", link: "https://direct.playstation.com/en-us/item/x" }).entry.store, "psdirect");
  // A website that isn't a store on the list: say so, and say what to do.
  fails(() => restock({ retailer: "", link: "https://www.walmart.com/ip/1" }), /can't tell which store walmart\.com is[\s\S]*Store box/);
  // A blank link is reported once, not twice.
  assert.throws(() => restock({ retailer: "", link: "" }), e => e instanceof InputError && e.message.split("\n").length === 1 && /The link is empty/.test(e.message));
  // Two stores on one website: it won't guess.
  const two = mini();
  two.stores.outlet = { name: "Best Buy Outlet", url: "https://www.bestbuy.com/outlet/" };
  fails(() => restock({ retailer: "" }, two), /could be Best Buy or Best Buy Outlet/);
  assert.equal(restock({ retailer: "outlet" }, two).entry.store, "outlet");
  // A store typed in still has to match the link's website.
  fails(() => restock({ retailer: "target", link: BB }), /goes to bestbuy\.com, but Target sells from target\.com/);
});

test("every mistake is reported at once", () => {
  assert.throws(
    () => restock({ item: "zelda 40th", retailer: "amazon", link: "http://x" }),
    e => e instanceof InputError && /More than one release/.test(e.message) && /No store matches/.test(e.message)
  );
  assert.throws(
    () => restock({ link: "https://www.walmart.com/ip/1", source: "not a link" }),
    e => e instanceof InputError && /sells from bestbuy\.com/.test(e.message) && /^The source link|\nThe source link/.test(e.message)
  );
  fails(() => restock({ link: "" }), /The link is empty/);
});

test("a release that isn't out for sale yet can't be restocked", () => {
  fails(() => restock({ item: "mystery-console" }), /marked "rumor"/);
  fails(() => restock({ item: "ps5-camo" }), /marked "announced"/);
  fails(() => applySoldOut(mini(), { item: "ps5-camo", today: TODAY }), /marked "announced"/);
});

test("sold out again switches the status and says no email", () => {
  const back = restock();
  const r = applySoldOut(back.data, { item: "xbox", today: "2026-10-11" });
  assert.equal(r.changed, true);
  const it = r.data.items.find(i => i.id === "xbox-series-x25");
  assert.equal(it.status, "soldout");
  assert.equal(it.restocks.length, 1); // the history stays
  assert.equal(r.data.updated, "2026-10-11");
  assert.equal(r.message, "Sold out again: Xbox Series X 25th Anniversary [no alerts]");
  // Already sold out: nothing to do.
  const twice = applySoldOut(r.data, { item: "xbox", today: TODAY });
  assert.equal(twice.changed, false);
  assert.match(twice.note, /already shows Sold out/);
  // A preorder that sells out works too.
  assert.equal(applySoldOut(mini(), { item: "switch-2-zelda-40th", today: TODAY }).data.items[0].status, "soldout");
});
