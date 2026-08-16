import assert from "node:assert/strict";
import test from "node:test";
import { buildTripGpx, getMapViewportExtent, shouldStoreTrackPoint } from "../lib/activity-track.ts";

function point(overrides = {}) {
  return {
    tripId: "trip-1",
    sequence: 0,
    latitude: 43.8,
    longitude: 15.55,
    timestamp: 1_000,
    accuracy: 5,
    speedKnots: 6,
    heading: 90,
    shoreDistanceMetres: 400,
    depthMetres: 12,
    ...overrides,
  };
}

test("track sampling records the first fix and rejects weak or duplicate GPS fixes", () => {
  const first = point();
  assert.equal(shouldStoreTrackPoint(null, first), true);
  assert.equal(shouldStoreTrackPoint(first, point({ timestamp: 1_000 })), false);
  assert.equal(shouldStoreTrackPoint(first, point({ timestamp: 3_000, accuracy: 120 })), false);
});

test("track sampling keeps meaningful movement, course changes, and stationary breadcrumbs", () => {
  const first = point();
  assert.equal(shouldStoreTrackPoint(first, point({ timestamp: 7_000, latitude: 43.8001 })), true);
  assert.equal(shouldStoreTrackPoint(first, point({ timestamp: 4_000, latitude: 43.80003, heading: 120 })), true);
  assert.equal(shouldStoreTrackPoint(first, point({ timestamp: 6_000 })), true);
  assert.equal(shouldStoreTrackPoint(first, point({ timestamp: 5_999 })), false);
  assert.equal(shouldStoreTrackPoint(first, point({ timestamp: 2_000, latitude: 43.8001 })), false);
});

test("GPX export contains ordered coordinates, time, speed, accuracy, and depth", () => {
  const gpx = buildTripGpx("Pakoštane & Murter", [point(), point({ sequence: 1, timestamp: 6_000, latitude: 43.801 })]);
  assert.match(gpx, /<name>Pakoštane &amp; Murter<\/name>/);
  assert.match(gpx, /lat="43\.8000000" lon="15\.5500000"/);
  assert.match(gpx, /<time>1970-01-01T00:00:01\.000Z<\/time>/);
  assert.match(gpx, /<shoreline:speedKnots>6\.00<\/shoreline:speedKnots>/);
  assert.match(gpx, /<shoreline:accuracy>5\.0<\/shoreline:accuracy>/);
  assert.match(gpx, /<shoreline:chartDepth>12\.0<\/shoreline:chartDepth>/);
});

test("activity maps scan the complete wide viewport including overscan", () => {
  const viewport = getMapViewportExtent(360, 246, 0.25, 4);
  assert.ok(viewport);
  assert.equal(viewport.halfWidthMetres, 736);
  assert.equal(viewport.halfHeightMetres, 508);
  assert.ok(viewport.radiusMetres > viewport.halfWidthMetres);
  assert.equal(getMapViewportExtent(360, 246, 0), null);
  assert.equal(getMapViewportExtent(360, 246, 0.25, -1), null);
});
