import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, robotsAllows, matchesKeywords } from "../lib/feeds.js";

test("parses RSS items", () => {
  const xml = `<rss><channel><item><title><![CDATA[Xbox reveals &quot;X25&quot; Limited Edition]]></title>
    <link>https://example.com/a</link><pubDate>Fri, 02 Oct 2026 14:00:00 GMT</pubDate>
    <description>&lt;p&gt;Translucent green.&lt;/p&gt;</description></item></channel></rss>`;
  const [e] = parseFeed(xml);
  assert.equal(e.title, 'Xbox reveals "X25" Limited Edition');
  assert.equal(e.link, "https://example.com/a");
  assert.equal(e.published, "2026-10-02T14:00:00.000Z");
  assert.equal(e.summary, "Translucent green.");
});

test("parses Atom entries", () => {
  const xml = `<feed><entry><title>New DualSense</title><link rel="alternate" href="https://example.com/b"/>
    <updated>2026-10-01T10:00:00Z</updated><summary>Limited edition</summary></entry></feed>`;
  assert.deepEqual(parseFeed(xml)[0], { title: "New DualSense", link: "https://example.com/b", published: "2026-10-01T10:00:00.000Z", summary: "Limited edition" });
});

test("robots.txt rules", () => {
  const ua = "EditionTrackerNewsCheck/1.0";
  assert.equal(robotsAllows("User-agent: *\nDisallow: /", ua, "/feed"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /admin\n", ua, "/feed"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /\nAllow: /feed", ua, "/feed/"), true);
  assert.equal(robotsAllows("User-agent: editiontrackernewscheck\nDisallow: /feeds\n\nUser-agent: *\nAllow: /", ua, "/feeds/latest"), false);
  assert.equal(robotsAllows("", ua, "/anything"), true);
});

test("keywords", () => {
  assert.ok(matchesKeywords("Zelda Collector's Edition leaks", ["collector's edition"]));
  assert.ok(!matchesKeywords("Patch notes 1.2", ["limited edition"]));
});
