import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isPointOnLand } from "../lib/shoreline.ts";
import {
  formatRouteDistance,
  geoBearing,
  geoDistanceMetres,
  planWaterRoute,
} from "../lib/route-planning.ts";

const ISLAND_PACK = {
  schemaVersion: 1,
  region: "Test",
  generatedAt: "2026-01-01T00:00:00Z",
  source: "test",
  sourceUrl: "https://example.com",
  attribution: "test",
  cellSize: 1,
  simplifyToleranceMeters: 0,
  bounds: [0, 0, 0.1, 0.1],
  segmentCount: 5,
  cells: {
    "0:0": [
      0.045, 0.03, 0.055, 0.03,
      0.055, 0.03, 0.055, 0.07,
      0.055, 0.07, 0.045, 0.07,
      0.045, 0.07, 0.045, 0.03,
      0.09, 0, 0.09, 0.1,
    ],
  },
};

const OPTIONS = {
  clearanceMetres: 100,
  cruiseSpeedKnots: 16,
  speedWarningEnabled: true,
  nearShoreSpeedKnots: 8,
};

const BLOCKED_CHANNEL_PACK = {
  ...ISLAND_PACK,
  segmentCount: 4,
  cells: {
    "0:0": [
      0.045, 0, 0.055, 0,
      0.055, 0, 0.055, 0.1,
      0.055, 0.1, 0.045, 0.1,
      0.045, 0.1, 0.045, 0,
    ],
  },
};

test("land classification distinguishes island, mainland, and open water", () => {
  assert.equal(isPointOnLand(ISLAND_PACK, 0.05, 0.05), true);
  assert.equal(isPointOnLand(ISLAND_PACK, 0.095, 0.05), true);
  assert.equal(isPointOnLand(ISLAND_PACK, 0.03, 0.05), false);
});

test("automatic routing detours around an island instead of crossing land", () => {
  const result = planWaterRoute(ISLAND_PACK, { longitude: 0.03, latitude: 0.05 }, { longitude: 0.07, latitude: 0.05 }, OPTIONS);
  assert.ok(result.route, result.failure);
  assert.ok(result.route.points.length > 2);
  assert.ok(result.route.distanceMetres > geoDistanceMetres(result.route.points[0], result.route.points.at(-1)));
  for (let index = 1; index < result.route.points.length; index += 1) {
    const start = result.route.points[index - 1];
    const end = result.route.points[index];
    const samples = Math.max(2, Math.ceil(geoDistanceMetres(start, end) / 40));
    for (let sample = 0; sample <= samples; sample += 1) {
      const position = sample / samples;
      const longitude = start.longitude + (end.longitude - start.longitude) * position;
      const latitude = start.latitude + (end.latitude - start.latitude) * position;
      assert.equal(isPointOnLand(ISLAND_PACK, longitude, latitude), false, `${longitude},${latitude}`);
    }
  }
});

test("a destination on land is rejected before a route is advertised", () => {
  assert.deepEqual(
    planWaterRoute(ISLAND_PACK, { longitude: 0.03, latitude: 0.05 }, { longitude: 0.05, latitude: 0.05 }, OPTIONS),
    { failure: "destination-on-land" },
  );
});

test("a completely blocked waterway returns no route instead of crossing land", () => {
  assert.deepEqual(
    planWaterRoute(BLOCKED_CHANNEL_PACK, { longitude: 0.03, latitude: 0.05 }, { longitude: 0.07, latitude: 0.05 }, OPTIONS),
    { failure: "no-route" },
  );
});

test("out-of-region and overly distant destinations return explicit failures", () => {
  assert.equal(planWaterRoute(ISLAND_PACK, { longitude: -1, latitude: 0.05 }, { longitude: 0.03, latitude: 0.05 }, OPTIONS).failure, "outside-region");
  assert.equal(planWaterRoute(ISLAND_PACK, { longitude: 0.01, latitude: 0.01 }, { longitude: 0.08, latitude: 0.08 }, { ...OPTIONS, maximumDistanceMetres: 1_000 }).failure, "too-far");
});

test("speed settings affect ETA without changing geometric distance", () => {
  const start = { longitude: 0.01, latitude: 0.015 };
  const destination = { longitude: 0.02, latitude: 0.015 };
  const fast = planWaterRoute(ISLAND_PACK, start, destination, { ...OPTIONS, cruiseSpeedKnots: 20, speedWarningEnabled: false });
  const slow = planWaterRoute(ISLAND_PACK, start, destination, { ...OPTIONS, cruiseSpeedKnots: 10, speedWarningEnabled: false });
  assert.ok(fast.route && slow.route);
  assert.ok(Math.abs(fast.route.distanceMetres - slow.route.distanceMetres) < 1);
  assert.ok(slow.route.estimatedSeconds > fast.route.estimatedSeconds * 1.9);
});

test("a sub-30-metre target produces a direct two-point route", () => {
  const start = { longitude: 0.01, latitude: 0.01 };
  const destination = { longitude: 0.0101, latitude: 0.01 };
  const result = planWaterRoute(ISLAND_PACK, start, destination, OPTIONS);
  assert.ok(result.route, result.failure);
  assert.deepEqual(result.route.points, [start, destination]);
  assert.ok(result.route.distanceMetres > 0 && result.route.distanceMetres < 30);
});

test("negative and zero planning settings are sanitized to safe finite values", () => {
  const result = planWaterRoute(
    ISLAND_PACK,
    { longitude: 0.01, latitude: 0.015 },
    { longitude: 0.02, latitude: 0.015 },
    { clearanceMetres: -300, cruiseSpeedKnots: 0, speedWarningEnabled: true, nearShoreSpeedKnots: -2 },
  );
  assert.ok(result.route, result.failure);
  assert.ok(Number.isFinite(result.route.estimatedSeconds));
  assert.ok(result.route.estimatedSeconds > 0);
});

test("near-shore ETA honors the configured speed limit when enabled", () => {
  const start = { longitude: 0.056, latitude: 0.05 };
  const destination = { longitude: 0.065, latitude: 0.05 };
  const limited = planWaterRoute(ISLAND_PACK, start, destination, { ...OPTIONS, clearanceMetres: 300, cruiseSpeedKnots: 20, nearShoreSpeedKnots: 5, speedWarningEnabled: true });
  const unlimited = planWaterRoute(ISLAND_PACK, start, destination, { ...OPTIONS, clearanceMetres: 300, cruiseSpeedKnots: 20, speedWarningEnabled: false });
  assert.ok(limited.route && unlimited.route);
  assert.ok(limited.route.restrictedDistanceMetres > 0);
  assert.ok(limited.route.estimatedSeconds > unlimited.route.estimatedSeconds);
  assert.equal(limited.route.mode, "restricted");
});

test("a route that maintains clearance is explicitly marked safe", () => {
  const result = planWaterRoute(
    ISLAND_PACK,
    { longitude: 0.01, latitude: 0.015 },
    { longitude: 0.02, latitude: 0.015 },
    { ...OPTIONS, clearanceMetres: 300 },
  );
  assert.ok(result.route, result.failure);
  assert.equal(result.route.mode, "clearance");
  assert.equal(result.route.restrictedDistanceMetres, 0);
  assert.ok(result.route.minimumShoreDistanceMetres >= 300);
});

test("non-finite coordinates fail closed outside the offline region", () => {
  assert.equal(planWaterRoute(ISLAND_PACK, { longitude: Number.NaN, latitude: 0.05 }, { longitude: 0.03, latitude: 0.05 }, OPTIONS).failure, "outside-region");
  assert.equal(planWaterRoute(ISLAND_PACK, { longitude: 0.03, latitude: 0.05 }, { longitude: Number.POSITIVE_INFINITY, latitude: 0.05 }, OPTIONS).failure, "outside-region");
});

test("distance and bearing helpers use nautical conventions", () => {
  const origin = { longitude: 15, latitude: 43 };
  const north = { longitude: 15, latitude: 43.01 };
  const east = { longitude: 15.01, latitude: 43 };
  assert.ok(geoDistanceMetres(origin, north) > 1_100);
  assert.ok(Math.abs(geoBearing(origin, north)) < 0.001);
  assert.ok(geoBearing(origin, east) > 89.9 && geoBearing(origin, east) < 90.1);
  assert.equal(formatRouteDistance(1_852), 1);
  assert.equal(geoDistanceMetres(origin, origin), 0);
  assert.equal(geoBearing(origin, origin), 0);
});

test("the bundled Croatia chart produces a water-only route with configured clearance", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const result = planWaterRoute(
    croatiaPack,
    { longitude: 15.4, latitude: 43.8 },
    { longitude: 15.5, latitude: 43.8 },
    { ...OPTIONS, clearanceMetres: 300 },
  );
  assert.ok(result.route, result.failure);
  assert.equal(result.route.mode, "clearance");
  assert.ok(result.route.distanceMetres > 7_500 && result.route.distanceMetres < 10_000);
  assert.ok(result.route.minimumShoreDistanceMetres >= 300);
  for (let index = 1; index < result.route.points.length; index += 1) {
    const start = result.route.points[index - 1];
    const end = result.route.points[index];
    const samples = Math.max(2, Math.ceil(geoDistanceMetres(start, end) / 75));
    for (let sample = 0; sample <= samples; sample += 1) {
      const position = sample / samples;
      assert.equal(isPointOnLand(croatiaPack,
        start.longitude + (end.longitude - start.longitude) * position,
        start.latitude + (end.latitude - start.latitude) * position,
      ), false);
    }
  }
});
