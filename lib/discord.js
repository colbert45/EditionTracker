// Posting to a Discord channel through a webhook. A webhook link is a secret: anyone who has it can
// post in the channel, so it only ever comes from the DISCORD_WEBHOOK_URL secret, and it's never printed.

export const isDiscordWebhook = url => /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(String(url || ""));

// Discord treats * _ ~ ` | > as formatting, so a release name can't be allowed to use them.
export const discordEscape = s => String(s ?? "").replace(/([*_~`|>\\])/g, "\\$1");

// `fetchImpl` is only there so the tests can check what would be sent.
export async function postToDiscord(url, content, fetchImpl = fetch) {
  if (!isDiscordWebhook(url)) throw new Error("DISCORD_WEBHOOK_URL isn't a Discord webhook link");
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // allowed_mentions with nothing in it means a post can never ping @everyone or anyone else.
    body: JSON.stringify({ content: String(content).slice(0, 2000), username: "Edition Tracker", allowed_mentions: { parse: [] } })
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
