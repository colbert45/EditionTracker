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

  test(`${name}: saves to main only, then redeploys`, () => {
    assert.match(yml, /permissions:\n  contents: write[^\n]*\n  actions: write/);
    // No concurrency group: GitHub keeps one waiting run per group and silently cancels the older one,
    // which would drop a restock. restock.mjs handles two runs colliding by starting again from the latest main.
    assert.doesNotMatch(yml, /^concurrency:/m);
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
  for (const field of ["item", "link"]) assert.match(yml, new RegExp(`      ${field}:\\n        description: [^\\n]+\\n        required: true`));
  // The store is read from the link, so it's optional (and so is the source).
  for (const field of ["retailer", "source"]) assert.match(yml, new RegExp(`      ${field}:\\n        description: [^\\n]+\\n        required: false`));
  assert.ok(yml.indexOf("      item:") < yml.indexOf("      link:") && yml.indexOf("      link:") < yml.indexOf("      retailer:"), "the required boxes come first");
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

test("resend-restock-email: only on request, only for a restock commit, and a dry run sends nothing", () => {
  const yml = wf("resend-restock-email");
  const on = yml.slice(yml.indexOf("\non:"), yml.indexOf("\npermissions:"));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /\b(push|schedule|pull_request|issues|workflow_run):/);
  assert.match(yml, /permissions:\n  contents: read\n/); // it never writes to the repo
  assert.doesNotMatch(yml, /run:[^\n]*\$\{\{/); // form values only reach scripts through env
  assert.match(yml, /DRY_RUN: \$\{\{ inputs\.dry_run \}\}/);
  assert.match(yml, /BUTTONDOWN_API_KEY: \$\{\{ secrets\.BUTTONDOWN_API_KEY \}\}/);
  assert.match(yml, /ref: main\n\s+fetch-depth: 2/); // it needs the commit before the restock
  assert.match(yml, /"Back in stock: "\*\)/); // the guard
  assert.ok(yml.indexOf('"Back in stock: "*)') < yml.indexOf("alerts.mjs send HEAD~1"), "guard comes before the send");
  assert.match(yml, /\[ "\$DRY_RUN" = "true" \]; then FLAG="--dry-run"/);
  assert.match(yml, /alerts\.mjs send HEAD~1 \$FLAG/);
});

test("post-restock points at the resend workflow", () => {
  assert.match(FLOWS["post-restock"], /run "Resend restock email"/);
});

test("in all three phone workflows, an expression is only ever an env value or an if: condition, never part of a script", () => {
  for (const name of ["post-restock", "sold-out-again", "resend-restock-email"]) {
    const lines = wf(name).split("\n").filter(l => l.includes("${{"));
    assert.ok(lines.length >= 2, name);
    for (const l of lines) {
      assert.match(l, /^\s+(?:[A-Z_]+: \$\{\{ [^}]+ \}\}|if: (?:\$\{\{ [^}]+ \}\}|steps\.[^\n]*))$/, `${name}: ${l}`);
    }
  }
});

test("post-restock posts to Bluesky and Discord after the email, never to X, and a failed post doesn't fail the run", () => {
  const yml = FLOWS["post-restock"];
  const step = yml.slice(yml.indexOf("- name: Post to Bluesky and Discord"), yml.indexOf("- name: Redeploy the site"));
  assert.match(step, /if: steps\.record\.outputs\.alert == 'true'/);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /BLUESKY_APP_PASSWORD: \$\{\{ secrets\.BLUESKY_APP_PASSWORD \}\}/);
  assert.match(step, /DISCORD_WEBHOOK_URL: \$\{\{ secrets\.DISCORD_WEBHOOK_URL \}\}/);
  assert.match(step, /BEFORE: \$\{\{ steps\.record\.outputs\.before \}\}/);
  assert.match(step, /run: node scripts\/social\.mjs "\$BEFORE"/);
  assert.doesNotMatch(step, /X_API|X_ACCESS/); // X charges for every post, so a restock never reaches it from here
  assert.ok(yml.indexOf("alerts.mjs send") < yml.indexOf("scripts/social.mjs") && yml.indexOf("scripts/social.mjs") < yml.indexOf("gh workflow run"));
  // The deploy's own social step gets the Discord link too, so a restock merged from the news check is posted.
  const deploy = wf("deploy");
  assert.match(deploy.slice(deploy.indexOf("- name: Post to social media")), /DISCORD_WEBHOOK_URL: \$\{\{ secrets\.DISCORD_WEBHOOK_URL \}\}/);
  // The other two workflows have nothing to post.
  assert.doesNotMatch(FLOWS["sold-out-again"], /social\.mjs/);
  assert.doesNotMatch(wf("resend-restock-email"), /social\.mjs/);
});
