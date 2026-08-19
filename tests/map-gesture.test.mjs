import assert from "node:assert/strict";
import test from "node:test";
import {
  MAXIMUM_DISTANCE_MAP_RANGE_METRES,
  MINIMUM_DISTANCE_MAP_RANGE_METRES,
  ROUTE_MAP_LONG_PRESS_MS,
  clampDistanceMapRange,
  panDistanceMapCentre,
  pinchDistanceMapRange,
  shouldCommitRouteMapLongPress,
} from "../lib/map-gesture.ts";

test("route points require one stationary pointer for the full hold duration", () => {
  const valid = { elapsedMs: ROUTE_MAP_LONG_PRESS_MS, moved: false, pointerCount: 1, planning: true };
  assert.equal(shouldCommitRouteMapLongPress(valid), true);
  assert.equal(shouldCommitRouteMapLongPress({ ...valid, elapsedMs: ROUTE_MAP_LONG_PRESS_MS - 1 }), false);
  assert.equal(shouldCommitRouteMapLongPress({ ...valid, moved: true }), false);
  assert.equal(shouldCommitRouteMapLongPress({ ...valid, pointerCount: 2 }), false);
  assert.equal(shouldCommitRouteMapLongPress({ ...valid, planning: false }), false);
});

test("distance map zoom stays bounded and pinch gestures scale proportionally", () => {
  assert.equal(clampDistanceMapRange(1), MINIMUM_DISTANCE_MAP_RANGE_METRES);
  assert.equal(clampDistanceMapRange(1_000_000), MAXIMUM_DISTANCE_MAP_RANGE_METRES);
  assert.equal(clampDistanceMapRange(Number.NaN, 750), 750);
  assert.equal(pinchDistanceMapRange(1_000, 100, 200), 500);
  assert.equal(pinchDistanceMapRange(1_000, 100, 50), 2_000);
  assert.equal(pinchDistanceMapRange(1_000, 0, 50), 1_000);
});

test("distance map panning follows the pointer without moving the tracked boat", () => {
  const centre = { longitude: 15.55, latitude: 43.8 };
  const right = panDistanceMapCentre(centre, 1_000, 360, 60, 0);
  const down = panDistanceMapCentre(centre, 1_000, 360, 0, 60);
  assert.ok(right.longitude < centre.longitude);
  assert.equal(right.latitude, centre.latitude);
  assert.equal(down.longitude, centre.longitude);
  assert.ok(down.latitude > centre.latitude);
});
