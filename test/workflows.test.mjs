import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The phone workflows push to main, so these checks guard how they're wired, not what they say.
const ROOT = new URL("..", import.meta.url).pathname;
const wf = name => readFileSync(`${ROOT}.github/workflows/${name}.yml`, "utf8");
const FLOWS = { "post-restock": wf("post-restock"), "sold-out-again": wf("sold-out-again") };

for (const [name, yml] of Object.entries(FLOWS)) {
  test(`${name}: only starts when you run it, and never from a form value inside a script`, () => {
    const on = yml.slice(yml.indexOf("\non:"), yml.indexOf("\npermissions:"));
    assert.match(on, /workflow_dispatch:/);
    assert.doesNotMatch(on, /\b(push|schedule|pull_request|issues|workflow_run):/);
    // Form values only reach the script as environment variables, so a link can't run as a shell command.
    const uses = yml.split("\n").filter(l => /\$\{\{\s*inputs\./.test(l));
    assert.ok(uses.length >= 2);
    for (const l of uses) assert.match(l, /^\s+RESTOCK_[A-Z_]+: \$\{\{ inputs\.[a-z_]+ \}\}$/, l);
    assert.doesNotMatch(yml, /run:[^\n]*\$\{\{/);
  });

  test(`${name}: saves to main only, one edit at a time, then redeploys`, () => {
    assert.match(yml, /permissions:\n  contents: write[^\n]*\n  actions: write/);
    assert.match(yml, /concurrency:\n  group: data-write\n  cancel-in-progress: false/);
    assert.match(yml, /uses: actions\/checkout@v4\n\s+with:\n\s+ref: main\n\s+fetch-depth: 0/);
    assert.match(yml, /node scripts\/restock\.mjs/);
    assert.match(yml, /gh workflow run deploy\.yml --ref main/);
    assert.match(yml, /steps\.record\.outputs\.changed == 'true'/);
  });
}

test("post-restock: the email goes out before the deploy is asked for, and only for a restock", () => {
  const yml = FLOWS["post-restock"];
  assert.match(yml, /RESTOCK_ACTION: restock/);
  assert.ok(yml.indexOf("alerts.mjs send") < yml.indexOf("gh workflow run"));
  assert.match(yml, /if: steps\.record\.outputs\.alert == 'true'/);
  assert.match(yml, /BUTTONDOWN_API_KEY: \$\{\{ secrets\.BUTTONDOWN_API_KEY \}\}/);
  assert.match(yml, /BEFORE: \$\{\{ steps\.record\.outputs\.before \}\}/);
  for (const field of ["item", "retailer", "link"]) assert.match(yml, new RegExp(`      ${field}:\\n        description: [^\\n]+\\n        required: true`));
  assert.match(yml, /source:\n        description: [^\n]+\n        required: false/);
});

test("sold-out-again: never emails", () => {
  const yml = FLOWS["sold-out-again"];
  assert.match(yml, /RESTOCK_ACTION: soldout/);
  assert.doesNotMatch(yml, /alerts\.mjs|BUTTONDOWN/);
});

test("the deploy can be started by hand, and only a real push sends alerts (so a restock isn't emailed twice)", () => {
  const deploy = wf("deploy");
  assert.match(deploy.slice(0, deploy.indexOf("permissions:")), /workflow_dispatch:/);
  assert.match(deploy, /- name: Send alerts for this change\n        if: github\.event_name == 'push'/);
  assert.match(deploy, /- name: Post to social media\n        if: github\.event_name == 'push'/);
});
