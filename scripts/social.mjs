// Social posts.
//   node scripts/social.mjs <before-sha> [--dry-run]   post what changed since <before-sha>
//   node scripts/social.mjs --text "..." [--image path] [--dry-run]   post one message of your own
// Posts to Bluesky when BLUESKY_APP_PASSWORD is set, and to X when the four X_* keys are set.
// Without them, or with --dry-run, it only prints what it would post.
// [no alerts] or [no posts] in a commit message skips posting for that push.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { socialPosts } from "../lib/social.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(ROOT, p), "utf8");
const config = JSON.parse(read("site.config.json"));
const data = JSON.parse(read("data/releases.json"));
const env = process.env;
const DRY = process.argv.includes("--dry-run");
const MAX_POSTS = 8; // a bigger batch than this is almost always a bulk edit, not news

const bsky = { handle: config.social?.bluesky, password: env.BLUESKY_APP_PASSWORD };
const x = { key: env.X_API_KEY, secret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_TOKEN_SECRET };
const useBsky = !DRY && bsky.handle && bsky.password;
const useX = !DRY && x.key && x.secret && x.token && x.tokenSecret;

async function request(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---------- Bluesky ----------
const BSKY = "https://bsky.social/xrpc";
let session = null;
async function bskyPost(p) {
  session ??= await request(`${BSKY}/com.atproto.server.createSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: bsky.handle, password: bsky.password })
  });
  const auth = { Authorization: `Bearer ${session.accessJwt}` };
  // Link card with the product photo, when there's a local one.
  let thumb;
  const local = p.imageFile || (p.image && p.image.startsWith("/") ? join(ROOT, "static", p.image) : null);
  if (local && existsSync(local)) {
    const up = await request(`${BSKY}/com.atproto.repo.uploadBlob`, {
      method: "POST", headers: { ...auth, "Content-Type": local.endsWith(".png") ? "image/png" : "image/jpeg" }, body: readFileSync(local)
    });
    thumb = up.blob;
  }
  // Make the link in the text clickable (positions are in UTF-8 bytes).
  const at = p.text.lastIndexOf(p.url);
  const byteStart = Buffer.byteLength(p.text.slice(0, at));
  const record = {
    $type: "app.bsky.feed.post", text: p.text, createdAt: new Date().toISOString(), langs: ["en"],
    facets: [{ index: { byteStart, byteEnd: byteStart + Buffer.byteLength(p.url) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: p.url }] }],
    embed: { $type: "app.bsky.embed.external", external: { uri: p.url, title: p.title, description: p.description, ...(thumb ? { thumb } : {}) } }
  };
  await request(`${BSKY}/com.atproto.repo.createRecord`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record })
  });
}

// ---------- X ----------
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method, url) {
  const o = {
    oauth_consumer_key: x.key, oauth_nonce: randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: x.token, oauth_version: "1.0"
  };
  const params = Object.keys(o).sort().map(k => `${enc(k)}=${enc(o[k])}`).join("&");
  const base = [method, enc(url), enc(params)].join("&");
  o.oauth_signature = createHmac("sha1", `${enc(x.secret)}&${enc(x.tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(o).sort().map(k => `${enc(k)}="${enc(o[k])}"`).join(", ");
}
async function xPost(p) {
  // X builds the link card (with the photo) from the page's own preview tags.
  const url = "https://api.x.com/2/tweets";
  await request(url, {
    method: "POST", headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" },
    body: JSON.stringify({ text: p.text })
  });
}

// ---------- main ----------
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

// One message of your own (the "Post to social" action).
const ownText = arg("--text");
if (ownText !== undefined) {
  const text = ownText.trim();
  if (!text) { console.log("Nothing to post."); process.exit(1); }
  if (text.length > 280) { console.log(`Too long for X: ${text.length} characters (limit 280).`); process.exit(1); }
  const url = (text.match(/https?:\/\/\S+/) || [])[0] || config.siteUrl;
  const p = { text, url, title: config.siteName, description: "Special edition consoles, controllers, games and collectibles: release dates, prices and where to buy.", imageFile: arg("--image") };
  if (!text.includes(url)) p.text = `${text}\n${url}`;
  console.log(`${useBsky || useX ? "Posting" : "Dry run, would post"}:\n${p.text}`);
  let failed = 0;
  for (const [name, on, fn] of [["Bluesky", useBsky, bskyPost], ["X", useX, xPost]]) {
    if (!on) continue;
    try { await fn(p); console.log(`  posted to ${name}`); }
    catch (e) { failed++; console.log(`  ${name} failed: ${e.message}`); }
  }
  process.exit(failed ? 1 : 0);
}

const beforeSha = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
if (!beforeSha || /^0+$/.test(beforeSha)) { console.log("No previous commit to compare with. Nothing to post."); process.exit(0); }
const msg = execFileSync("git", ["log", "--format=%B", `${beforeSha}..HEAD`], { cwd: ROOT, encoding: "utf8" });
if (/\[no (alerts|posts)\]/i.test(msg)) { console.log("A commit says [no alerts] or [no posts]. Not posting."); process.exit(0); }
let oldData;
try { oldData = JSON.parse(execFileSync("git", ["show", `${beforeSha}:data/releases.json`], { cwd: ROOT, encoding: "utf8" })); }
catch { console.log("Couldn't read the previous releases.json. Nothing to post."); process.exit(0); }

const posts = socialPosts(oldData, data, config.siteUrl);
if (!posts.length) { console.log("No release news worth a post."); process.exit(0); }
if (posts.length > MAX_POSTS) { console.log(`${posts.length} posts at once looks like a bulk edit. Not posting.`); process.exit(0); }
if (!useBsky && !useX) console.log("Dry run (no Bluesky or X keys, or --dry-run). Would post:");

let failed = 0;
for (const p of posts) {
  console.log(`\n---\n${p.text}`);
  for (const [name, on, fn] of [["Bluesky", useBsky, bskyPost], ["X", useX, xPost]]) {
    if (!on) continue;
    try { await fn(p); console.log(`  posted to ${name}`); }
    catch (e) { failed++; console.log(`  ${name} failed: ${e.message}`); }
  }
}
if (failed) process.exit(1);
