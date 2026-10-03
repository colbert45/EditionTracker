// Builds the whole site into _site/ from data/releases.json.
//   npm run build
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { art } from "../lib/art.js";
import { validate } from "../lib/validate.js";
import { itemCardSvg, homeCardSvg, toPng } from "../lib/og.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");
const STATIC = join(ROOT, "static");
const read = p => readFileSync(join(ROOT, p), "utf8");

const config = JSON.parse(read("site.config.json"));
const data = JSON.parse(read("data/releases.json"));
const SITE = config.siteUrl.replace(/\/$/, "");
const NAME = config.siteName;

const { errors, warnings } = validate(data, { staticDir: STATIC });
warnings.forEach(w => console.warn("warning:", w));
if (errors.length) {
  console.error(`\nreleases.json has ${errors.length} problem(s):\n` + errors.map(e => "  - " + e).join("\n"));
  process.exit(1);
}

// ---------- helpers (same date rules as the design) ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toDate = d => new Date(d + "T12:00:00Z");
const fmt = (d, o) => toDate(d).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const short = d => fmt(d, { month: "short", day: "numeric" });
const long = d => fmt(d, { month: "short", day: "numeric", year: "numeric" });
// "Today" for the build is the US Eastern date; the page script re-checks with the visitor's own date.
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const daysOut = d => Math.round((toDate(d) - toDate(TODAY)) / 86400000);

const CATS = data.categories;
const STATUS = data.statuses;
const STORES = data.stores;

// Normalise each item into the shape the design's code used.
const ITEMS = data.items.map((it, n) => ({
  ...it, n,
  date: it.releaseDate || null,
  when: it.releaseWindow || "TBA",
  pre: it.preordersOpened || null,
  url: `${SITE}/${it.id}/`,
  path: `/${it.id}/`
}));

const isOut = i => i.status === "out" || i.status === "soldout" || (i.date && daysOut(i.date) < 0);
const when = i => i.date ? long(i.date) : (i.when || "TBA");
const chip = s => `<span class="st" style="--c:var(--c-${s});--t:var(--t-${s})">${esc(STATUS[s])}</span>`;
const absUrl = u => u.startsWith("/") ? SITE + u : u;
const isRaster = u => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u);
const artSpec = i => [i.art.type, ...i.art.colors];

// ---------- shared page parts ----------
const FONTS = [
  ["Barlow", 400, "barlow-latin-400-normal"], ["Barlow", 500, "barlow-latin-500-normal"],
  ["Barlow", 600, "barlow-latin-600-normal"], ["Barlow", 700, "barlow-latin-700-normal"],
  ["Barlow Condensed", 600, "barlow-condensed-latin-600-normal"], ["Barlow Condensed", 700, "barlow-condensed-latin-700-normal"],
  ["Barlow Condensed", 800, "barlow-condensed-latin-800-normal"]
];
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const fontFaces = FONTS.map(([fam, w, file]) =>
  `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/${file}.woff2) format("woff2");unicode-range:${LATIN}}`).join("\n");

// The design's CSS, untouched, plus a few lines for real photos.
const CSS = `${fontFaces}\n${read("lib/design.css")}
.thumb img,.hero .art img{display:block;width:100%;height:100%;object-fit:contain}
.hero .art img{border-radius:4px}
[hidden]{display:none!important}`;

const PRELOAD = ["barlow-latin-400-normal", "barlow-latin-600-normal", "barlow-condensed-latin-800-normal"]
  .map(f => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join("\n");

function analytics() {
  const a = config.analytics || {};
  if (a.provider === "plausible" && a.plausible?.domain)
    return `<script defer data-domain="${esc(a.plausible.domain)}" src="${esc(a.plausible.script || "https://plausible.io/js/script.js")}"></script>`;
  if (a.provider === "cloudflare" && a.cloudflare?.token)
    return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: a.cloudflare.token })}'></script>`;
  return "";
}

const minifyJs = s => s.replace(/^\s*\/\/.*$/gm, "").replace(/\n\s*\n/g, "\n").trim();
const HOME_JS = minifyJs(read("lib/client-home.js"));
const ITEM_JS = minifyJs(read("lib/client-item.js"));

function page({ title, description, path, ogImage, ogAlt, jsonld = [], body, script = "", noindex = false }) {
  const url = SITE + path;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? `<meta name="robots" content="noindex">` : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(ogImage)}">
${ogImage.startsWith(SITE + "/og/") ? `<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:type" content="image/png">\n` : ""}<meta property="og:image:alt" content="${esc(ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121418" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${PRELOAD}
<style>
${CSS}
</style>
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
${analytics()}
</head>
<body>
<div class="wrap">
  <header class="mast">
    <a class="logo" href="/"><span class="tag" aria-hidden="true"></span><b>edition tracker</b></a>
    <span class="updated" id="updated">Updated ${long(data.updated)}</span>
  </header>
  <main id="app">${body}</main>
  <footer>
    <p>Edition Tracker isn't affiliated with Nintendo, Sony, Microsoft or any store. Prices and stock move fast, so double-check before you buy.</p>
    <p>Spotted something I missed? It'll be added once there's a source.</p>
  </footer>
</div>
${script ? `<script>\n${script}\n</script>\n` : ""}</body>
</html>
`;
}

// ---------- homepage ----------
function thumb(i) {
  return i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" decoding="async">` : art(artSpec(i));
}

function rowHTML(i) {
  let sub = "";
  if (i.date && !isOut(i)) { const n = daysOut(i.date); sub = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`; }
  return `<li data-i="${i.n}" data-cat="${esc(i.category)}" data-status="${esc(i.status)}"${i.date ? ` data-date="${i.date}"` : ""}><a href="${esc(i.path)}">
    <span class="thumb">${thumb(i)}</span>
    <span class="nm">${esc(i.name)}<span class="pf">${esc(i.platform)}, ${esc(i.price)}</span></span>
    <span class="dt">${i.date ? (isOut(i) ? long(i.date) : short(i.date)) : esc(i.when || "TBA")}${sub ? `<span>${sub}</span>` : ""}</span>
    <span>${chip(i.status)}</span></a></li>`;
}

function section(key, title, note, list, alwaysShow) {
  return `<section data-sec="${key}"${!list.length && !alwaysShow ? " hidden" : ""}><h2 class="sec">${title}${note ? ` <small>${note}</small>` : ""}</h2>
    <ul class="list">${list.length ? list.map(rowHTML).join("") : `<li><p class="empty">Nothing here right now.</p></li>`}</ul></section>`;
}

function home() {
  const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999");
  const coming = ITEMS.filter(i => i.status !== "rumor" && !isOut(i)).sort(byDate);
  const rumors = ITEMS.filter(i => i.status === "rumor");
  const out = ITEMS.filter(i => i.status !== "rumor" && isOut(i)).sort((a, b) => byDate(b, a));
  const chips = [["all", "Everything"]].concat(Object.entries(CATS))
    .map(([k, v]) => `<button type="button" data-cat="${esc(k)}" aria-pressed="${k === "all"}">${esc(v)}</button>`).join("");
  const body = `
    <div class="lede"><p>Special edition consoles, controllers and collectibles: when they come out, what they cost, and where to look. I update this as news drops.</p></div>
    <div class="chips" role="group" aria-label="Filter by category">${chips}</div>
    ${section("coming", "Coming up", "", coming, true)}
    ${section("rumors", "Rumors and leaks", "not confirmed", rumors)}
    ${section("out", "Already out", "", out)}`;
  const jsonld = [
    { "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: SITE + "/" },
    { "@context": "https://schema.org", "@type": "ItemList", name: "Special edition releases",
      itemListElement: [...coming, ...rumors, ...out].map((i, k) => ({ "@type": "ListItem", position: k + 1, url: i.url, name: i.name })) }
  ];
  return page({
    title: "Edition Tracker: special edition consoles, controllers and collectibles",
    description: "Special edition consoles, controllers and collectibles, with release dates, prices and where to buy.",
    path: "/", ogImage: `${SITE}/og/home.png`, ogAlt: "Edition Tracker: special edition consoles, controllers and collectibles",
    jsonld, body, script: HOME_JS
  });
}

// ---------- release pages ----------
const STATUS_PHRASE = { rumor: "rumored, not confirmed", announced: "announced", preorder: "preorders open", out: "out now", soldout: "sold out" };

function releasePhrase(i) {
  if (i.date) return isOut(i) ? `released ${long(i.date)}` : `out ${long(i.date)}`;
  return i.when && i.when !== "TBA" ? `expected ${i.when}` : "release date TBA";
}

function describe(i) {
  const price = i.price === "TBA" ? "price TBA" : i.price;
  const head = `${i.name} (${i.platform}): ${STATUS_PHRASE[i.status] || STATUS[i.status]}, ${price}, ${releasePhrase(i)}.`;
  const first = (i.notes[0].match(/^.*?[.!?](?=\s|$)/) || [i.notes[0]])[0];
  const d = `${head} ${first}`;
  return d.length <= 170 ? d : head;
}

function offers(i) {
  if (i.status === "rumor") return undefined;
  const prices = [...i.price.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map(m => Number(m[1].replace(/,/g, "")));
  if (!prices.length) return undefined;
  const availability = { preorder: "https://schema.org/PreOrder", out: "https://schema.org/InStock", soldout: "https://schema.org/SoldOut" }[i.status];
  const base = { priceCurrency: "USD", url: i.url, ...(availability && { availability }),
    ...(i.status === "preorder" && i.date && { availabilityStarts: i.date }) };
  if (prices.length === 1) return { "@type": "Offer", price: prices[0].toFixed(2), ...base };
  return { "@type": "AggregateOffer", lowPrice: Math.min(...prices).toFixed(2), highPrice: Math.max(...prices).toFixed(2), ...base };
}

function storeRow(i, s) {
  const st = STORES[s.store];
  const href = s.affiliateUrl || (st.searchUrl ? st.searchUrl + encodeURIComponent(i.searchQuery) : st.url);
  const rel = s.affiliateUrl ? "sponsored noopener" : "noopener";
  return `<tr><td>${esc(st.name)}</td><td>${!s.listed ? `<span class="na">Not listed yet</span>` : `<a href="${esc(href)}" target="_blank" rel="${rel}">Check stock</a>`}</td></tr>`;
}

function item(i, ogImage) {
  const n = i.date ? daysOut(i.date) : null;
  const cd = n > 1 ? `Out in ${n} days.` : n === 1 ? "Out tomorrow." : n === 0 ? "Out today." : "";
  const showCountdown = i.date && i.status !== "out" && i.status !== "soldout";
  const hasAffiliate = i.stores.some(s => s.listed && s.affiliateUrl);
  const hero = i.image
    ? `<figure class="hero" style="margin:0 0 14px"><div class="art"><img src="${esc(i.image)}" alt="${esc(i.name)}" decoding="async"></div><figcaption>${esc(i.imageCredit)}</figcaption></figure>`
    : `<figure class="hero" style="margin:0 0 14px"><div class="art">${art(artSpec(i))}</div><figcaption>Illustration, not a product photo</figcaption></figure>`;
  const body = `<article class="item">
    <a class="back" href="/">Back to all releases</a>
    <h1>${esc(i.name)}</h1>
    <div class="sub"><span>${esc(i.platform)}</span>${chip(i.status)}</div>
    ${hero}
    <dl class="facts">
      <div><dt>Price</dt><dd>${esc(i.price)}</dd></div>
      <div><dt>Release</dt><dd>${esc(when(i))}</dd></div>
      <div><dt>Preorders opened</dt><dd>${i.pre ? long(i.pre) : "No"}</dd></div>
      <div><dt>Category</dt><dd>${esc(CATS[i.category])}</dd></div>
    </dl>
    ${showCountdown ? `<p class="countdown" data-release="${i.date}"${cd && !isOut(i) ? "" : " hidden"}>${cd && !isOut(i) ? cd : ""}</p>` : ""}
    <h2>Notes</h2>${i.notes.map(p => `<p>${esc(p)}</p>`).join("")}
    ${i.inTheBox.length ? `<h2>What's in the box</h2><ul class="plain">${i.inTheBox.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    <h2>Where to buy</h2>
    <table class="stores"><tbody>${i.stores.map(s => storeRow(i, s)).join("")}</tbody></table>
    <p class="small">Links open the store's search. Stock changes by the hour on these, so check before you head out.</p>
    ${hasAffiliate ? `<p class="small">Some of these are affiliate links, so Edition Tracker may earn a commission if you buy through them. It doesn't change your price.</p>` : ""}
    ${i.timeline.length ? `<h2>Timeline</h2>
    <ul class="tl">${[...i.timeline].sort((a, b) => b.date.localeCompare(a.date)).map(t => `<li><time datetime="${t.date}">${long(t.date)}</time><span>${esc(t.text)}</span></li>`).join("")}</ul>` : ""}
    <h2>Sources</h2>
    <ul class="plain src">${i.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join("")}</ul>
  </article>`;

  const description = describe(i);
  const product = {
    "@context": "https://schema.org", "@type": "Product",
    name: i.name, description: i.notes.join(" "), url: i.url, image: [ogImage],
    category: CATS[i.category], ...(i.date && { releaseDate: i.date }),
    ...(offers(i) && { offers: offers(i) })
  };
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: NAME, item: SITE + "/" },
    { "@type": "ListItem", position: 2, name: i.name, item: i.url }] };
  return page({
    title: `${i.name}: price, release date, where to buy | ${NAME}`,
    description, path: i.path, ogImage, ogAlt: i.image ? i.name : `${i.name} (illustration)`,
    jsonld: [product, crumbs], body, script: ITEM_JS
  });
}

function notFound() {
  const body = `<article class="item">
    <a class="back" href="/">Back to all releases</a>
    <h1>Page not found</h1>
    <p>There's nothing at this address. The link might have a typo, or the page moved.</p>
    <p>Everything I track is on the <a href="/">homepage</a>.</p>
  </article>`;
  return page({ title: `Page not found | ${NAME}`, description: "This page doesn't exist.", path: "/404.html",
    ogImage: `${SITE}/og/home.png`, ogAlt: NAME, body, noindex: true });
}

// ---------- favicon ----------
const TAG_PATH = "M3 0H17A9 9 0 0 1 17 18H3A3 3 0 0 1 0 15V3A3 3 0 0 1 3 0ZM21 9A3 3 0 1 0 15 9A3 3 0 1 0 21 9Z";
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -5 28 28"><style>path{fill:#D7263D}@media (prefers-color-scheme:dark){path{fill:#FF4D62}}</style><path fill-rule="evenodd" d="${TAG_PATH}"/></svg>`;
const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" fill="#FFFFFF"/><g transform="translate(25 52) scale(5)"><path fill-rule="evenodd" fill="#D7263D" d="${TAG_PATH}"/></g></svg>`;

function ico(png) { // a .ico file that wraps one 32x32 PNG
  const h = Buffer.alloc(22);
  h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  h.writeUInt8(32, 6); h.writeUInt8(32, 7); h.writeUInt8(0, 8); h.writeUInt8(0, 9);
  h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12); h.writeUInt32LE(png.length, 14); h.writeUInt32LE(22, 18);
  return Buffer.concat([h, png]);
}

// ---------- write everything ----------
const write = (p, content) => { const f = join(OUT, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(STATIC, OUT, { recursive: true });

// Share images are only redrawn when what's on them changes (cached in .cache/og).
const CACHE = join(ROOT, ".cache", "og");
mkdirSync(CACHE, { recursive: true });
function png(name, svg) {
  const key = createHash("sha1").update(svg + readFileSync(join(ROOT, "lib/og.js"))).digest("hex").slice(0, 16);
  const cached = join(CACHE, `${name}-${key}.png`);
  if (!existsSync(cached)) writeFileSync(cached, toPng(svg));
  write(`og/${name}.png`, readFileSync(cached));
}

png("home", homeCardSvg());
write("index.html", home());

for (const i of ITEMS) {
  let ogImage;
  if (i.image && isRaster(i.image)) ogImage = absUrl(i.image);
  else {
    png(i.id, itemCardSvg({ name: i.name, platform: i.platform, price: i.price, statusKey: i.status,
      statusLabel: STATUS[i.status], releaseText: i.date ? `Out ${long(i.date)}` : `Release: ${i.when}`, artSpec: artSpec(i) }));
    ogImage = `${SITE}/og/${i.id}.png`;
  }
  write(`${i.id}/index.html`, item(i, ogImage));
}

write("404.html", notFound());
write("favicon.svg", faviconSvg);
write("favicon.ico", ico(toPng(faviconSvg.replace(/<style>.*<\/style>/, "").replace("<path ", `<path fill="#D7263D" `), 32)));
write("apple-touch-icon.png", toPng(appleSvg, 180));

// Last known change for a release: its newest timeline entry, else when preorders opened, else the site date.
const lastmod = i => [...i.timeline.map(t => t.date), i.pre].filter(d => d && d <= TODAY).sort().pop() || data.updated;
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${data.updated}</lastmod></url>
${ITEMS.map(i => `  <url><loc>${esc(i.url)}</loc><lastmod>${lastmod(i)}</lastmod></url>`).join("\n")}
</urlset>
`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
write("CNAME", new URL(SITE).hostname + "\n");
write(".nojekyll", "");

console.log(`Built ${ITEMS.length} release pages + homepage into _site/ (today = ${TODAY})`);
