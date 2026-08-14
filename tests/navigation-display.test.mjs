import assert from "node:assert/strict";
import test from "node:test";
import {
  createStationaryState,
  getAnchorTimerSnapshot,
  getGoNoGoState,
  getPlotRangeMetres,
  getPowerSaveReason,
  updateStationaryState,
} from "../lib/navigation-display.ts";

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

test("plot range handles unavailable and invalid shore distances safely", () => {
  assert.ok(Math.abs(getPlotRangeMetres(null, 300) - 405) < 0.0001);
  assert.ok(Math.abs(getPlotRangeMetres(Number.NaN, 300) - 405) < 0.0001);
  assert.ok(Math.abs(getPlotRangeMetres(-500, 300) - 405) < 0.0001);
  assert.equal(getPlotRangeMetres(0, 0), 50);
});

const POWER_INPUT = {
  enabled: true,
  tracking: true,
  gpsIsReliable: true,
  distanceMetres: 700,
  farDistanceMetres: 2_000,
  lastMovementAt: 1_000,
  stationaryAfterMinutes: 5,
  alertActive: false,
  wakeUntil: 0,
  now: 302_000,
};

test("power saver activates far offshore or after the configured stationary time", () => {
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, distanceMetres: 2_100 }), "far-shore");
  assert.equal(getPowerSaveReason(POWER_INPUT), "stationary");
});

test("power saver stays awake for danger, bad GPS, movement, or a temporary wake request", () => {
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, alertActive: true }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, gpsIsReliable: false }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, lastMovementAt: 301_999 }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, wakeUntil: 400_000 }), null);
});

test("power saver requires an enabled live session with a known shoreline", () => {
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, enabled: false }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, tracking: false }), null);
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, distanceMetres: null }), null);
});

test("power-saving thresholds activate exactly at their configured boundary", () => {
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, distanceMetres: 2_000, lastMovementAt: 302_000 }), "far-shore");
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, distanceMetres: 700, now: 301_000 }), "stationary");
  assert.equal(getPowerSaveReason({ ...POWER_INPUT, distanceMetres: 700, now: 300_999 }), null);
});

test("GO / NO GO honours the stabilized warning-zone state", () => {
  assert.equal(getGoNoGoState(301, 300, true, true), "no-go");
  assert.equal(getGoNoGoState(299, 300, true, false), "go");
  assert.equal(getGoNoGoState(900, 300, false, false), "unknown");
});

const ANCHOR = {
  reference: { longitude: 15, latitude: 43, accuracy: 5, speed: 0, timestamp: 1_000 },
  lastMovementAt: 1_000,
  lastFixTimestamp: 1_000,
  movingCandidateSince: null,
};

test("normal swinging inside the anchor circle does not reset stationary time", () => {
  const next = updateStationaryState(ANCHOR, {
    longitude: 15.0002,
    latitude: 43,
    accuracy: 5,
    speed: 0.15,
    timestamp: 301_000,
  }, 30);
  assert.equal(next.lastMovementAt, 1_000);
  assert.equal(next.reference, ANCHOR.reference);
});

test("leaving the anchor circle resets stationary time even at low speed", () => {
  const next = updateStationaryState(ANCHOR, {
    longitude: 15.001,
    latitude: 43,
    accuracy: 5,
    speed: 0.15,
    timestamp: 302_000,
  }, 30);
  assert.equal(next.lastMovementAt, 302_000);
  assert.equal(next.reference?.longitude, 15.001);
});

test("GPS accuracy is allowed for before classifying anchor movement", () => {
  const next = updateStationaryState(ANCHOR, {
    longitude: 15.0007,
    latitude: 43,
    accuracy: 40,
    speed: 0.1,
    timestamp: 303_000,
  }, 30);
  assert.equal(next.lastMovementAt, 1_000);
});

test("one noisy speed sample does not reset, while sustained movement does", () => {
  const candidate = updateStationaryState(ANCHOR, {
    longitude: 15,
    latitude: 43,
    accuracy: 5,
    speed: 0.9,
    timestamp: 304_000,
  }, 30, 10_000);
  assert.equal(candidate.lastMovementAt, 1_000);
  assert.equal(candidate.movingCandidateSince, 10_000);
  const confirmed = updateStationaryState(candidate, {
    longitude: 15,
    latitude: 43,
    accuracy: 5,
    speed: 0.9,
    timestamp: 305_000,
  }, 30, 13_000);
  assert.equal(confirmed.lastMovementAt, 13_000);
  assert.equal(confirmed.movingCandidateSince, null);
});

test("first GPS position creates the anchor reference and movement timestamp", () => {
  const position = { longitude: 15, latitude: 43, accuracy: 7, speed: null, timestamp: 5_000 };
  assert.deepEqual(updateStationaryState(createStationaryState(), position, 30, 7_000), {
    reference: position,
    lastMovementAt: 7_000,
    lastFixTimestamp: 5_000,
    movingCandidateSince: null,
  });
});

test("duplicate or older GPS samples cannot move the anchor reference backwards", () => {
  const duplicate = updateStationaryState(ANCHOR, { ...ANCHOR.reference, longitude: 16, timestamp: 1_000 }, 30);
  const older = updateStationaryState(ANCHOR, { ...ANCHOR.reference, longitude: 16, timestamp: 999 }, 30);
  assert.equal(duplicate, ANCHOR);
  assert.equal(older, ANCHOR);
});

test("missing speed still permits anchor-circle stationary detection", () => {
  const next = updateStationaryState(ANCHOR, {
    longitude: 15.0001,
    latitude: 43,
    accuracy: 5,
    speed: null,
    timestamp: 305_000,
  }, 30);
  assert.equal(next.lastMovementAt, 1_000);
});

test("negative GPS accuracy never enlarges the configured anchor circle", () => {
  const next = updateStationaryState({
    ...ANCHOR,
    reference: { ...ANCHOR.reference, accuracy: -50 },
  }, {
    longitude: 15.0005,
    latitude: 43,
    accuracy: -10,
    speed: 0.1,
    timestamp: 306_000,
  }, 30);
  assert.equal(next.lastMovementAt, 306_000);
});

test("out-of-order GPS samples cannot reset an established anchor timer", () => {
  const newer = updateStationaryState(ANCHOR, { ...ANCHOR.reference, timestamp: 5_000 }, 30, 8_000);
  const delayedOutside = updateStationaryState(newer, {
    ...ANCHOR.reference,
    longitude: 15.01,
    timestamp: 3_000,
  }, 30, 9_000);
  assert.equal(delayedOutside, newer);
  assert.equal(delayedOutside.lastFixTimestamp, 5_000);
});

test("anchor departure requires radius plus both GPS accuracy radii", () => {
  const withinCombinedAccuracy = updateStationaryState(ANCHOR, {
    ...ANCHOR.reference,
    longitude: 15.0005,
    accuracy: 10,
    timestamp: 7_000,
  }, 30, 10_000);
  assert.equal(withinCombinedAccuracy.lastMovementAt, 1_000);
  const clearlyOutside = updateStationaryState(withinCombinedAccuracy, {
    ...ANCHOR.reference,
    longitude: 15.001,
    accuracy: 5,
    timestamp: 8_000,
  }, 30, 11_000);
  assert.equal(clearlyOutside.lastMovementAt, 11_000);
});

test("anchor timer uses observed wall clock and activates exactly at threshold", () => {
  const input = {
    enabled: true,
    tracking: true,
    gpsIsReliable: true,
    lastMovementAt: 1_000,
    stationaryAfterMinutes: 5,
    alertActive: false,
    wakeUntil: 0,
  };
  assert.deepEqual(getAnchorTimerSnapshot({ ...input, now: 300_999 }), {
    thresholdMs: 300_000,
    elapsedMs: 299_999,
    remainingMs: 1,
    blocker: null,
    eligible: true,
    active: false,
  });
  assert.equal(getAnchorTimerSnapshot({ ...input, now: 301_000 }).active, true);
  assert.equal(getAnchorTimerSnapshot({ ...input, now: 999 }).elapsedMs, 0);
  assert.equal(getAnchorTimerSnapshot({ ...input, now: 301_000, gpsIsReliable: false }).blocker, "gps");
});

test("stationary power saving can activate inside the shoreline warning distance", () => {
  assert.equal(getPowerSaveReason({
    ...POWER_INPUT,
    distanceMetres: 100,
    alertActive: false,
  }), "stationary");
});
