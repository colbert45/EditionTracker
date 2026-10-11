// Preloaded into a script under test (node --import <this file> script.mjs). Every fetch() is written to the file in
// FAKE_FETCH_LOG instead of going anywhere, and answered with a made-up success, so a test can read exactly what a
// script would have sent to Bluesky, X or Discord. Nothing leaves the machine.
import { appendFileSync } from "node:fs";

globalThis.fetch = async (url, opts = {}) => {
  const body = typeof opts.body === "string" ? opts.body : opts.body ? "(binary)" : null;
  appendFileSync(process.env.FAKE_FETCH_LOG, JSON.stringify({ url: String(url), method: opts.method || "GET", body }) + "\n");
  const reply = String(url).includes("createSession") ? { accessJwt: "fake-jwt", did: "did:plc:fake" } : {};
  return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
};
