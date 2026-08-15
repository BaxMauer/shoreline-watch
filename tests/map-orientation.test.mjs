import assert from "node:assert/strict";
import test from "node:test";
import {
  getMapOrientation,
  normalizeMapHeading,
  rotateMapDelta,
  rotateMapPoint,
} from "../lib/map-orientation.ts";

test("map orientation keeps north up by default and boat up in heading mode", () => {
  assert.deepEqual(getMapOrientation(72, false), { mapRotationDegrees: 0, boatRotationDegrees: 72 });
  assert.deepEqual(getMapOrientation(72, true), { mapRotationDegrees: -72, boatRotationDegrees: 0 });
});

test("map heading safely normalizes invalid and wrapped values", () => {
  assert.equal(normalizeMapHeading(null), 0);
  assert.equal(normalizeMapHeading(Number.NaN), 0);
  assert.equal(normalizeMapHeading(-10), 350);
  assert.equal(normalizeMapHeading(725), 5);
});

test("rotated screen points and drag deltas can be mapped back to north-up coordinates", () => {
  const pivot = { x: 180, y: 180 };
  const original = { x: 240, y: 150 };
  const rendered = rotateMapPoint(original, pivot, -83);
  const restored = rotateMapPoint(rendered, pivot, 83);
  assert.ok(Math.abs(restored.x - original.x) < 1e-9);
  assert.ok(Math.abs(restored.y - original.y) < 1e-9);

  const drag = rotateMapDelta({ x: 12, y: -5 }, 90);
  assert.ok(Math.abs(drag.x - 5) < 1e-9);
  assert.ok(Math.abs(drag.y - 12) < 1e-9);
});
