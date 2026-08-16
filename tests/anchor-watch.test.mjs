import assert from "node:assert/strict";
import test from "node:test";
import { createAnchorWatch, getAnchorWatchSnapshot, shouldSoundAnchorDriftAlarm } from "../lib/anchor-watch.ts";

test("anchor watch stores a valid chart position and rejects invalid coordinates", () => {
  assert.deepEqual(createAnchorWatch({ latitude: 43.8, longitude: 15.55 }, 123), { point: { latitude: 43.8, longitude: 15.55 }, setAt: 123, bayName: null, islandName: null });
  assert.equal(createAnchorWatch({ latitude: Number.NaN, longitude: 15.55 }), null);
});

test("anchor drift alarm fires on breach and repeats on a safe cadence", () => {
  assert.equal(shouldSoundAnchorDriftAlarm(true, false, 10_000, null), true);
  assert.equal(shouldSoundAnchorDriftAlarm(true, true, 30_000, 10_000), false);
  assert.equal(shouldSoundAnchorDriftAlarm(true, true, 40_000, 10_000), true);
  assert.equal(shouldSoundAnchorDriftAlarm(false, true, 50_000, 10_000), false);
});

test("anchor watch uses GPS accuracy as breach allowance", () => {
  const anchor = createAnchorWatch({ latitude: 43.8, longitude: 15.55 }, 123);
  assert.equal(getAnchorWatchSnapshot(anchor, { latitude: 43.8004, longitude: 15.55 }, 30, 20).breached, false);
  assert.equal(getAnchorWatchSnapshot(anchor, { latitude: 43.8007, longitude: 15.55 }, 30, 5).breached, true);
});

test("anchor snapshot clamps invalid radii", () => {
  assert.equal(getAnchorWatchSnapshot(null, null, -5).radiusMetres, 1);
});
