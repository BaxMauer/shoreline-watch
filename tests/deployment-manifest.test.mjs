import assert from "node:assert/strict";
import test from "node:test";

import { createDeploymentManifest } from "../scripts/write-deployment-manifest.mjs";

const environment = {
  GITHUB_REPOSITORY: "BaxMauer/shoreline-watch",
  GITHUB_SERVER_URL: "https://github.com/",
  GITHUB_RUN_ID: "200",
  CI_RUN_ID: "100",
  SOURCE_SHA: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
};

test("deployment manifest binds the candidate to the verified main commit", () => {
  const manifest = createDeploymentManifest(environment);
  assert.equal(manifest.source_ref, "refs/heads/main");
  assert.equal(manifest.source_sha, environment.SOURCE_SHA.toLowerCase());
  assert.equal(manifest.verification.run_url, "https://github.com/BaxMauer/shoreline-watch/actions/runs/100");
  assert.equal(manifest.candidate.run_url, "https://github.com/BaxMauer/shoreline-watch/actions/runs/200");
});

test("deployment manifest rejects abbreviated or missing commit hashes", () => {
  assert.throws(() => createDeploymentManifest({ ...environment, SOURCE_SHA: "abc123" }));
  assert.throws(() => createDeploymentManifest({ ...environment, SOURCE_SHA: "" }));
});
