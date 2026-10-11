// Finding a product's main image on a web page. Pure functions (no network), used by scripts/fetch-images.mjs.
import { decode } from "./feeds.js";

// The page's share image (the picture a link to it shows): og:image, then twitter:image.
export function shareImage(html, base) {
  for (const re of [/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i, /<meta[^>]+name=["']twitter:image["'][^>]*>/i]) {
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) return new URL(decode(content), base).href;
  }
  return null;
}

const isType = (node, type) => [].concat(node?.["@type"] ?? []).some(t => String(t).toLowerCase() === type);
const asUrl = (v, base) => {
  const raw = typeof v === "string" ? v : v && typeof v === "object" ? v.url || v.contentUrl : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try { return new URL(raw.trim(), base).href; } catch { return null; }
};

// A shop page often has no share image but lists the product's pictures in its structured data (JSON-LD).
// Only a Product's own image counts: a company logo in the same data is not the product.
export function productImage(html, base) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const raw of scripts) {
    let data;
    for (const text of [raw, decode(raw)]) { try { data = JSON.parse(text.trim()); break; } catch { /* try the decoded text */ } }
    if (!data) continue;
    const stack = [data];
    while (stack.length) {
      const node = stack.shift();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== "object") continue;
      if (isType(node, "product")) {
        for (const candidate of [].concat(node.image ?? [])) { const url = asUrl(candidate, base); if (url) return url; }
      }
      stack.push(...Object.values(node).filter(v => v && typeof v === "object"));
    }
  }
  return null;
}
