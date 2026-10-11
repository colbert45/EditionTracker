import { test } from "node:test";
import assert from "node:assert/strict";
import { shareImage, productImage } from "../lib/images.js";

const BASE = "https://shop.example/products/thing";
const page = (head, body = "") => `<html><head>${head}</head><body>${body}</body></html>`;
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

test("the share image is the page's og:image, then its twitter:image, with the address made complete", () => {
  assert.equal(shareImage(page('<meta property="og:image" content="https://cdn.example/a.jpg">'), BASE), "https://cdn.example/a.jpg");
  assert.equal(shareImage(page('<meta name="twitter:image" content="/img/b.jpg">'), BASE), "https://shop.example/img/b.jpg");
  assert.equal(shareImage(page('<meta property="og:image" content="//cdn.example/c.jpg?w=1&amp;h=2">'), BASE), "https://cdn.example/c.jpg?w=1&h=2");
  assert.equal(shareImage(page('<meta property="og:title" content="x">'), BASE), null);
});

test("with no share image, a Product's picture in the page's structured data is used", () => {
  assert.equal(productImage(page(ld({ "@type": "Product", name: "Thing", image: ["https://cdn.example/p1.jpg", "https://cdn.example/p2.jpg"] })), BASE), "https://cdn.example/p1.jpg");
  assert.equal(productImage(page(ld({ "@type": "Product", image: "/img/p.jpg" })), BASE), "https://shop.example/img/p.jpg");
  assert.equal(productImage(page(ld({ "@type": "Product", image: { "@type": "ImageObject", url: "https://cdn.example/o.jpg" } })), BASE), "https://cdn.example/o.jpg");
  // Inside a graph, a list, or a Product with several types.
  assert.equal(productImage(page(ld({ "@graph": [{ "@type": "Organization", logo: "https://cdn.example/logo.png" }, { "@type": ["Product", "Thing"], image: ["https://cdn.example/g.jpg"] }] })), BASE), "https://cdn.example/g.jpg");
  assert.equal(productImage(page(ld([{ "@type": "BreadcrumbList" }, { "@type": "Product", image: "https://cdn.example/l.jpg" }])), BASE), "https://cdn.example/l.jpg");
});

test("a company logo or a page that isn't about a product gives nothing", () => {
  assert.equal(productImage(page(ld({ "@type": "Organization", logo: "https://cdn.example/logo.png", image: "https://cdn.example/banner.jpg" })), BASE), null);
  assert.equal(productImage(page(ld({ "@type": "Article", image: "https://cdn.example/news.jpg" })), BASE), null);
  assert.equal(productImage(page('<script type="application/ld+json">{ not json</script>'), BASE), null);
  assert.equal(productImage(page("<p>nothing here</p>"), BASE), null);
  assert.equal(productImage(page(ld({ "@type": "Product", image: "" })), BASE), null);
});
