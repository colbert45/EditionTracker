// The automatic Best Buy stock check, as plain functions (no network, so the tests can run every case).
// Best Buy's Products API says, for each product number (SKU), whether it can be bought online. A release counts as back
// in stock when it was NOT available at the last check and is now. The first time a SKU is seen it only sets the
// starting point, so turning the check on never announces something that was already in stock.

export const isSku = v => /^\d{6,8}$/.test(String(v ?? ""));

// The product page, in the form the restock log accepts as a Best Buy listing.
export const bestBuyListing = sku => `https://www.bestbuy.com/site/-/${sku}.p?skuId=${sku}`;

// Best Buy's answer -> Map of sku -> { name, available }. "Available" means buyable online now; a product Best Buy also
// labels sold out or coming soon doesn't count, whatever else it says.
export function parseBestBuy(json) {
  const out = new Map();
  for (const p of Array.isArray(json?.products) ? json.products : []) {
    if (!isSku(p?.sku)) continue;
    const label = String(p.orderable ?? "");
    out.set(String(p.sku), { name: String(p.name ?? ""), available: p.onlineAvailability === true && !/^(soldout|comingsoon)$/i.test(label), orderable: label || null });
  }
  return out;
}

// entries: [{ item, sku }], seen: Map from parseBestBuy, before: { [sku]: boolean } from the last check.
// -> { after: the new { [sku]: boolean }, restocks: [{ item, sku, name }], notes: [text for the log] }
export function planStock(entries, seen, before = {}) {
  const after = { ...before }, restocks = [], notes = [];
  for (const { item, sku } of entries) {
    const now = seen.get(String(sku));
    if (!now) { notes.push(`${item}: Best Buy didn't answer for ${sku}, left as it was.`); continue; }
    const was = before[sku];
    if (was === undefined) notes.push(`${item}: first look, ${now.available ? "in stock" : "not in stock"}. Nothing announced.`);
    else if (!was && now.available) { restocks.push({ item, sku: String(sku), name: now.name }); notes.push(`${item}: back in stock.`); }
    else if (was && !now.available) notes.push(`${item}: no longer in stock.`);
    after[sku] = now.available;
  }
  return { after, restocks, notes };
}
