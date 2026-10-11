// Starting points for the restock and price tests: the real release data with everything filled in by
// hand removed (restocks, resale prices, explicit MSRPs, "How to get one" boxes), and a release to use. Tests that start here
// keep passing after real restocks or resale prices are added on the site.
import { readReal } from "./build-copy.mjs";
import { msrpText } from "../../lib/msrp.js";

// The stores these tests log restocks at. They are written out here, not read from the live data, so renaming or
// removing one of them on the site (a store closes, a search address changes) can't turn a deploy red.
const STORES = {
  bestbuy: { name: "Best Buy", searchUrl: "https://www.bestbuy.com/site/searchpage.jsp?st=" },
  target: { name: "Target", searchUrl: "https://www.target.com/s?searchTerm=" },
  walmart: { name: "Walmart", searchUrl: "https://www.walmart.com/search?q=" },
  psdirect: { name: "PlayStation Direct", url: "https://direct.playstation.com/" },
  gamestop: { name: "GameStop", searchUrl: "https://www.gamestop.com/search/?q=" }
};

export function plainData() {
  const d = readReal("data/releases.json");
  d.stores = { ...d.stores, ...JSON.parse(JSON.stringify(STORES)) };
  for (const it of d.items) {
    delete it.restocks;
    delete it.resale;
    delete it.msrp;
    delete it.howToGet;
    if (it.status === "restock") it.status = "soldout";
  }
  return d;
}

// A release that can be restocked and has one plain price (so it gets an MSRP line), and any other release.
export function pickItems(d) {
  const item = d.items.find(i => ["preorder", "out", "soldout"].includes(i.status) && msrpText(i));
  return { item, other: d.items.find(i => i.id !== item.id) };
}

// The starting point for the older alert, social and schedule tests: the plain data above with the preorder
// dates the news check writes taken out, plus two releases of a known kind that can't age out (an announced one with
// no date, and a preorder that doesn't open until 2099). Those tests look for "an announced release" and "a preorder",
// and the live data can stop having either on any given day.
export function steadyData() {
  const d = plainData();
  for (const it of d.items) delete it.preordersStart;
  const template = JSON.parse(JSON.stringify(d.items[0]));
  const make = (id, patch) => ({ ...JSON.parse(JSON.stringify(template)), id, name: `Test ${id}`, searchQuery: id, image: null, imageCredit: null,
    timeline: [], preordersOpened: null, price: "$99.99", ...patch });
  d.items.push(
    make("test-announced", { status: "announced", releaseDate: null, releaseWindow: "2099" }),
    make("test-preorder", { status: "preorder", releaseDate: "2099-06-01", releaseWindow: null, preordersOpened: "2098-12-01" })
  );
  return d;
}
