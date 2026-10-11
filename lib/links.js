// Rules about links, shared by the restock action (which cleans what you paste) and the validator
// (which checks what's saved). The site has no ads and no affiliate links, so a link that carries an
// affiliate tag, or goes to Amazon, never gets published. Pure functions.

// Tags that earn someone a commission. The validator refuses these.
const AFFILIATE = /^(tag|linkcode|linkid|ascsubtag|irclickid|irgwc|irpid|irmpname|iradid|cjevent|cjdata|ranmid|raneaid|ransiteid|siteid|sscid|afftrack|awc|aff|affid|aff_id|affp\d|afid|affiliate|affiliateid|affiliate_id|wmlspartner|partner|partnerid|partner_id|publisherid|subid|sub_id|clickid|click_id|a_aid|a_bid|u1|mpid|pubid)$/i;

// Tags that only track who clicked. The restock action removes these too.
const TRACKING = /^(utm_.*|fbclid|gclid|gclsrc|dclid|msclkid|twclid|ttclid|yclid|li_fat_id|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|vero_id|s_kwcid|ef_id|igsh|igshid|mibextid|share_id|si|ref|ref_|veh|sharedid)$/i;

// X and Twitter add ?s= and ?t= to shared posts. Only there; elsewhere those names can mean something.
const X_HOST = /(^|\.)(x|twitter)\.com$/i;
const X_TRACKING = /^(s|t)$/i;

export const isAffiliateParam = name => AFFILIATE.test(name);
export const isTrackingParam = (name, host = "") => AFFILIATE.test(name) || TRACKING.test(name) || (X_HOST.test(host) && X_TRACKING.test(name));

// Amazon and its short links. The site doesn't link there (it can't tell a store from a marked-up seller).
export const isAmazonHost = host => /(^|\.)(amazon\.[a-z.]+|amzn\.[a-z.]+|a\.co)$/i.test(host);

const paramName = pair => {
  const name = pair.split("=")[0];
  try { return decodeURIComponent(name.replace(/\+/g, " ")); } catch { return name; }
};

// The parameter names in a URL's query, as written.
export function paramNames(url) {
  try { return new URL(url).search.slice(1).split("&").filter(Boolean).map(paramName); } catch { return []; }
}

// Removes tracking and affiliate tags from a URL object in place. The rest of the query is kept
// exactly as it was written, so a store's own parameters are never re-encoded or reordered.
export function dropTracking(u) {
  const pairs = u.search.slice(1).split("&");
  const kept = pairs.filter(p => !p || !isTrackingParam(paramName(p), u.hostname));
  if (kept.length !== pairs.length) u.search = kept.filter(Boolean).join("&");
  return u;
}
