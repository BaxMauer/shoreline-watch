#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function requireValue(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

export function createDeploymentManifest(environment) {
  const repository = requireValue(environment, "GITHUB_REPOSITORY");
  const serverUrl = requireValue(environment, "GITHUB_SERVER_URL").replace(/\/$/, "");
  const sourceSha = requireValue(environment, "SOURCE_SHA");
  const candidateRunId = requireValue(environment, "GITHUB_RUN_ID");
  const ciRunId = requireValue(environment, "CI_RUN_ID");

  if (!/^[0-9a-f]{40,64}$/i.test(sourceSha)) {
    throw new Error(`SOURCE_SHA is not a full commit hash: ${sourceSha}`);
  }

  return {
    schema_version: 1,
    repository,
    source_ref: "refs/heads/main",
    source_sha: sourceSha.toLowerCase(),
    verification: {
      workflow: "CI",
      conclusion: "success",
      run_id: ciRunId,
      run_url: `${serverUrl}/${repository}/actions/runs/${ciRunId}`,
    },
    candidate: {
      workflow: "Production candidate",
      run_id: candidateRunId,
      run_url: `${serverUrl}/${repository}/actions/runs/${candidateRunId}`,
    },
  };
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error("Usage: write-deployment-manifest.mjs <output-path>");
  const manifest = createDeploymentManifest(process.env);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
