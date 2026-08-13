import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  distanceToSegment,
  findCourseToShore,
  findNearestShore,
  getLandIntervalsAtLatitude,
  getNearbyShorelineSegments,
  offsetFromShore,
} from "../lib/shoreline.ts";

const SYNTHETIC_PACK = {
  schemaVersion: 1,
  region: "Test",
  generatedAt: "2026-01-01T00:00:00Z",
  source: "test",
  sourceUrl: "https://example.com",
  attribution: "test",
  cellSize: 1,
  simplifyToleranceMeters: 0,
  bounds: [-1, -1, 1, 1],
  segmentCount: 2,
  cells: {
    "0:0": [0, 0, 0.1, 0, 0, 0, 0.1, 0],
  },
};

const LAND_PACK = {
  ...SYNTHETIC_PACK,
  cellSize: 10,
  bounds: [0, 0, 3, 4],
  segmentCount: 5,
  cells: {
    "0:0": [
      1, 1, 2, 1,
      2, 1, 2, 2,
      2, 2, 1, 2,
      1, 2, 1, 1,
      3, 0, 3, 4,
    ],
  },
};

test("land scanline fills an island interior and mainland while leaving water clear", () => {
  assert.deepEqual(getLandIntervalsAtLatitude(LAND_PACK, 1.5, 0, 4), [[1, 2], [3, 4]]);
  assert.deepEqual(getLandIntervalsAtLatitude(LAND_PACK, 0.5, 0, 4), [[3, 4]]);
});

test("land scanline preserves bays and channels between separate coast crossings", () => {
  const bayPack = {
    ...LAND_PACK,
    segmentCount: 3,
    cells: { "0:0": [1, 0, 1, 4, 2, 0, 2, 4, 3, 0, 3, 4] },
  };
  assert.deepEqual(getLandIntervalsAtLatitude(bayPack, 1.5, 0, 4), [[1, 2], [3, 4]]);
});

test("land scanline handles a tangent without falsely turning water into land", () => {
  const tangentPack = {
    ...LAND_PACK,
    bounds: [0, 0, 2, 3],
    segmentCount: 2,
    cells: { "0:0": [1.5, 1, 1, 2, 1.5, 1, 2, 2] },
  };
  assert.deepEqual(getLandIntervalsAtLatitude(tangentPack, 1, 0, 3), []);
});

test("land scanline de-duplicates repeated and reversed indexed segments", () => {
  const duplicatePack = {
    ...LAND_PACK,
    bounds: [0, 0, 1, 4],
    segmentCount: 1,
    cells: { "0:0": [1, 0, 1, 4, 1, 0, 1, 4, 1, 4, 1, 0] },
  };
  assert.deepEqual(getLandIntervalsAtLatitude(duplicatePack, 2, 0, 3), [[1, 3]]);
});

test("land scanline rejects invalid windows and latitudes outside the coastline pack", () => {
  assert.deepEqual(getLandIntervalsAtLatitude(LAND_PACK, -1, 0, 4), []);
  assert.deepEqual(getLandIntervalsAtLatitude(LAND_PACK, 1, 4, 0), []);
  assert.deepEqual(getLandIntervalsAtLatitude(LAND_PACK, Number.NaN, 0, 4), []);
});

test("point-to-segment distance is measured in metres", () => {
  const result = distanceToSegment(15, 44.001, [14.99, 44, 15.01, 44]);
  assert.ok(result.distance > 109 && result.distance < 112);
  assert.ok(Math.abs(result.longitude - 15) < 0.000001);
  assert.ok(Math.abs(result.latitude - 44) < 0.000001);
  assert.ok(result.bearing > 179 && result.bearing < 181);
});

test("point-to-segment calculation clamps to the nearest endpoint", () => {
  const result = distanceToSegment(0.02, 0, [0, 0, 0.01, 0]);
  assert.ok(result.distance > 1_110 && result.distance < 1_115);
  assert.ok(Math.abs(result.longitude - 0.01) < 0.000001);
});

test("zero-length shoreline segment remains finite", () => {
  const result = distanceToSegment(15, 43, [15.001, 43.001, 15.001, 43.001]);
  assert.ok(Number.isFinite(result.distance));
  assert.ok(result.distance > 100);
});

test("nearest-shore search finds the closest segment and rejects locations outside the pack", () => {
  const nearest = findNearestShore(SYNTHETIC_PACK, 0.05, 0.001);
  assert.ok(nearest && nearest.distance > 109 && nearest.distance < 112);
  assert.equal(findNearestShore(SYNTHETIC_PACK, 2, 2), null);
});

test("nearby-shore search removes duplicate segments and respects its maximum", () => {
  const segments = getNearbyShorelineSegments(SYNTHETIC_PACK, 0.05, 0.001, 1_000);
  assert.deepEqual(segments, [[0, 0, 0.1, 0]]);
  assert.equal(getNearbyShorelineSegments(SYNTHETIC_PACK, 0.05, 0.001, 1_000, 0).length, 0);
});

test("course intersection finds coast ahead but never behind the boat", () => {
  const coast = [[-0.01, 0.001, 0.01, 0.001]];
  const northbound = findCourseToShore(coast, 0, 0, 0);
  assert.ok(northbound && northbound.distance > 109 && northbound.distance < 112);
  assert.equal(findCourseToShore(coast, 0, 0, 180), null);
});

test("course intersection returns the first shoreline along the heading", () => {
  const coasts = [
    [-0.01, 0.004, 0.01, 0.004],
    [-0.01, 0.001, 0.01, 0.001],
  ];
  const result = findCourseToShore(coasts, 0, 0, 0);
  assert.ok(result && result.distance < 120);
});

test("offset-from-shore produces the requested cardinal distances", () => {
  const shore = { distance: 0, longitude: 15, latitude: 43, bearing: 0 };
  const north = offsetFromShore(shore, 0, 1_000);
  const east = offsetFromShore(shore, 90, 1_000);
  const origin = [15, 43, 15, 43];
  assert.ok(Math.abs(distanceToSegment(north.longitude, north.latitude, origin).distance - 1_000) < 1);
  assert.ok(Math.abs(distanceToSegment(east.longitude, east.latitude, origin).distance - 1_000) < 1);
});

test("Croatian coastline pack contains every coastal region and valid segment data", async () => {
  const pack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  assert.equal(pack.schemaVersion, 1);
  assert.equal(pack.region, "Croatia");
  assert.ok(pack.segmentCount > 250_000);
  assert.ok(Object.keys(pack.cells).length > 1_500);
  assert.ok(pack.bounds[0] < 13.6);
  assert.ok(pack.bounds[2] > 18.5);
  assert.ok(pack.bounds[1] < 42.4);
  assert.ok(pack.bounds[3] > 45.4);
  assert.match(pack.sourceUrl, /^https:\/\//);
  assert.ok(pack.attribution.length > 10);

  let storedSegments = 0;
  for (const values of Object.values(pack.cells)) {
    assert.equal(values.length % 4, 0);
    storedSegments += values.length / 4;
    for (const coordinate of values) assert.ok(Number.isFinite(coordinate));
  }
  assert.ok(storedSegments >= pack.segmentCount);
});
