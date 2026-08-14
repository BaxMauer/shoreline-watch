import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_BUMP_EXEMPT_PREFIXES = [".github/", "tests/"];
const VERSION_BUMP_EXEMPT_FILES = new Set([
  "AGENTS.md",
  "OPEN_POINTS.md",
  "README.md",
  "SECURITY.md",
  "scripts/check-release-version.mjs",
]);

export function parseReleaseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version, got ${JSON.stringify(version)}`);
  return match.slice(1).map(Number);
}

export function isReleaseVersionGreater(currentVersion, baseVersion) {
  const current = parseReleaseVersion(currentVersion);
  const base = parseReleaseVersion(baseVersion);
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== base[index]) return current[index] > base[index];
  }
  return false;
}

export function requiresReleaseVersionBump(changedFiles) {
  return changedFiles.some((file) =>
    !VERSION_BUMP_EXEMPT_FILES.has(file) &&
    !VERSION_BUMP_EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

function readPackageVersionAt(ref) {
  const packageJson = execFileSync("git", ["show", `${ref}:package.json`], { encoding: "utf8" });
  return JSON.parse(packageJson).version;
}

function readChangedFiles(baseSha) {
  return execFileSync("git", ["diff", "--name-only", `${baseSha}...HEAD`], { encoding: "utf8" })
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

export function checkReleaseVersion({ baseVersion, currentVersion, changedFiles }) {
  if (!requiresReleaseVersionBump(changedFiles)) return;
  if (!isReleaseVersionGreater(currentVersion, baseVersion)) {
    throw new Error(
      `Production-affecting changes require a release version above ${baseVersion}; package.json is ${currentVersion}.`,
    );
  }
}

export function main() {
  const baseSha = process.env.BASE_SHA?.trim();
  if (!baseSha) throw new Error("BASE_SHA is required for release version validation.");

  const changedFiles = readChangedFiles(baseSha);
  const baseVersion = readPackageVersionAt(baseSha);
  const currentVersion = readPackageVersionAt("HEAD");
  checkReleaseVersion({ baseVersion, currentVersion, changedFiles });

  if (requiresReleaseVersionBump(changedFiles)) {
    console.log(`Release version ${baseVersion} -> ${currentVersion} validated.`);
  } else {
    console.log("No production-affecting changes; release version bump not required.");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href : null;
if (invokedPath === import.meta.url) main();
