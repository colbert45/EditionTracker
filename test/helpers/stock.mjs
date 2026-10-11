// Starting points for the restock and price tests: the real release data with everything filled in by
// hand removed (restocks, resale prices, explicit MSRPs), and a release to use. Tests that start here
// keep passing after real restocks or resale prices are added on the site.
import { readReal } from "./build-copy.mjs";
import { msrpText } from "../../lib/msrp.js";

export function plainData() {
  const d = readReal("data/releases.json");
  for (const it of d.items) {
    delete it.restocks;
    delete it.resale;
    delete it.msrp;
    if (it.status === "restock") it.status = "soldout";
  }
  return d;
}

// A release that can be restocked and has one plain price (so it gets an MSRP line), and any other release.
export function pickItems(d) {
  const item = d.items.find(i => ["preorder", "out", "soldout"].includes(i.status) && msrpText(i));
  return { item, other: d.items.find(i => i.id !== item.id) };
}
