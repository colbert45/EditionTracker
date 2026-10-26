// Preloaded into scripts/news-check.mjs under test: answers X's search, Claude and Best Buy from files, and writes every
// request (address, method, Authorization header present or not) to FAKE_FETCH_LOG. Nothing leaves the machine.
//   FAKE_X       a JSON file with X's answer          FAKE_CLAUDE  a JSON file with { proposals: [...] }
//   FAKE_BESTBUY a JSON file with Best Buy's answer
import { appendFileSync, readFileSync } from "node:fs";
const answer = (file, wrap = x => x) => new Response(JSON.stringify(wrap(JSON.parse(readFileSync(file, "utf8")))), { status: 200, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  const headers = new Headers(init.headers || input?.headers || {});
  appendFileSync(process.env.FAKE_FETCH_LOG, JSON.stringify({ url, method: init.method || "GET", auth: headers.get("authorization") || "" }) + "\n");
  if (url.startsWith("https://api.x.com/")) return answer(process.env.FAKE_X);
  if (url.startsWith("https://api.anthropic.com/")) return answer(process.env.FAKE_CLAUDE, p => ({
    id: "msg_test", type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn", stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify(p) }], usage: { input_tokens: 1, output_tokens: 1 } }));
  if (url.startsWith("https://api.bestbuy.com/")) return answer(process.env.FAKE_BESTBUY);
  return new Response("not faked", { status: 404 });
};
