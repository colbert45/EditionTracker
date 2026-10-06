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
// The header date is the later of the last data change and the last news check.
let lastChecked = null;
try { lastChecked = JSON.parse(read("data/last-checked.json")).lastChecked; } catch {}
const HEADER_DATE = [data.updated, lastChecked].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || "")).sort().pop();
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
// Every Amazon link carries the Associates tag (replacing any other tag) and is marked sponsored.
const AMAZON_TAG = config.amazonTag || "";
const isAmazon = u => { try { return /(^|\.)amazon\.[a-z.]+$/i.test(new URL(u).hostname); } catch { return false; } };
const tagged = u => { if (!AMAZON_TAG || !isAmazon(u)) return u; const x = new URL(u); x.searchParams.set("tag", AMAZON_TAG); return x.href; };
// site.config.json "photos" decides where product photos replace the illustrations.
const PHOTOS = config.photos || "all";
const photoOnPage = i => Boolean(i.image) && (PHOTOS === "all" || PHOTOS === "pages");
const photoInList = i => Boolean(i.image) && PHOTOS === "all";

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
[hidden]{display:none!important}
.mast nav{display:flex;align-items:center;gap:16px;margin-left:auto;margin-right:18px;font-size:.92rem;font-weight:600}
.mast nav a{text-decoration:none}
.mast nav a:hover{text-decoration:underline}
.logo b{font-size:2.05rem;white-space:nowrap}
.tag{width:32px;height:22px}
.tag::after{top:8px;right:6px}
.hero-top{margin:26px 0 20px}
.hero-h{font-family:"Barlow Condensed","Arial Narrow",sans-serif;font-weight:800;font-size:clamp(2.6rem,8.5vw,4.6rem);line-height:.95;letter-spacing:-.015em;margin:0 0 12px;text-transform:uppercase}
.hero-h em{font-style:normal;color:var(--red)}
.hero-sub{margin:0 0 16px;font-size:1.12rem;color:var(--soft);max-width:56ch}
.stats{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}
.stats li{padding:5px 12px;border:1.5px solid var(--line);border-radius:999px;font-size:.92rem;color:var(--soft)}
.stats b{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
.carousel{position:relative;margin:4px 0 26px}
.feature{display:grid;grid-auto-flow:column;grid-auto-columns:100%;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:8px}
.feature::-webkit-scrollbar{display:none}
.fphoto{aspect-ratio:16/11;background:#fff;border-radius:6px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.fphoto img{display:block;width:100%;height:100%;object-fit:contain}
.cnav{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:12px}
.cnav>button{width:36px;height:36px;border-radius:50%;border:1.5px solid var(--line);background:transparent;color:var(--ink);font-size:1.5rem;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0 0 3px}
.cnav>button:hover{border-color:var(--ink)}
.dots{display:flex;gap:8px}
.dots button{width:10px;height:10px;border-radius:999px;border:0;padding:0;background:var(--line);cursor:pointer;transition:width .25s,background .25s}
.dots button[aria-current="true"]{width:28px;background:var(--red)}
.cnav button:focus-visible{outline:3px solid var(--red);outline-offset:2px}
.fcard{scroll-snap-align:start;scroll-snap-stop:always;position:relative;overflow:hidden;display:grid;grid-template-columns:1.15fr 1fr;align-items:center;gap:20px;padding:24px 26px;border-radius:8px;background:#16181D;border:1px solid var(--line);color:#ECEEF2;text-decoration:none;min-height:230px}
.fcard::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 28% 55%,var(--glow) 0%,transparent 62%);opacity:.45}
.fart{position:relative;aspect-ratio:200/120;width:100%}
.fart svg{display:block;width:100%;height:100%}
.ftxt{position:relative;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.fkick{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#A2A8B5}
.fname{font-family:"Barlow Condensed","Arial Narrow",sans-serif;font-weight:800;font-size:clamp(1.6rem,4.2vw,2.3rem);line-height:1.02;letter-spacing:-.01em}
.fmeta{color:#A2A8B5;font-size:.95rem}
.fwhen{font-weight:600;font-variant-numeric:tabular-nums}
.fwhen span{color:#A2A8B5;font-weight:500}
.fcard:hover .fname{text-decoration:underline}
.search{display:block;width:100%;max-width:380px;font:inherit;font-size:.98rem;padding:8px 14px;margin:0 0 12px;border:1.5px solid var(--line);border-radius:999px;background:transparent;color:var(--ink)}
.search:focus{outline:3px solid var(--red);outline-offset:1px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
.signup{margin:28px 0 8px;padding:20px 22px;border:1.5px solid var(--line);border-radius:8px;background:var(--row);scroll-margin-top:16px}
.signup h2{margin:0 0 4px;font-family:"Barlow Condensed","Arial Narrow",sans-serif;font-weight:800;font-size:1.5rem;line-height:1.1}
.signup p{margin:0 0 12px;color:var(--soft)}
.signup .row{display:flex;flex-wrap:wrap;gap:8px}
.signup input[type=email]{flex:1 1 220px;min-width:0;font:inherit;font-size:1rem;padding:9px 14px;border:1.5px solid var(--line);border-radius:999px;background:var(--bg);color:var(--ink)}
.signup input[type=email]:focus{outline:3px solid var(--red);outline-offset:1px}
.signup button{font:inherit;font-weight:700;font-size:1rem;padding:9px 20px;border:0;border-radius:999px;background:var(--red);color:#fff;cursor:pointer}
.signup button:hover{filter:brightness(1.08)}
.signup small{display:block;margin-top:8px;color:var(--soft);font-size:.82rem}
.picks{border:0;margin:0 0 12px;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.picks legend{padding:0;margin:0 0 6px;font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--soft)}
.pick{position:relative;cursor:pointer}
.pick input{position:absolute;opacity:0;width:1px;height:1px}
.pick span{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border:1.5px solid var(--line);border-radius:999px;background:var(--bg);font-size:.94rem;font-weight:600;line-height:1.2}
.pick span::before{content:"";width:14px;height:14px;border:1.5px solid var(--soft);border-radius:4px;flex-shrink:0}
.pick input:checked+span{border-color:var(--red);color:var(--ink)}
.pick input:checked+span::before{background:var(--red) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat;border-color:var(--red)}
.pick input:focus-visible+span{outline:3px solid var(--red);outline-offset:2px}
.alert-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 13px 6px 11px;border-radius:999px;background:var(--red);color:#fff;white-space:nowrap;text-decoration:none!important}
.alert-btn:hover{filter:brightness(1.08)}
.alert-me{display:inline-block;padding:4px 12px;border:1.5px solid var(--red);border-radius:999px;font-size:.88rem;font-weight:700;color:var(--red);text-decoration:none;white-space:nowrap}
.alert-me:hover{background:var(--red);color:#fff}
.note .big{font-size:1.15rem;max-width:56ch}
.steps{list-style:none;padding:0}
.steps li{margin:0 0 10px;padding-left:16px;border-left:3px solid var(--red)}
.cta{display:flex;flex-wrap:wrap;align-items:center;gap:18px;margin-top:26px}
.btn{display:inline-block;padding:10px 22px;border-radius:999px;background:var(--red);color:#fff;font-weight:700;text-decoration:none}
.btn:hover{filter:brightness(1.08)}
.cal-month{font-family:"Barlow Condensed","Arial Narrow",sans-serif}
@media (max-width:600px){
  .fcard{grid-template-columns:1fr;gap:10px;padding:18px 18px 20px}
  .fart{max-width:300px}
  .fphoto{max-width:none}
  .logo b{font-size:1.5rem}
  .tag{width:26px;height:18px}
  .tag::after{top:6px;right:5px}
  .mast nav{margin-right:0;gap:12px;align-items:center}
  .mast nav .rss{display:none}
  .alert-btn{padding:5px 11px 5px 9px;font-size:.88rem}
}
@media (max-width:380px){
  .logo{gap:7px}
  .logo b{font-size:1.32rem}
  .mast nav{gap:9px;font-size:.88rem}
  .alert-btn{padding:5px 9px 5px 8px}
}`;

const PRELOAD = ["barlow-latin-400-normal", "barlow-latin-600-normal", "barlow-condensed-latin-800-normal"]
  .map(f => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join("\n");

function analytics() {
  const a = config.analytics || {};
  if (a.provider === "google" && /^G-[A-Z0-9]+$/.test(a.google?.id || ""))
    return `<script async src="https://www.googletagmanager.com/gtag/js?id=${a.google.id}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","${a.google.id}");</script>`;
  if (a.provider === "plausible" && a.plausible?.domain)
    return `<script defer data-domain="${esc(a.plausible.domain)}" src="${esc(a.plausible.script || "https://plausible.io/js/script.js")}"></script>`;
  if (a.provider === "cloudflare" && a.cloudflare?.token)
    return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: a.cloudflare.token })}'></script>`;
  return "";
}

// Alerts signup (Buttondown's embed form). Shown on every indexed page; the header
// "Get alerts" button jumps here. Each box adds a Buttondown tag that scripts/alerts.mjs
// uses to email only the people who asked (see lib/alerts.js).
const BD_USER = /^[a-z0-9_-]+$/i.test(config.newsletter?.buttondown || "") ? config.newsletter.buttondown : "";
function signup(it = null) {
  if (!BD_USER) return "";
  const box = (tag, label, checked) => `<label class="pick"><input type="checkbox" name="tag" value="${esc(tag)}"${checked ? " checked" : ""}><span>${esc(label)}</span></label>`;
  return `<section class="signup" id="alerts" aria-labelledby="signup-h">
    <h2 id="signup-h">Get alerts</h2>
    <p>Pick what you want to hear about. You'll get an email when it's announced, gets a date, opens preorders or sells out. The weekly roundup is optional.</p>
    <form action="https://buttondown.com/api/emails/embed-subscribe/${BD_USER}" method="post" target="_blank">
      ${it ? `<fieldset class="picks"><legend>This release</legend>${box(`item:${it.id}`, it.name, true)}</fieldset>` : ""}
      <fieldset class="picks"><legend>${it ? "Also tell me about" : "Tell me about"}</legend>${Object.entries(CATS).map(([k, v]) => box(`type:${k}`, v, false)).join("")}</fieldset>
      <fieldset class="picks"><legend>Also send me</legend>${box("roundup", "Weekly roundup of everything new", true)}</fieldset>
      <div class="row">
        <label for="signup-email" class="sr-only">Email address</label>
        <input id="signup-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" required>
        <input type="hidden" name="embed" value="1">
        <button type="submit">Subscribe</button>
      </div>
    </form>
    <small>Unsubscribe or change your picks anytime. Powered by Buttondown.</small>
  </section>`;
}

// Jumping to the form puts the cursor in the email box.
const ALERTS_JS = `document.addEventListener("click",e=>{const a=e.target.closest('a[href="#alerts"]');const f=document.getElementById("signup-email");if(!a||!f)return;e.preventDefault();document.getElementById("alerts").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});setTimeout(()=>f.focus({preventScroll:true}),450);history.replaceState(null,"","#alerts")});`;

const minifyJs = s => s.replace(/^\s*\/\/.*$/gm, "").replace(/\n\s*\n/g, "\n").trim();
const HOME_JS = minifyJs(read("lib/client-home.js"));
const ITEM_JS = minifyJs(read("lib/client-item.js"));

function page({ title, description, path, ogImage, ogAlt, jsonld = [], body, script = "", noindex = false, alertItem = null }) {
  const alertsHref = BD_USER ? (noindex ? "/#alerts" : "#alerts") : "";
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
<link rel="alternate" type="application/rss+xml" title="${esc(NAME)}: new and updated releases" href="${SITE}/feed.xml">
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
    <nav aria-label="Site"><a href="/calendar/">Calendar</a><a class="rss" href="/feed.xml">RSS</a>${alertsHref ? `<a class="alert-btn" href="${alertsHref}"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/></svg>Get alerts</a>` : ""}</nav>
    <span class="updated" id="updated">Updated ${long(HEADER_DATE)}</span>
  </header>
  <main id="app">${body}</main>
  ${noindex ? "" : signup(alertItem)}
  <footer>
    <p>Edition Tracker isn't affiliated with Nintendo, Sony, Microsoft or any store. Prices and stock move fast, so double-check before you buy.</p>
    <p>Spotted something I missed? <a href="/contact/">Send a tip</a>. It'll be added once there's a source.</p>
    <p>Some links are affiliate links, so Edition Tracker may earn a commission at no cost to you. As an Amazon Associate I earn from qualifying purchases.</p>
    <p><a href="/calendar/">Release calendar</a> · <a href="/feed.xml">RSS feed</a> · <a href="/contact/">Contact</a> · <a href="/privacy/">Privacy and cookies</a></p>
  </footer>
</div>
${script || alertsHref ? `<script>\n${[script, alertsHref && !noindex ? ALERTS_JS : ""].filter(Boolean).join("\n")}\n</script>\n` : ""}</body>
</html>
`;
}

// ---------- homepage ----------
function thumb(i) {
  return photoInList(i) ? `<img src="${esc(i.image)}" alt="" loading="lazy" decoding="async">` : art(artSpec(i));
}

function rowHTML(i) {
  let sub = "";
  if (i.date && !isOut(i)) { const n = daysOut(i.date); sub = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`; }
  const q = [i.name, i.platform, CATS[i.category], STATUS[i.status], i.searchQuery].join(" ").toLowerCase();
  return `<li data-i="${i.n}" data-q="${esc(q)}" data-cat="${esc(i.category)}" data-status="${esc(i.status)}"${i.date ? ` data-date="${i.date}"` : ""}><a href="${esc(i.path)}">
    <span class="thumb">${thumb(i)}</span>
    <span class="nm">${esc(i.name)}<span class="pf">${esc(i.platform)}, ${esc(i.price)}</span></span>
    <span class="dt">${i.date ? (isOut(i) ? long(i.date) : short(i.date)) : esc(i.when || "TBA")}${sub ? `<span>${sub}</span>` : ""}</span>
    <span>${chip(i.status)}</span></a></li>`;
}

function section(key, title, note, list, alwaysShow) {
  return `<section data-sec="${key}"${!list.length && !alwaysShow ? " hidden" : ""}><h2 class="sec">${title}${note ? ` <small>${note}</small>` : ""}</h2>
    <ul class="list">${list.length ? list.map(rowHTML).join("") : `<li><p class="empty">Nothing here right now.</p></li>`}</ul></section>`;
}

function featureCard(i) {
  let when = i.date ? long(i.date) : (i.when || "TBA"), sub = "";
  if (i.date && !isOut(i)) { const n = daysOut(i.date); sub = n === 0 ? "out today" : n === 1 ? "out tomorrow" : `in ${n} days`; }
  const pic = photoInList(i)
    ? `<span class="fart fphoto"><img src="${esc(i.image)}" alt="" decoding="async"${i.n ? ' loading="lazy"' : ""}></span>`
    : `<span class="fart">${art(artSpec(i))}</span>`;
  return `<a class="fcard" href="${esc(i.path)}" style="--glow:${esc(i.art.colors[0])}">
    ${pic}
    <span class="ftxt">
      <span class="fkick">${esc(CATS[i.category])}</span>
      <span class="fname">${esc(i.name)}</span>
      <span class="fmeta">${esc(i.platform)}, ${esc(i.price)}</span>
      <span class="fwhen"${i.date && !isOut(i) ? ` data-date="${i.date}"` : ""}>${esc(when)}${sub ? ` <span>${sub}</span>` : ""}</span>
      ${chip(i.status)}
    </span></a>`;
}

function home() {
  const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999");
  const coming = ITEMS.filter(i => i.status !== "rumor" && !isOut(i)).sort(byDate);
  const rumors = ITEMS.filter(i => i.status === "rumor");
  const out = ITEMS.filter(i => i.status !== "rumor" && isOut(i)).sort((a, b) => byDate(b, a));
  const chips = [["all", "Everything"]].concat(Object.entries(CATS))
    .map(([k, v]) => `<button type="button" data-cat="${esc(k)}" aria-pressed="${k === "all"}">${esc(v)}</button>`).join("");
  const featuredIds = Array.isArray(data.featured) && data.featured.length ? data.featured : coming.filter(i => i.date).slice(0, 4).map(i => i.id);
  const featured = featuredIds.map(id => ITEMS.find(i => i.id === id)).filter(Boolean);
  for (const i of coming) if (featured.length < 6 && i.date && photoInList(i) && !featured.includes(i)) featured.push(i);
  const count = s => ITEMS.filter(i => i.status === s).length;
  const thisMonth = coming.filter(i => i.date && i.date.slice(0, 7) === TODAY.slice(0, 7)).length;
  const body = `
    <div class="hero-top">
      <h1 class="hero-h">Every special edition, <em>tracked.</em></h1>
      <p class="hero-sub">Consoles, games, controllers and collectibles: when they come out, what they cost, and where to look. Updated daily as news drops.</p>
      <ul class="stats">
        <li><b>${ITEMS.length}</b> tracked</li>
        <li><b>${count("preorder")}</b> preorders open</li>
        ${thisMonth ? `<li><b>${thisMonth}</b> out this month</li>` : ""}
        <li><b>${count("rumor")}</b> rumors</li>
      </ul>
    </div>
    ${featured.length ? `<section class="carousel" aria-roledescription="carousel" aria-label="Featured releases">
      <div class="feature">${featured.map((it, k) => featureCard({ ...it, n: k })).join("")}</div>
      ${featured.length > 1 ? `<div class="cnav">
        <button type="button" class="cprev" aria-label="Previous">&#8249;</button>
        <span class="dots">${featured.map((it, k) => `<button type="button" aria-label="Show ${esc(it.name)}"${k ? "" : ' aria-current="true"'}></button>`).join("")}</span>
        <button type="button" class="cnext" aria-label="Next">&#8250;</button>
      </div>` : ""}
    </section>` : ""}
    <input class="search" type="search" placeholder="Search releases" aria-label="Search releases" autocomplete="off">
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
    title: "Edition Tracker: special edition consoles, games, controllers and collectibles",
    description: "Special edition consoles, games, controllers and collectibles, with release dates, prices and where to buy.",
    path: "/", ogImage: `${SITE}/og/home.png`, ogAlt: "Edition Tracker: special edition consoles, games, controllers and collectibles",
    jsonld, body, script: HOME_JS
  });
}

// ---------- release pages ----------
const STATUS_PHRASE = { rumor: "rumored, not confirmed", announced: "announced", preorder: "preorders open", out: "out now", soldout: "sold out" };

// The "Preorders" fact on a release page.
function preorders(i) {
  if (i.status === "soldout") return "Sold out";
  if (i.status === "preorder") return i.pre ? `Open since ${short(i.pre)}` : "Open";
  if (i.status === "out") return i.pre ? `Opened ${long(i.pre)}` : "Closed";
  return "Not yet";
}

// Seasons and phrases read lowercase mid-sentence ("expected spring 2027"); months and quarters don't.
const midSentence = w => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Q\d|TBA)/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1);

function releasePhrase(i) {
  if (i.date) return isOut(i) ? `released ${long(i.date)}` : `out ${long(i.date)}`;
  return i.when && i.when !== "TBA" ? `expected ${midSentence(i.when)}` : "release date TBA";
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
  const href = tagged(s.affiliateUrl || (st.searchUrl ? st.searchUrl + encodeURIComponent(i.searchQuery) : st.url));
  const rel = isAmazon(href) ? "noopener sponsored" : s.affiliateUrl ? "sponsored noopener" : "noopener";
  return `<tr><td>${esc(st.name)}</td><td>${!s.listed ? `<span class="na">Not listed yet</span>` : `<a href="${esc(href)}" target="_blank" rel="${rel}">Check stock</a>`}</td></tr>`;
}

// Item alerts make sense until it's out, or while it's sold out (restocks).
const wantsAlert = i => i.status === "soldout" || !isOut(i);

// Short enough that Google shows it whole (about 60 characters).
const itemTitle = i => { const t = `${i.name}: release date and price | ${NAME}`; return t.length <= 62 ? t : `${i.name} | ${NAME}`; };

function item(i, ogImage) {
  const n = i.date ? daysOut(i.date) : null;
  const cd = n > 1 ? `Out in ${n} days.` : n === 1 ? "Out tomorrow." : n === 0 ? "Out today." : "";
  const showCountdown = i.date && i.status !== "out" && i.status !== "soldout";
  const hasAmazon = i.stores.some(s => s.listed && (s.store === "amazon" || isAmazon(s.affiliateUrl || "")));
  const hasAffiliate = hasAmazon || i.stores.some(s => s.listed && s.affiliateUrl);
  const hero = photoOnPage(i)
    ? `<figure class="hero" style="margin:0 0 14px"><div class="art"><img src="${esc(i.image)}" alt="${esc(i.name)}" decoding="async"></div><figcaption>${esc(i.imageCredit)}</figcaption></figure>`
    : `<figure class="hero" style="margin:0 0 14px"><div class="art">${art(artSpec(i))}</div><figcaption>Illustration, not a product photo</figcaption></figure>`;
  const body = `<article class="item">
    <a class="back" href="/">Back to all releases</a>
    <h1>${esc(i.name)}</h1>
    <div class="sub"><span>${esc(i.platform)}</span>${chip(i.status)}${BD_USER && wantsAlert(i) ? `<a class="alert-me" href="#alerts">${i.status === "soldout" ? "Alert me on restock" : "Alert me about this"}</a>` : ""}</div>
    ${hero}
    <dl class="facts">
      <div><dt>Price</dt><dd>${esc(i.price)}</dd></div>
      <div><dt>Release</dt><dd>${esc(when(i))}</dd></div>
      <div><dt>Preorders</dt><dd>${preorders(i)}</dd></div>
      <div><dt>Category</dt><dd>${esc(CATS[i.category])}</dd></div>
    </dl>
    ${showCountdown ? `<p class="countdown" data-release="${i.date}"${cd && !isOut(i) ? "" : " hidden"}>${cd && !isOut(i) ? cd : ""}</p>` : ""}
    <h2>Notes</h2>${i.notes.map(p => `<p>${esc(p)}</p>`).join("")}
    ${i.inTheBox.length ? `<h2>What's in the box</h2><ul class="plain">${i.inTheBox.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    <h2>Where to buy</h2>
    ${i.stores.length ? `<table class="stores"><tbody>${i.stores.map(s => storeRow(i, s)).join("")}</tbody></table>
    ${i.stores.some(s => s.listed) ? `<p class="small">Links open the store's search. Stock changes by the hour on these, so check before you head out.</p>` : ""}` : `<p class="small">Not listed yet</p>`}
    ${hasAffiliate ? `<p class="small">Some of these are affiliate links, so Edition Tracker may earn a commission if you buy through them. It doesn't change your price.${hasAmazon ? " As an Amazon Associate I earn from qualifying purchases." : ""}</p>` : ""}
    ${i.timeline.length ? `<h2>Timeline</h2>
    <ul class="tl">${[...i.timeline].sort((a, b) => b.date.localeCompare(a.date)).map(t => `<li><time datetime="${t.date}">${long(t.date)}</time><span>${esc(t.text)}</span></li>`).join("")}</ul>` : ""}
    <h2>Sources</h2>
    <ul class="plain src">${i.sources.map(s => `<li><a href="${esc(tagged(s.url))}" target="_blank" rel="${isAmazon(s.url) ? "noopener sponsored" : "noopener"}">${esc(s.label)}</a></li>`).join("")}</ul>
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
    title: itemTitle(i),
    description, path: i.path, ogImage, ogAlt: photoOnPage(i) ? i.name : `${i.name} (illustration)`,
    jsonld: [product, crumbs], body, script: ITEM_JS, alertItem: wantsAlert(i) ? i : null
  });
}

function calendar() {
  const byDate = (a, b) => a.date.localeCompare(b.date);
  const dated = ITEMS.filter(i => i.status !== "rumor" && i.date && !isOut(i)).sort(byDate);
  const months = new Map();
  for (const i of dated) {
    const m = fmt(i.date, { month: "long", year: "numeric" });
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(i);
  }
  const undated = ITEMS.filter(i => i.status !== "rumor" && !i.date);
  const list = l => `<ul class="list">${l.map(rowHTML).join("")}</ul>`;
  const body = `<article>
    <a class="back" href="/">Back to all releases</a>
    <div class="lede"><p>Every confirmed special edition with a release date, month by month. Rumors aren't included until they're announced.</p></div>
    ${[...months].map(([m, l]) => `<h2 class="sec">${esc(m)} <small>${l.length} release${l.length === 1 ? "" : "s"}</small></h2>${list(l)}`).join("")}
    ${undated.length ? `<h2 class="sec">Date not announced yet</h2>${list(undated)}` : ""}
  </article>`;
  return page({ title: `Special edition release calendar | ${NAME}`,
    description: `Upcoming special and limited edition consoles, controllers, games and collectibles by release month, with prices and where to buy.`,
    path: "/calendar/", ogImage: `${SITE}/og/home.png`, ogAlt: NAME, body,
    jsonld: [{ "@context": "https://schema.org", "@type": "ItemList", name: "Upcoming special edition releases",
      itemListElement: dated.map((i, k) => ({ "@type": "ListItem", position: k + 1, url: i.url, name: i.name })) }] });
}

// Where Buttondown sends people after they subscribe (before confirming) and after they
// confirm. Set both under Buttondown > Settings > Subscribing > Redirects.
function subscribed() {
  const body = `<article class="item note">
    <h1>Check your email</h1>
    <p class="big">One more step: open the email from <b>Edition Tracker</b> (hello@editiontracker.com) and tap <b>Confirm</b>. Nothing gets sent until you do.</p>
    <ul class="plain steps">
      <li><b>Don't see it?</b> Give it a minute, then check Spam or Promotions.</li>
      <li><b>Typo in your email?</b> Just <a href="/#alerts">sign up again</a>.</li>
    </ul>
    <p><a class="back" href="/">Back to all releases</a></p>
  </article>`;
  return page({ title: `Check your email | ${NAME}`, description: "Confirm your Edition Tracker subscription.", path: "/subscribed/",
    ogImage: `${SITE}/og/home.png`, ogAlt: NAME, body, noindex: true });
}

// Privacy and contact pages, linked from every footer.
function privacy() {
  const body = `<article class="item note">
    <h1>Privacy and cookies</h1>
    <p class="big">Edition Tracker doesn't have accounts and doesn't sell your data. Here's everything it collects, and why.</p>
    <h2>If you sign up for alerts</h2>
    <p>Your email address and the boxes you tick (the releases and categories you picked, and whether you want the weekly roundup) are stored by <a href="https://buttondown.com" rel="noopener">Buttondown</a>, which sends the emails. They're only used to send you what you asked for. Every email has a link to change your picks or unsubscribe, and you can email <a href="mailto:hello@editiontracker.com">hello@editiontracker.com</a> to have your address deleted.</p>
    <h2>Analytics and cookies</h2>
    <p>The site uses Google Analytics to count visits and see which pages are popular. It sets cookies (named <code>_ga</code> and <code>_ga_…</code>) and Google receives your IP address, browser and the pages you view. Edition Tracker only sees totals, never who you are. You can block these cookies in your browser settings or with <a href="https://tools.google.com/dlpage/gaoptout" rel="noopener">Google's opt-out add-on</a>, and the site works the same without them. There are no other cookies and no ads.</p>
    <h2>Affiliate links</h2>
    <p>Some "Check stock" links are affiliate links. As an Amazon Associate I earn from qualifying purchases. It doesn't change your price. Once you click through, the store's own privacy policy and cookies apply.</p>
    <h2>Hosting</h2>
    <p>The site is hosted on GitHub Pages, which may log your IP address for security. See <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener">GitHub's privacy statement</a>.</p>
    <h2>Questions</h2>
    <p>Email <a href="mailto:hello@editiontracker.com">hello@editiontracker.com</a>.</p>
    <p class="small">Last updated October 6, 2026.</p>
  </article>`;
  return page({ title: `Privacy and cookies | ${NAME}`, description: "What Edition Tracker collects, which cookies it uses, and how to opt out.",
    path: "/privacy/", ogImage: `${SITE}/og/home.png`, ogAlt: NAME, body });
}

function contact() {
  const body = `<article class="item note">
    <h1>Contact</h1>
    <p class="big">Email <a href="mailto:hello@editiontracker.com"><b>hello@editiontracker.com</b></a> for anything: tips, corrections, partnerships or questions about your alerts.</p>
    <ul class="plain steps">
      <li><b>Spotted an edition that's missing?</b> Send a link to the announcement or store page. It'll be added once there's a source.</li>
      <li><b>Something wrong on a page?</b> Tell me which release and what's off.</li>
      <li><b>Want alerts?</b> Use the form below, or tap <b>Alert me about this</b> on any release page.</li>
    </ul>
  </article>`;
  return page({ title: `Contact | ${NAME}`, description: "Send Edition Tracker a tip, a correction or a question.",
    path: "/contact/", ogImage: `${SITE}/og/home.png`, ogAlt: NAME, body });
}

function welcome() {
  const body = `<article class="item note">
    <h1>You're in.</h1>
    <p class="big">Thanks for subscribing to Edition Tracker. Here's what lands in your inbox:</p>
    <ul class="plain steps">
      <li><b>Alerts</b> for the consoles and releases you picked, when something's announced, gets a release date, opens preorders or sells out.</li>
      <li><b>A short weekly roundup</b> of everything new, if you left that box ticked, so you don't miss what you didn't pick.</li>
    </ul>
    <h2>Make sure they reach you</h2>
    <p>Add <b>hello@editiontracker.com</b> to your contacts. Preorders can sell out within hours, so you don't want an alert sitting in Spam.</p>
    <h2>Change your picks anytime</h2>
    <p>Every email has a link at the bottom to add or remove consoles and releases, or unsubscribe. Or tap <b>Alert me about this</b> on any release page.</p>
    <p class="cta"><a class="btn" href="/">Browse the releases</a> <a class="back" href="/calendar/">Release calendar</a></p>
  </article>`;
  return page({ title: `Welcome | ${NAME}`, description: "You're subscribed to Edition Tracker.", path: "/welcome/",
    ogImage: `${SITE}/og/home.png`, ogAlt: NAME, body, noindex: true });
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
  if (photoOnPage(i) && isRaster(i.image)) ogImage = absUrl(i.image);
  else {
    png(i.id, itemCardSvg({ name: i.name, platform: i.platform, price: i.price, statusKey: i.status,
      statusLabel: STATUS[i.status], releaseText: i.date ? `Out ${long(i.date)}` : `Release: ${i.when}`, artSpec: artSpec(i) }));
    ogImage = `${SITE}/og/${i.id}.png`;
  }
  write(`${i.id}/index.html`, item(i, ogImage));
}

write("404.html", notFound());
write("subscribed/index.html", subscribed());
write("welcome/index.html", welcome());
write("privacy/index.html", privacy());
write("contact/index.html", contact());
write("feed.xsl", read("lib/feed.xsl"));
write("calendar/index.html", calendar());
write("favicon.svg", faviconSvg);
write("favicon.ico", ico(toPng(faviconSvg.replace(/<style>.*<\/style>/, "").replace("<path ", `<path fill="#D7263D" `), 32)));
write("apple-touch-icon.png", toPng(appleSvg, 180));

// Last known change for a release: its newest timeline entry, else when preorders opened, else the site date.
const lastmod = i => [...i.timeline.map(t => t.date), i.pre].filter(d => d && d <= TODAY).sort().pop() || data.updated;
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${data.updated}</lastmod></url>
  <url><loc>${SITE}/calendar/</loc><lastmod>${data.updated}</lastmod></url>
${ITEMS.map(i => `  <url><loc>${esc(i.url)}</loc><lastmod>${lastmod(i)}</lastmod></url>`).join("\n")}
</urlset>
`);
// RSS feed: one entry per release, newest change first. The guid changes with each
// update, so feed readers, Discord bots and email tools see updated releases as new.
const rfc822 = d => new Date(d + "T12:00:00Z").toUTCString();
const feedItems = [...ITEMS].sort((a, b) => lastmod(b).localeCompare(lastmod(a)) || a.n - b.n);
write("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(NAME)}</title>
  <link>${SITE}/</link>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>New and updated special edition consoles, games, controllers and collectibles.</description>
  <language>en-us</language>
  <lastBuildDate>${rfc822(HEADER_DATE)}</lastBuildDate>
${feedItems.map(i => `  <item>
    <title>${esc(i.name)}${i.status === "rumor" ? " (rumor)" : ""}</title>
    <link>${esc(i.url)}</link>
    <guid isPermaLink="false">${esc(i.url)}#${lastmod(i)}-${esc(i.status)}</guid>
    <pubDate>${rfc822(lastmod(i))}</pubDate>
    <category>${esc(CATS[i.category])}</category>
    <description>${esc((i.timeline.length ? [...i.timeline].sort((a, b) => b.date.localeCompare(a.date))[0].text + " " : "") + describe(i))}</description>
  </item>`).join("\n")}
</channel>
</rss>
`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
write("CNAME", new URL(SITE).hostname + "\n");
write(".nojekyll", "");

console.log(`Built ${ITEMS.length} release pages + homepage into _site/ (today = ${TODAY})`);
