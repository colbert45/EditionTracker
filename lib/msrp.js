// MSRP helpers shared by the release pages and the alert emails. Pure functions.
//
// The MSRP shown for a release is its explicit `msrp`, else its `price` when that is one
// plain dollar amount. Ranges ("$119.99 to $209.99"), "TBA" and rumors get no MSRP line,
// so the site never claims a price it isn't sure of.
const ONE_PRICE = /^\$\d[\d,]*(\.\d{2})?( each)?$/i;

export function msrpText(item) {
  if (!item || item.status === "rumor") return null;
  const v = String(item.msrp ?? item.price ?? "").trim();
  return ONE_PRICE.test(v) ? v : null;
}

// "$1,299.99" -> 1299.99. Null when there's no dollar amount.
export const dollars = s => {
  const m = /\$(\d[\d,]*(?:\.\d{2})?)/.exec(String(s ?? ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
