#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const KNOWN_DEV_ADVISORIES = new Set([
  // image-size is pulled in only by the Vinext build tool. Remove these
  // exceptions as soon as Vinext publishes a patched dependency chain.
  "GHSA-5p2g-fcmc-qvqq",
  "GHSA-w3rx-r6r6-pgpr",
]);

const blockingSeverities = new Set(["high", "critical"]);

function advisoryId(via) {
  if (typeof via !== "object" || via === null) return null;
  return /\/advisories\/(GHSA-[\w-]+)/.exec(via.url ?? "")?.[1] ?? null;
}

export function resolveAdvisories(packageName, vulnerabilities, seen = new Set()) {
  if (seen.has(packageName)) return new Set();
  seen.add(packageName);

  const resolved = new Set();
  for (const via of vulnerabilities[packageName]?.via ?? []) {
    if (typeof via === "string") {
      for (const id of resolveAdvisories(via, vulnerabilities, seen)) resolved.add(id);
    } else {
      const id = advisoryId(via);
      if (id) resolved.add(id);
    }
  }
  return resolved;
}

export function evaluateAudit(report, allowedAdvisories = new Set()) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const blocked = [];
  const excepted = [];

  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    if (!blockingSeverities.has(vulnerability.severity)) continue;

    const advisories = [...resolveAdvisories(packageName, vulnerabilities)].sort();
    const isExcepted = advisories.length > 0
      && advisories.every((id) => allowedAdvisories.has(id));
    (isExcepted ? excepted : blocked).push({
      packageName,
      severity: vulnerability.severity,
      advisories,
    });
  }

  return { blocked, excepted };
}

function audit(mode) {
  const productionOnly = mode === "--production";
  if (!productionOnly && mode !== "--all") {
    throw new TypeError("Usage: audit-dependencies.mjs --production|--all");
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["audit", "--json"];
  if (productionOnly) args.push("--omit=dev");
  const result = spawnSync(npm, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw result.error;

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit did not return valid JSON. ${result.stderr}`.trim());
  }
  if (!report.metadata?.vulnerabilities) {
    throw new Error(`npm audit failed before producing vulnerability metadata. ${result.stderr}`.trim());
  }

  const allowed = productionOnly ? new Set() : KNOWN_DEV_ADVISORIES;
  const { blocked, excepted } = evaluateAudit(report, allowed);
  const counts = report.metadata.vulnerabilities;
  console.log(
    `[security] ${productionOnly ? "production" : "complete"} audit: `
      + `${counts.critical ?? 0} critical, ${counts.high ?? 0} high, `
      + `${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`,
  );
  if (excepted.length > 0) {
    console.log(`[security] accepted build-only advisories: ${[...KNOWN_DEV_ADVISORIES].sort().join(", ")}`);
  }
  if (blocked.length > 0) {
    for (const finding of blocked) {
      console.error(
        `[security] blocking ${finding.severity} finding in ${finding.packageName}`
          + `${finding.advisories.length > 0 ? ` (${finding.advisories.join(", ")})` : " (unresolved advisory chain)"}`,
      );
    }
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = audit(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
