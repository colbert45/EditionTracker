import { test } from "node:test";
import assert from "node:assert/strict";
import { isDiscordWebhook, discordEscape, postToDiscord } from "../lib/discord.js";

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abc_DEF-123";

test("only a real Discord webhook link is accepted", () => {
  assert.ok(isDiscordWebhook(HOOK));
  assert.ok(isDiscordWebhook(HOOK.replace("discord.com", "discordapp.com")));
  for (const bad of ["", undefined, null, "https://example.com/api/webhooks/123/abc", "http://discord.com/api/webhooks/123/abc",
    "https://discord.com.evil.test/api/webhooks/123/abc", "https://discord.com/api/webhooks/abc/def", "https://discord.com/api/webhooks/123/abc?thread_id=1",
    "https://discord.com/api/webhooks/123", "https://user@discord.com/api/webhooks/123/abc", "https://discord.com:8443/api/webhooks/123/abc"]) {
    assert.equal(isDiscordWebhook(bad), false, String(bad));
  }
});

test("formatting characters in a name are escaped", () => {
  assert.equal(discordEscape("Zelda *Edition* _of_ ~Time~ `x` a|b > c \\"), "Zelda \\*Edition\\* \\_of\\_ \\~Time\\~ \\`x\\` a\\|b \\> c \\\\");
  assert.equal(discordEscape("Pokémon Red & Blue"), "Pokémon Red & Blue");
});

test("a post is sent as JSON that can't ping anyone, and a refusal says why without the link", async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204, text: async () => "" }; };
  await postToDiscord(HOOK, "Back in stock: X", ok);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, HOOK);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { content: "Back in stock: X", username: "Edition Tracker", allowed_mentions: { parse: [] } });
  // Over Discord's 2000 character limit: cut, not rejected.
  await postToDiscord(HOOK, "x".repeat(2500), ok);
  assert.equal(JSON.parse(calls[1].init.body).content.length, 2000);
  // Discord says no: the error mentions the status and Discord's reason, never the secret link.
  const no = async () => ({ ok: false, status: 429, text: async () => '{"message":"You are being rate limited."}' });
  await assert.rejects(() => postToDiscord(HOOK, "hi", no), e => /429/.test(e.message) && /rate limited/.test(e.message) && !e.message.includes("abc_DEF"));
  // A link that isn't Discord's is refused before anything is sent.
  await assert.rejects(() => postToDiscord("https://example.com/hook", "hi", ok), /isn't a Discord webhook link/);
  assert.equal(calls.length, 2);
});
