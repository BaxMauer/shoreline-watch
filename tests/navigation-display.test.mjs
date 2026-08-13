import assert from "node:assert/strict";
import test from "node:test";
import { getGoNoGoState, getPlotRangeMetres, getPowerSaveReason } from "../lib/navigation-display.ts";

test("GO / NO GO uses the conservative distance and treats the boundary as GO", () => {
  assert.equal(getGoNoGoState(299.9, 300, true), "no-go");
  assert.equal(getGoNoGoState(300, 300, true), "go");
  assert.equal(getGoNoGoState(900, 300, true), "go");
});

test("GO / NO GO never claims safety without a fresh position", () => {
  assert.equal(getGoNoGoState(900, 300, false), "unknown");
  assert.equal(getGoNoGoState(null, 300, true), "unknown");
});

test("plot range always includes even a distant nearest shoreline", () => {
  for (const distance of [0, 299, 2_500, 25_000, 120_000]) {
    assert.ok(getPlotRangeMetres(distance, 300) > distance);
  }
  assert.ok(getPlotRangeMetres(100, 300) >= 405);
});

const POWER_INPUT = {
  enabled: true,
  tracking: true,
  gpsIsFresh: true,
  distanceMetres: 700,
  farDistanceMetres: 2_000,
  speedMetresPerSecond: 0.1,
  lastMovementAt: 1_000,
  stationaryAfterMinutes: 5,
  alertActive: false,
  wakeUntil: 0,
  now: 302_000,
};

test("power saver activates far offshore or after the configured stationary time", () => {
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, distanceMetres: 2_100, speedMetresPerSecond: 4 }), "far-shore");
  assert.equal(getPowerSaveReason(POWER_INPUT), "stationary");
});

test("power saver stays awake for danger, bad GPS, movement, or a temporary wake request", () => {
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, alertActive: true }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, gpsIsFresh: false }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, speedMetresPerSecond: 1 }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, wakeUntil: 400_000 }), null);
});
