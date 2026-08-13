import assert from "node:assert/strict";
import test from "node:test";

import { parseDuration, runCommand } from "../scripts/run-with-timeout.mjs";

test("parseDuration accepts the supported units", () => {
  assert.equal(parseDuration("250ms"), 250);
  assert.equal(parseDuration("2s"), 2_000);
  assert.equal(parseDuration("1.5m"), 90_000);
  assert.equal(parseDuration("1h"), 3_600_000);
});

test("parseDuration rejects missing, zero, and unitless values", () => {
  for (const value of [undefined, "", "0s", "30", "soon"]) {
    assert.throws(() => parseDuration(value));
  }
});

test("runCommand preserves a successful exit code", async () => {
  const exitCode = await runCommand(process.execPath, ["-e", "process.exit(0)"], {
    timeoutMs: 2_000,
    killAfterMs: 200,
  });
  assert.equal(exitCode, 0);
});

test("runCommand returns the conventional timeout exit code", async () => {
  const exitCode = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 5_000)"], {
    timeoutMs: 100,
    killAfterMs: 200,
  });
  assert.equal(exitCode, 124);
});
