import assert from "node:assert/strict";
import test from "node:test";

import {
  checkReleaseVersion,
  isReleaseVersionGreater,
  requiresReleaseVersionBump,
} from "../scripts/check-release-version.mjs";

test("release versions must increase semantically", () => {
  assert.equal(isReleaseVersionGreater("1.3.1", "1.3.0"), true);
  assert.equal(isReleaseVersionGreater("1.4.0", "1.3.9"), true);
  assert.equal(isReleaseVersionGreater("2.0.0", "1.99.99"), true);
  assert.equal(isReleaseVersionGreater("1.3.0", "1.3.0"), false);
  assert.equal(isReleaseVersionGreater("1.2.9", "1.3.0"), false);
});

test("documentation, workflow, and test-only changes do not require a release bump", () => {
  assert.equal(requiresReleaseVersionBump(["README.md", "tests/pwa.test.mjs", ".github/workflows/ci.yml"]), false);
  assert.equal(requiresReleaseVersionBump(["app/shoreline-app.tsx"]), true);
  assert.equal(requiresReleaseVersionBump(["public/sw.js"]), true);
  assert.equal(requiresReleaseVersionBump(["scripts/build-verified.sh"]), true);
});

test("production changes fail when package version is unchanged or lower", () => {
  assert.throws(
    () => checkReleaseVersion({ baseVersion: "1.4.0", currentVersion: "1.4.0", changedFiles: ["app/shoreline-app.tsx"] }),
    /require a release version above 1\.4\.0/,
  );
  assert.throws(
    () => checkReleaseVersion({ baseVersion: "1.4.0", currentVersion: "1.3.9", changedFiles: ["public/sw.js"] }),
    /require a release version above 1\.4\.0/,
  );
});

test("production changes pass after a release version bump", () => {
  assert.doesNotThrow(() =>
    checkReleaseVersion({ baseVersion: "1.3.0", currentVersion: "1.4.0", changedFiles: ["lib/app-version.ts"] }),
  );
});
