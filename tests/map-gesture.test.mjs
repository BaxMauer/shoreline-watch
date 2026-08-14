import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTE_MAP_LONG_PRESS_MS,
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
