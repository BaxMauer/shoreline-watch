import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAudit } from "../scripts/audit-dependencies.mjs";

const allowed = new Set(["GHSA-safe-build-only"]);

test("audit exceptions propagate only through an explicitly allowed advisory", () => {
  const report = {
    vulnerabilities: {
      "build-tool": { severity: "high", via: ["image-parser"] },
      "image-parser": {
        severity: "high",
        via: [{ url: "https://github.com/advisories/GHSA-safe-build-only" }],
      },
    },
  };

  const result = evaluateAudit(report, allowed);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.excepted.map(({ packageName }) => packageName).sort(), ["build-tool", "image-parser"]);
});

test("a new high advisory on an excepted dependency still blocks", () => {
  const report = {
    vulnerabilities: {
      "image-parser": {
        severity: "high",
        via: [
          { url: "https://github.com/advisories/GHSA-safe-build-only" },
          { url: "https://github.com/advisories/GHSA-new-finding" },
        ],
      },
    },
  };

  const result = evaluateAudit(report, allowed);
  assert.equal(result.blocked[0].packageName, "image-parser");
});

test("moderate findings do not violate the high-or-critical blocking policy", () => {
  const result = evaluateAudit({
    vulnerabilities: {
      "dev-server": {
        severity: "moderate",
        via: [{ url: "https://github.com/advisories/GHSA-moderate-only" }],
      },
    },
  });
  assert.deepEqual(result, { blocked: [], excepted: [] });
});
