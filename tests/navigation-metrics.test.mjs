import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateClosingRate,
  classifyClosingRate,
  getGpsSignalState,
  shouldUseSunlightMode,
  solarElevationDegrees,
} from "../lib/navigation-metrics.ts";

test("GPS state escalates from waiting to stale and lost at fixed thresholds", () => {
  const start = 1_000_000;
  assert.equal(getGpsSignalState(true, null, start, start + 19_000), "waiting");
  assert.equal(getGpsSignalState(true, null, start, start + 20_000), "lost");
  assert.equal(getGpsSignalState(true, start, start, start + 9_999), "fresh");
  assert.equal(getGpsSignalState(true, start, start, start + 10_000), "stale");
  assert.equal(getGpsSignalState(true, start, start, start + 30_000), "lost");
  assert.equal(getGpsSignalState(false, start, start, start + 90_000), "fresh");
});

test("closing rate uses the distance trend across several samples", () => {
  const samples = [
    { timestamp: 0, distanceMetres: 500 },
    { timestamp: 5_000, distanceMetres: 476 },
    { timestamp: 10_000, distanceMetres: 449 },
    { timestamp: 15_000, distanceMetres: 426 },
  ];
  const rate = calculateClosingRate(samples);
  assert.ok(rate !== null && rate > 4.8 && rate < 5.1);
  assert.equal(classifyClosingRate(rate), "approaching");
});

test("closing trend distinguishes receding, steady, and insufficient data", () => {
  assert.equal(classifyClosingRate(-1.2), "receding");
  assert.equal(classifyClosingRate(0.1), "steady");
  assert.equal(classifyClosingRate(null), "unknown");
  assert.equal(calculateClosingRate([{ timestamp: 0, distanceMetres: 300 }]), null);
});

test("offline solar position enables sunlight mode by day, not by night", () => {
  const latitude = 43.8;
  const longitude = 15.6;
  const summerNoon = Date.UTC(2026, 5, 21, 11, 0, 0);
  const summerMidnight = Date.UTC(2026, 5, 21, 22, 0, 0);
  assert.ok(solarElevationDegrees(summerNoon, latitude, longitude) > 60);
  assert.ok(solarElevationDegrees(summerMidnight, latitude, longitude) < -10);
  assert.equal(shouldUseSunlightMode(true, summerNoon, latitude, longitude), true);
  assert.equal(shouldUseSunlightMode(true, summerMidnight, latitude, longitude), false);
  assert.equal(shouldUseSunlightMode(false, summerNoon, latitude, longitude), false);
});
