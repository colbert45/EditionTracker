// Builds a throwaway copy of the site so a test can change the data or config
// without touching the real files. Returns the folder it built in.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, cpSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
export const readReal = p => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

export function buildCopy({ data, config, costs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "et-"));
  for (const p of ["lib", "scripts", "static", "og", "package.json"]) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "site.config.json"), JSON.stringify(config || readReal("site.config.json")));
  writeFileSync(join(dir, "data/releases.json"), JSON.stringify(data || readReal("data/releases.json")));
  writeFileSync(join(dir, "data/costs.json"), JSON.stringify(costs || readReal("data/costs.json")));
  execFileSync("node", ["scripts/build.mjs"], { cwd: dir });
  return dir;
}
export const page = (dir, path) => readFileSync(join(dir, "_site", path, "index.html"), "utf8");
