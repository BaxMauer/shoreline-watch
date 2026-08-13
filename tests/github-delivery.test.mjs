import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GitHub workflows pin every third-party action to a full commit", async () => {
  const workflows = await Promise.all([
    readProjectFile(".github/workflows/ci.yml"),
    readProjectFile(".github/workflows/deployment-candidate.yml"),
    readProjectFile(".github/workflows/security.yml"),
  ]);
  const uses = workflows.flatMap((workflow) => [...workflow.matchAll(/^\s*uses:\s+([^\s#]+)/gm)].map((match) => match[1]));
  assert.ok(uses.length >= 7);
  for (const action of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  }
});

test("pull requests block on the production security policy and full validation", async () => {
  const workflow = await readProjectFile(".github/workflows/ci.yml");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm run audit:production/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
});

test("production candidates require a successful main CI run and carry provenance", async () => {
  const workflow = await readProjectFile(".github/workflows/deployment-candidate.yml");
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /write-deployment-manifest\.mjs/);
  assert.match(workflow, /deployment-manifest\.json/);
  assert.match(workflow, /sites\/deployment-candidate/);
});

test("weekly dependency maintenance covers npm, Actions, and the full audit", async () => {
  const [dependabot, security] = await Promise.all([
    readProjectFile(".github/dependabot.yml"),
    readProjectFile(".github/workflows/security.yml"),
  ]);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(security, /schedule:/);
  assert.match(security, /npm run audit:all/);
});
