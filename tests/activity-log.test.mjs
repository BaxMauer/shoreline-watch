import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ACTIVITY_RECORDS,
  activityTotals,
  addActivityRecord,
  createTripDraft,
  finishTripDraft,
  isMeaningfulTripDraft,
  noteStoredTrackPoint,
  parseActivityLog,
  removeActivityRecord,
  updateTripDraft,
} from "../lib/activity-log.ts";

test("trip log aggregates plausible GPS samples while retaining track metadata separately", () => {
  let draft = createTripDraft(1_000);
  draft = updateTripDraft(draft, { latitude: 43.8, longitude: 15.55, accuracy: 5, speedKnots: 5, timestamp: 1_000 }, { shoreDistanceMetres: 500, depthMetres: 12 });
  draft = updateTripDraft(draft, { latitude: 43.8006, longitude: 15.55, accuracy: 5, speedKnots: 7, timestamp: 31_000 }, { shoreDistanceMetres: 450, depthMetres: 10 });
  draft = updateTripDraft(draft, { latitude: 43.8012, longitude: 15.55, accuracy: 5, speedKnots: 6, timestamp: 61_000 }, { shoreDistanceMetres: 475, depthMetres: 11 });
  draft = updateTripDraft(draft, { latitude: 43.8018, longitude: 15.55, accuracy: 5, speedKnots: 4, timestamp: 121_000 }, { shoreDistanceMetres: 490, depthMetres: 11 });
  draft = noteStoredTrackPoint(noteStoredTrackPoint(noteStoredTrackPoint(noteStoredTrackPoint(noteStoredTrackPoint(draft)))));
  const trip = finishTripDraft(draft, 151_000, { startLabel: "Pakoštane", endLabel: "Murter" });
  assert.ok(trip);
  assert.ok(trip.distanceMetres > 180 && trip.distanceMetres < 220);
  assert.equal(trip.averageSpeedKnots, 5.5);
  assert.equal(trip.maxSpeedKnots, 7);
  assert.equal(trip.minShoreDistanceMetres, 450);
  assert.equal(trip.minDepthMetres, 10);
  assert.equal(trip.trackPointCount, 5);
  assert.equal(trip.startLabel, "Pakoštane");
  assert.equal(trip.endLabel, "Murter");
  assert.deepEqual(trip.startPoint, { latitude: 43.8, longitude: 15.55 });
  assert.equal("lastPoint" in trip, false);
});

test("automatic recording discards short app checks and GPS drift", () => {
  let shortCheck = createTripDraft(0);
  shortCheck = updateTripDraft(shortCheck, { latitude: 43.8, longitude: 15.55, accuracy: 5, speedKnots: 4, timestamp: 0 });
  shortCheck = updateTripDraft(shortCheck, { latitude: 43.8006, longitude: 15.55, accuracy: 5, speedKnots: 4, timestamp: 30_000 });
  shortCheck = updateTripDraft(shortCheck, { latitude: 43.8012, longitude: 15.55, accuracy: 5, speedKnots: 4, timestamp: 60_000 });
  shortCheck = { ...shortCheck, trackPointCount: 8 };
  assert.equal(finishTripDraft(shortCheck, 75_000), null, "a brief look must not become a trip even while moving");

  let gpsDrift = createTripDraft(0);
  gpsDrift = updateTripDraft(gpsDrift, { latitude: 43.8, longitude: 15.55, accuracy: 18, speedKnots: 0.4, timestamp: 0 });
  gpsDrift = updateTripDraft(gpsDrift, { latitude: 43.801, longitude: 15.55, accuracy: 18, speedKnots: 1.2, timestamp: 60_000 });
  gpsDrift = updateTripDraft(gpsDrift, { latitude: 43.8, longitude: 15.55, accuracy: 18, speedKnots: 0.5, timestamp: 120_000 });
  gpsDrift = updateTripDraft(gpsDrift, { latitude: 43.801, longitude: 15.55, accuracy: 18, speedKnots: 3.2, timestamp: 180_000 });
  gpsDrift = { ...gpsDrift, trackPointCount: 20 };
  assert.equal(isMeaningfulTripDraft(gpsDrift, 240_000), false, "low-speed wandering with one speed spike must be treated as GPS noise");
  assert.equal(finishTripDraft(gpsDrift, 240_000), null);
});

test("automatic recording keeps sustained journeys and meaningful loops", () => {
  let journey = createTripDraft(0);
  for (let index = 0; index <= 6; index += 1) {
    journey = updateTripDraft(journey, {
      latitude: 43.8 + index * 0.0005,
      longitude: 15.55,
      accuracy: 5,
      speedKnots: 4,
      timestamp: index * 20_000,
    });
  }
  journey = { ...journey, trackPointCount: 7 };
  assert.equal(isMeaningfulTripDraft(journey, 130_000), true);
  assert.ok(finishTripDraft(journey, 130_000));

  const loop = {
    ...journey,
    distanceMetres: 600,
    firstPoint: { latitude: 43.8, longitude: 15.55 },
    lastPoint: { ...journey.lastPoint, latitude: 43.8001, longitude: 15.55 },
  };
  assert.equal(isMeaningfulTripDraft(loop, 130_000), true, "a real round trip may end close to where it started");
});

test("activity persistence rejects malformed data and stays bounded", () => {
  assert.deepEqual(parseActivityLog("broken"), []);
  const records = [];
  for (let index = 0; index < MAX_ACTIVITY_RECORDS + 10; index += 1) {
    records.push({ id: `trip-${index}`, kind: "trip", startedAt: index, endedAt: index + 1, durationMs: 1, distanceMetres: 1, movingDurationMs: 1, averageSpeedKnots: 1, maxSpeedKnots: 1, minShoreDistanceMetres: null, minDepthMetres: null, warningCount: 0 });
  }
  const bounded = addActivityRecord(records, { ...records[0], id: "new", startedAt: 999 });
  assert.equal(bounded.length, MAX_ACTIVITY_RECORDS);
  assert.equal(bounded[0].id, "new");
});

test("individual log entries can be removed without affecting the remaining records", () => {
  const records = [
    { id: "trip-1", kind: "trip", startedAt: 2, endedAt: 3 },
    { id: "anchor-1", kind: "anchor", startedAt: 1, endedAt: 2 },
  ];
  assert.deepEqual(removeActivityRecord(records, "trip-1"), [records[1]]);
  assert.equal(removeActivityRecord(records, "missing").length, 2);
});

test("totals combine trip and anchor summaries", () => {
  const totals = activityTotals([
    { id: "trip", kind: "trip", startedAt: 1, endedAt: 2, durationMs: 1_000, distanceMetres: 2_000, movingDurationMs: 900, averageSpeedKnots: 4, maxSpeedKnots: 8, minShoreDistanceMetres: 200, minDepthMetres: 3, warningCount: 1 },
    { id: "anchor", kind: "anchor", startedAt: 2, endedAt: 3, durationMs: 5_000, bayName: "Uvala", islandName: "Žut", maxDriftMetres: 32, radiusMetres: 30, driftAlarmCount: 2 },
  ]);
  assert.deepEqual(totals, { trips: 1, distanceMetres: 2_000, durationMs: 6_000, maxSpeedKnots: 8, anchorDurationMs: 5_000, driftAlarms: 2 });
});
