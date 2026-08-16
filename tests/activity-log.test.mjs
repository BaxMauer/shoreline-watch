import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ACTIVITY_RECORDS,
  activityTotals,
  addActivityRecord,
  createTripDraft,
  finishTripDraft,
  noteStoredTrackPoint,
  parseActivityLog,
  updateTripDraft,
} from "../lib/activity-log.ts";

test("trip log aggregates plausible GPS samples while retaining track metadata separately", () => {
  let draft = createTripDraft(1_000);
  draft = updateTripDraft(draft, { latitude: 43.8, longitude: 15.55, accuracy: 5, speedKnots: 5, timestamp: 1_000 }, { shoreDistanceMetres: 500, depthMetres: 12 });
  draft = updateTripDraft(draft, { latitude: 43.8005, longitude: 15.55, accuracy: 5, speedKnots: 7, timestamp: 31_000 }, { shoreDistanceMetres: 450, depthMetres: 10 });
  draft = noteStoredTrackPoint(noteStoredTrackPoint(draft));
  const trip = finishTripDraft(draft, 61_000, { startLabel: "Pakoštane", endLabel: "Murter" });
  assert.ok(trip);
  assert.ok(trip.distanceMetres > 40 && trip.distanceMetres < 70);
  assert.equal(trip.averageSpeedKnots, 6);
  assert.equal(trip.maxSpeedKnots, 7);
  assert.equal(trip.minShoreDistanceMetres, 450);
  assert.equal(trip.minDepthMetres, 10);
  assert.equal(trip.trackPointCount, 2);
  assert.equal(trip.startLabel, "Pakoštane");
  assert.equal(trip.endLabel, "Murter");
  assert.deepEqual(trip.startPoint, { latitude: 43.8, longitude: 15.55 });
  assert.equal("lastPoint" in trip, false);
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

test("totals combine trip and anchor summaries", () => {
  const totals = activityTotals([
    { id: "trip", kind: "trip", startedAt: 1, endedAt: 2, durationMs: 1_000, distanceMetres: 2_000, movingDurationMs: 900, averageSpeedKnots: 4, maxSpeedKnots: 8, minShoreDistanceMetres: 200, minDepthMetres: 3, warningCount: 1 },
    { id: "anchor", kind: "anchor", startedAt: 2, endedAt: 3, durationMs: 5_000, bayName: "Uvala", islandName: "Žut", maxDriftMetres: 32, radiusMetres: 30, driftAlarmCount: 2 },
  ]);
  assert.deepEqual(totals, { trips: 1, distanceMetres: 2_000, durationMs: 6_000, maxSpeedKnots: 8, anchorDurationMs: 5_000, driftAlarms: 2 });
});
