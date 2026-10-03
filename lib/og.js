// Share-preview images (1200x630 PNG) for Reddit, Discord, etc. These sites can't show
// SVG, so each page gets a PNG drawn from the same illustration the page uses.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { art } from "./art.js";

const W = 1200, H = 630;
const INK = "#16181D", SOFT = "#5B6170", RED = "#D7263D", ROW = "#F6F7F9", LINE = "#E3E5EA";
const STATUS_COLORS = {
  rumor: ["#6B5B95", "#EFECF6"], announced: ["#2563A8", "#E7F0FA"], preorder: ["#8A5A00", "#FDF1D6"],
  out: ["#1E7A4C", "#E3F4EA"], soldout: ["#B42335", "#FBE6E9"]
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Place one of the design's 200x120 drawings at x,y with a given width.
const placeArt = (spec, x, y, w) => art(spec).replace("<svg ", `<svg x="${x}" y="${y}" width="${w}" height="${w * 0.6}" `);

// Rough text wrapping. Widths are estimates for Barlow Condensed ExtraBold, kept on the safe side.
function wrap(text, size, maxWidth) {
  const perChar = size * 0.44;
  const max = Math.max(4, Math.floor(maxWidth / perChar));
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= max) line += " " + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function masthead() {
  // The logo tag from the design (26x18, corner radii 3/9/9/3, hole on the right), scaled up.
  const s = 2.4, x = 72, y = 70;
  return `<g transform="translate(${x} ${y}) scale(${s})">
      <path d="M3 0H17A9 9 0 0 1 17 18H3A3 3 0 0 1 0 15V3A3 3 0 0 1 3 0Z" fill="${RED}"/>
      <circle cx="18" cy="9" r="3" fill="#FFFFFF"/></g>
    <text x="${x + 26 * s + 22}" y="${y + 37}" font-family="Barlow Condensed" font-weight="800" font-size="50" fill="${INK}">edition tracker</text>
    <rect x="72" y="138" width="${W - 144}" height="6" fill="${INK}"/>`;
}

function render(svgInner) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#FFFFFF"/>${svgInner}</svg>`;
  return svg;
}

export function itemCardSvg({ name, platform, price, statusKey, statusLabel, releaseText, artSpec }) {
  const colW = 600;
  let size = 76, lines;
  for (size of [76, 68, 60, 54]) { lines = wrap(name, size, colW); if (lines.length <= 3) break; }
  if (lines.length > 4) { lines = lines.slice(0, 4); lines[3] = lines[3].replace(/\s*\S*$/, "") + "…"; }
  const lh = size * 1.02;
  const top = 200 + size * 0.8;
  const title = lines.map((l, i) => `<tspan x="72" y="${top + i * lh}">${esc(l)}</tspan>`).join("");
  const after = top + (lines.length - 1) * lh;
  const [c, t] = STATUS_COLORS[statusKey] || [INK, ROW];
  const chipW = Math.round(statusLabel.length * 15.5 + 36);
  const metaY = Math.min(after + 70, 520);
  return render(`${masthead()}
    <text font-family="Barlow Condensed" font-weight="800" font-size="${size}" fill="${INK}">${title}</text>
    <text x="72" y="${metaY}" font-family="Barlow" font-weight="500" font-size="32" fill="${SOFT}">${esc(platform)}, ${esc(price)}</text>
    <rect x="72" y="${metaY + 28}" width="${chipW}" height="46" rx="8" fill="${t}"/>
    <text x="${72 + chipW / 2}" y="${metaY + 61}" text-anchor="middle" font-family="Barlow" font-weight="700" font-size="27" fill="${c}">${esc(statusLabel)}</text>
    <text x="${72 + chipW + 22}" y="${metaY + 62}" font-family="Barlow Condensed" font-weight="700" font-size="34" fill="${INK}">${esc(releaseText)}</text>
    <rect x="700" y="190" width="428" height="340" rx="12" fill="${ROW}"/>
    ${placeArt(artSpec, 724, 236, 380)}
    <rect x="72" y="${H - 34}" width="${W - 144}" height="2" fill="${LINE}"/>`);
}

export function homeCardSvg() {
  return render(`${masthead()}
    <text font-family="Barlow Condensed" font-weight="800" font-size="74" fill="${INK}">
      <tspan x="72" y="250">Special edition consoles,</tspan><tspan x="72" y="326">controllers and collectibles</tspan></text>
    <text x="72" y="388" font-family="Barlow" font-weight="500" font-size="32" fill="${SOFT}">When they come out, what they cost, and where to look.</text>
    ${placeArt(["hybrid", "#1F6B45", "#C9A23A", "#14161A"], 60, 420, 330)}
    ${placeArt(["pad", "#F2F0EC", "#7A5CC7", "#3BB6D9"], 420, 420, 330)}
    ${placeArt(["tower", "#3DBB4A", "#1C2B1E", "#9BE07A"], 800, 420, 330)}`);
}

let fontFiles;
export function toPng(svg, width = W) {
  fontFiles ??= readdirSync(new URL("../og/fonts/", import.meta.url)).filter(f => f.endsWith(".ttf"))
    .map(f => join(new URL("../og/fonts/", import.meta.url).pathname, f));
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Barlow" },
    background: "rgba(0,0,0,0)"
  });
  return r.render().asPng();
}
