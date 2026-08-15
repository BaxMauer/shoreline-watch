import assert from "node:assert/strict";
import test from "node:test";
import { createAnchorWatch, getAnchorWatchSnapshot } from "../lib/anchor-watch.ts";

test("anchor watch stores a valid chart position and rejects invalid coordinates", () => {
  assert.deepEqual(createAnchorWatch({ latitude: 43.8, longitude: 15.55 }, 123), { point: { latitude: 43.8, longitude: 15.55 }, setAt: 123 });
  assert.equal(createAnchorWatch({ latitude: Number.NaN, longitude: 15.55 }), null);
});

test("anchor watch uses GPS accuracy as breach allowance", () => {
  const anchor = createAnchorWatch({ latitude: 43.8, longitude: 15.55 }, 123);
  assert.equal(getAnchorWatchSnapshot(anchor, { latitude: 43.8004, longitude: 15.55 }, 30, 20).breached, false);
  assert.equal(getAnchorWatchSnapshot(anchor, { latitude: 43.8007, longitude: 15.55 }, 30, 5).breached, true);
});

test("anchor snapshot clamps invalid radii", () => {
  assert.equal(getAnchorWatchSnapshot(null, null, -5).radiusMetres, 1);
});
