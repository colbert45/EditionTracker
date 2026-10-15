// Preloaded into scripts/stock-check.mjs under test: Best Buy's address is answered from the JSON file named in
// FAKE_BESTBUY (or with the status in FAKE_BESTBUY_STATUS), and every request is written to FAKE_FETCH_LOG. Nothing leaves the machine.
import { appendFileSync, readFileSync } from "node:fs";
globalThis.fetch = async url => {
  appendFileSync(process.env.FAKE_FETCH_LOG, JSON.stringify({ url: String(url) }) + "\n");
  if (process.env.FAKE_BESTBUY_THROW) throw new Error(`network trouble reaching ${url}`); // an error that repeats the address, key and all
  const status = Number(process.env.FAKE_BESTBUY_STATUS || 200);
  if (status !== 200) return new Response("{}", { status });
  return new Response(readFileSync(process.env.FAKE_BESTBUY, "utf8"), { status: 200, headers: { "Content-Type": "application/json" } });
};
