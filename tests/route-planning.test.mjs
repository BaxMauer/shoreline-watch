import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { findNearestShore, isPointOnLand } from "../lib/shoreline.ts";
import { ROUTE_PASSAGE_HINTS } from "../lib/route-passages.ts";
import {
  comparePlannedRoutes,
  formatRouteDistance,
  getPreferredRouteClearanceMetres,
  getStartFixCorrectionTolerance,
  getRouteGridResolutions,
  geoBearing,
  geoDistanceMetres,
  planWaterRoute,
  routeGeometryIsWaterOnly,
  routeSegmentCrossesShoreline,
  ROUTE_CLEARANCE_MARGIN_METRES,
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

const NARROW_PASSAGE_PACK = {
  ...ISLAND_PACK,
  region: "Narrow passage",
  segmentCount: 8,
  cells: {
    "0:0": [
      0.045, 0, 0.055, 0,
      0.055, 0, 0.055, 0.04955,
      0.055, 0.04955, 0.045, 0.04955,
      0.045, 0.04955, 0.045, 0,
      0.045, 0.05045, 0.055, 0.05045,
      0.055, 0.05045, 0.055, 0.1,
      0.055, 0.1, 0.045, 0.1,
      0.045, 0.1, 0.045, 0.05045,
    ],
  },
};

const TWO_ISLAND_NARROWS_PACK = {
  ...ISLAND_PACK,
  region: "Two-island narrows",
  segmentCount: 8,
  cells: {
    "0:0": [
      0.045, 0, 0.055, 0,
      0.055, 0, 0.055, 0.04937,
      0.055, 0.04937, 0.045, 0.04937,
      0.045, 0.04937, 0.045, 0,
      0.045, 0.05063, 0.055, 0.05063,
      0.055, 0.05063, 0.055, 0.1,
      0.055, 0.1, 0.045, 0.1,
      0.045, 0.1, 0.045, 0.05063,
    ],
  },
};

const LONG_PENINSULA_PACK = {
  ...ISLAND_PACK,
  region: "Long peninsula detour",
  segmentCount: 4,
  cells: {
    "0:0": [
      0.045, 0.015, 0.055, 0.015,
      0.055, 0.015, 0.055, 0.085,
      0.055, 0.085, 0.045, 0.085,
      0.045, 0.085, 0.045, 0.015,
    ],
  },
};

const SHORT_ISLAND_PACK = {
  ...ISLAND_PACK,
  region: "Short route obstacle",
  cellSize: 0.001,
  segmentCount: 4,
  cells: {
    "10:10": [
      0.01008, 0.0099, 0.01012, 0.0099,
      0.01012, 0.0099, 0.01012, 0.0101,
      0.01012, 0.0101, 0.01008, 0.0101,
      0.01008, 0.0101, 0.01008, 0.0099,
    ],
  },
};

test("land classification distinguishes island, mainland, and open water", () => {
  assert.equal(isPointOnLand(ISLAND_PACK, 0.05, 0.05), true);
  assert.equal(isPointOnLand(ISLAND_PACK, 0.095, 0.05), true);
  assert.equal(isPointOnLand(ISLAND_PACK, 0.03, 0.05), false);
});

test("the reported Jezera route remains connected through the Croatia pack", async () => {
  const coastline = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const start = { latitude: 43.6845, longitude: 15.7315 };
  const destination = { latitude: 43.7645, longitude: 15.6658 };
  const result = planWaterRoute(coastline, start, destination, {
    clearanceMetres: 300,
    cruiseSpeedKnots: 16,
    speedWarningEnabled: true,
    nearShoreSpeedKnots: 8,
  });

  assert.ok(result.route, result.failure);
  assert.ok(result.route.distanceMetres > 10_000 && result.route.distanceMetres < 13_000);
  assert.equal(routeGeometryIsWaterOnly(coastline, result.route.points), true);
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

test("expanded routing leaves the direct corridor to get around a long peninsula", () => {
  const start = { longitude: 0.03, latitude: 0.05 };
  const destination = { longitude: 0.07, latitude: 0.05 };
  const result = planWaterRoute(LONG_PENINSULA_PACK, start, destination, OPTIONS);
  assert.ok(result.route, result.failure);
  assert.ok(result.route.distanceMetres > geoDistanceMetres(start, destination) * 1.7);
  assert.ok(result.route.points.some((point) => point.latitude < 0.015 || point.latitude > 0.085));
  for (let index = 1; index < result.route.points.length; index += 1) {
    assert.equal(routeSegmentCrossesShoreline(LONG_PENINSULA_PACK, result.route.points[index - 1], result.route.points[index]), false);
  }
});

test("a coastal GPS fix just inside the chart can make one short outward correction", () => {
  const start = { longitude: 0.0451, latitude: 0.05 };
  const destination = { longitude: 0.03, latitude: 0.05 };
  assert.equal(isPointOnLand(ISLAND_PACK, start.longitude, start.latitude), true);
  const result = planWaterRoute(ISLAND_PACK, start, destination, { ...OPTIONS, startAccuracyMetres: 12 });
  assert.ok(result.route, result.failure);
  assert.equal(result.route.mode, "restricted");
  assert.ok(geoDistanceMetres(result.route.points[0], result.route.points[1]) <= 96);
  for (let index = 2; index < result.route.points.length; index += 1) {
    assert.equal(routeSegmentCrossesShoreline(ISLAND_PACK, result.route.points[index - 1], result.route.points[index]), false);
  }
});

test("start-fix correction requires trustworthy bounded accuracy", () => {
  assert.equal(getStartFixCorrectionTolerance(undefined), 0);
  assert.equal(getStartFixCorrectionTolerance(Number.NaN), 0);
  assert.equal(getStartFixCorrectionTolerance(0), 0);
  assert.equal(getStartFixCorrectionTolerance(12), 96);
  assert.equal(getStartFixCorrectionTolerance(50), 100);
  assert.equal(getStartFixCorrectionTolerance(50.01), 0);

  const start = { longitude: 0.0451, latitude: 0.05 };
  const destination = { longitude: 0.03, latitude: 0.05 };
  assert.deepEqual(planWaterRoute(ISLAND_PACK, start, destination, OPTIONS), { failure: "no-route" });
  assert.deepEqual(
    planWaterRoute(ISLAND_PACK, start, destination, { ...OPTIONS, startAccuracyMetres: 51 }),
    { failure: "no-route" },
  );
});

test("start-fix recovery cannot tunnel from deep inside land", () => {
  assert.deepEqual(
    planWaterRoute(ISLAND_PACK, { longitude: 0.05, latitude: 0.05 }, { longitude: 0.03, latitude: 0.05 }, { ...OPTIONS, startAccuracyMetres: 5 }),
    { failure: "no-route" },
  );
});

test("start-fix recovery rejects repeated land and water crossings inside its tolerance", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const start = { longitude: 16.50669714538323, latitude: 43.50164311580879 };
  const destination = { longitude: 16.50647039376755, latitude: 43.501287361410505 };
  assert.equal(isPointOnLand(croatiaPack, start.longitude, start.latitude), true);
  assert.equal(isPointOnLand(croatiaPack, destination.longitude, destination.latitude), false);
  assert.deepEqual(
    planWaterRoute(croatiaPack, start, destination, { ...OPTIONS, startAccuracyMetres: 12 }),
    { failure: "no-route" },
  );
});

test("adaptive refinement finds a roughly 100-metre narrow passage", () => {
  const result = planWaterRoute(
    NARROW_PASSAGE_PACK,
    { longitude: 0.03, latitude: 0.05 },
    { longitude: 0.07, latitude: 0.05 },
    { ...OPTIONS, clearanceMetres: 30 },
  );
  assert.ok(result.route, result.failure);
  assert.ok(result.route.points.length <= 3, "line-of-sight smoothing should remove raster staircase points");
  assert.equal(result.route.mode, "clearance");
  assert.ok(result.route.minimumShoreDistanceMetres >= 30);
  for (let index = 1; index < result.route.points.length; index += 1) {
    const start = result.route.points[index - 1];
    const end = result.route.points[index];
    const samples = Math.max(2, Math.ceil(geoDistanceMetres(start, end) / 20));
    for (let sample = 0; sample <= samples; sample += 1) {
      const position = sample / samples;
      assert.equal(isPointOnLand(NARROW_PASSAGE_PACK,
        start.longitude + (end.longitude - start.longitude) * position,
        start.latitude + (end.latitude - start.latitude) * position,
      ), false);
    }
  }
});

test("route planning adds a fixed 50-metre margin to the configured clearance", () => {
  assert.equal(ROUTE_CLEARANCE_MARGIN_METRES, 50);
  assert.equal(getPreferredRouteClearanceMetres(300), 350);
  assert.equal(getPreferredRouteClearanceMetres(-20), 50);
  assert.equal(getPreferredRouteClearanceMetres(Number.NaN), 50);

  const result = planWaterRoute(
    ISLAND_PACK,
    { longitude: 0.03, latitude: 0.05 },
    { longitude: 0.07, latitude: 0.05 },
    { ...OPTIONS, clearanceMetres: 100 },
  );
  assert.ok(result.route, result.failure);
  assert.ok(result.route.minimumShoreDistanceMetres >= 100, "the faster route must still preserve the configured minimum");
});

test("an unavoidable two-island narrows is routed along its widest middle", () => {
  const result = planWaterRoute(
    TWO_ISLAND_NARROWS_PACK,
    { longitude: 0.03, latitude: 0.0495 },
    { longitude: 0.07, latitude: 0.0495 },
    { ...OPTIONS, clearanceMetres: 30 },
  );
  assert.ok(result.route, result.failure);
  const channelPoints = [];
  for (let index = 1; index < result.route.points.length; index += 1) {
    const start = result.route.points[index - 1];
    const end = result.route.points[index];
    for (const longitude of [0.046, 0.05, 0.054]) {
      if (longitude < Math.min(start.longitude, end.longitude) || longitude > Math.max(start.longitude, end.longitude)) continue;
      const position = (longitude - start.longitude) / (end.longitude - start.longitude);
      channelPoints.push({
        longitude,
        latitude: start.latitude + (end.latitude - start.latitude) * position,
      });
    }
  }
  assert.ok(channelPoints.length >= 3);
  for (const point of channelPoints) {
    const lowerDistance = (point.latitude - 0.04937) * 110_540;
    const upperDistance = (0.05063 - point.latitude) * 110_540;
    assert.ok(Math.abs(lowerDistance - upperDistance) < 10, `channel imbalance was ${Math.abs(lowerDistance - upperDistance)} m`);
  }
  assert.ok(result.route.minimumShoreDistanceMetres >= 55, "the bottleneck should maximize clearance instead of hugging one island");
});

test("route candidates are ordered by ETA before clearance and geometric distance", () => {
  const route = (estimatedSeconds, distanceMetres, minimumShoreDistanceMetres, passageIds = []) => ({
    points: [],
    estimatedSeconds,
    distanceMetres,
    minimumShoreDistanceMetres,
    restrictedDistanceMetres: 0,
    mode: "clearance",
    passageIds,
  });
  const fast = route(600, 8_000, 360);
  const shortButSlow = route(900, 6_000, 500);
  assert.ok(comparePlannedRoutes(fast, shortButSlow, 300) < 0, "ETA, not geometric distance, must decide");

  const offCentre = route(500, 5_000, 45);
  const centred = route(650, 5_300, 65);
  assert.ok(comparePlannedRoutes(offCentre, centred, 30) < 0, "a material ETA improvement must win candidate selection");

  const equallyFastOffCentre = route(650, 5_000, 45);
  assert.ok(comparePlannedRoutes(centred, equallyFastOffCentre, 30) < 0, "clearance should break an ETA tie");
});

test("route grid adds fine resolution while bounding long-route node counts", () => {
  const local = getRouteGridResolutions(10_000, 10_000, 300);
  assert.equal(local.length, 2);
  assert.ok(local[1] <= 90);
  assert.equal(local[0] % 25, 0);
  assert.equal(local[1] % 5, 0);
  const long = getRouteGridResolutions(140_000, 80_000, 300);
  assert.equal(long.length, 2);
  assert.equal(long[0] % 25, 0);
  assert.equal(long[1] % 5, 0);
  const estimatedFineNodes = 140_000 * 80_000 / (long[1] ** 2);
  assert.ok(estimatedFineNodes <= 260_001);
  assert.deepEqual(
    getRouteGridResolutions(39_693, 50_116, 300),
    getRouteGridResolutions(39_696, 50_119, 300),
    "metre-scale GPS jitter must not shift every cell in a long route grid",
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

test("a sub-30-metre target produces a validated direct two-point route", () => {
  const start = { longitude: 0.01, latitude: 0.01 };
  const destination = { longitude: 0.0101, latitude: 0.01 };
  const result = planWaterRoute(ISLAND_PACK, start, destination, OPTIONS);
  assert.ok(result.route, result.failure);
  assert.deepEqual(result.route.points, [start, destination]);
  assert.ok(result.route.distanceMetres > 0 && result.route.distanceMetres < 30);
});

test("a sub-30-metre route cannot cross a tiny shoreline obstacle", () => {
  const start = { longitude: 0.01, latitude: 0.01 };
  const destination = { longitude: 0.0102, latitude: 0.01 };
  assert.ok(geoDistanceMetres(start, destination) < 30);
  assert.equal(routeGeometryIsWaterOnly(SHORT_ISLAND_PACK, [start, destination]), false);
  assert.deepEqual(planWaterRoute(SHORT_ISLAND_PACK, start, destination, OPTIONS), { failure: "no-route" });
});

test("a short direct route uses conservative minimum-clearance sampling", () => {
  const start = { longitude: 0.01, latitude: 0.01015 };
  const destination = { longitude: 0.0102, latitude: 0.01015 };
  const result = planWaterRoute(SHORT_ISLAND_PACK, start, destination, { ...OPTIONS, clearanceMetres: 20 });
  assert.ok(result.route, result.failure);
  assert.deepEqual(result.route.points, [start, destination]);
  assert.equal(result.route.mode, "restricted");
  assert.ok(result.route.minimumShoreDistanceMetres < 20);
  assert.ok(result.route.restrictedDistanceMetres > 0);
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
  assert.deepEqual(result.route.passageIds, []);
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

test("the Kaprije screenshot route rejects the long western detour and keeps useful turns", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const result = planWaterRoute(
    croatiaPack,
    { longitude: 15.666, latitude: 43.688 },
    { longitude: 15.7068, latitude: 43.6875 },
    { ...OPTIONS, clearanceMetres: 300, startAccuracyMetres: 12 },
  );
  assert.ok(result.route, result.failure);
  assert.ok(formatRouteDistance(result.route.distanceMetres) < 3.5, "the route must not repeat the 6.5-mile western loop");
  assert.ok(result.route.estimatedSeconds < 1_300, "the selected route must be the materially faster candidate");
  assert.ok(result.route.points.length >= 7, "coastal turns should not be collapsed into a few oversized corners");
  const longestLeg = Math.max(...result.route.points.slice(1).map((point, index) => geoDistanceMetres(result.route.points[index], point)));
  assert.ok(longestLeg < 1_600, `route leg was too coarse at ${longestLeg} m`);
  assert.equal(routeGeometryIsWaterOnly(croatiaPack, result.route.points, getStartFixCorrectionTolerance(12)), true);
});

test("the Jezera to Zmajan screenshot routes are stable across a sub-cell start shift", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const start = { longitude: 15.642843257016645, latitude: 43.785223881290165 };
  for (const destination of [
    { longitude: 15.7595, latitude: 43.7129 },
    { longitude: 15.7318, latitude: 43.7138 },
  ]) {
    const result = planWaterRoute(
      croatiaPack,
      start,
      destination,
      { ...OPTIONS, clearanceMetres: 300, startAccuracyMetres: 12 },
    );
    assert.ok(result.route, result.failure);
    assert.ok(formatRouteDistance(result.route.distanceMetres) < 8, "the route must stay inside the local island corridor");
    assert.equal(routeGeometryIsWaterOnly(croatiaPack, result.route.points), true);
  }
});

test("the long Jezera to Primošten screenshot route stays connected through the island chain", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const baseStart = { longitude: 15.642843257016645, latitude: 43.785223881290165 };
  const tenMetresLongitude = 10 / (111_320 * Math.cos(baseStart.latitude * Math.PI / 180));
  const tenMetresLatitude = 10 / 110_540;
  const destination = { longitude: 15.7905, latitude: 43.5834 };
  const jitteredStarts = [-1, 0, 1].flatMap((east) => [-1, 0, 1].map((north) => ({
    longitude: baseStart.longitude + east * tenMetresLongitude,
    latitude: baseStart.latitude + north * tenMetresLatitude,
  })));
  for (const start of [{ longitude: 15.64284, latitude: 43.7852 }, ...jitteredStarts]) {
    const result = planWaterRoute(
      croatiaPack,
      start,
      destination,
      { ...OPTIONS, clearanceMetres: 300, startAccuracyMetres: 12 },
    );

    assert.ok(result.route, result.failure);
    assert.ok(result.route.distanceMetres > 25_000 && formatRouteDistance(result.route.distanceMetres) < 18);
    assert.ok(result.route.points.length >= 5, "the route must preserve turns around the island chain");
    assert.equal(routeGeometryIsWaterOnly(croatiaPack, result.route.points), true);
  }
});

test("the Žirje screenshot narrows follows the widest channel centreline", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const result = planWaterRoute(
    croatiaPack,
    { longitude: 15.664672, latitude: 43.688393 },
    { longitude: 15.6916, latitude: 43.6901 },
    { ...OPTIONS, clearanceMetres: 300, startAccuracyMetres: 12 },
  );
  assert.ok(result.route, result.failure);
  assert.ok(formatRouteDistance(result.route.distanceMetres) < 3, "the centred route must stay inside the short southern corridor");

  for (const latitude of [43.6795, 43.6805, 43.6815]) {
    const crossings = [];
    for (let index = 1; index < result.route.points.length; index += 1) {
      const start = result.route.points[index - 1];
      const end = result.route.points[index];
      if (start.latitude === end.latitude
        || latitude < Math.min(start.latitude, end.latitude)
        || latitude > Math.max(start.latitude, end.latitude)) continue;
      const progress = (latitude - start.latitude) / (end.latitude - start.latitude);
      const longitude = start.longitude + (end.longitude - start.longitude) * progress;
      if (longitude >= 15.692 && longitude <= 15.7) crossings.push({ longitude, latitude });
    }
    assert.ok(crossings.length > 0, `route did not cross the channel at ${latitude}`);
    const routeClearance = Math.max(...crossings.map((point) => findNearestShore(
      croatiaPack,
      point.longitude,
      point.latitude,
    )?.distance ?? 0));
    let widestClearance = 0;
    for (let longitude = 15.692; longitude <= 15.7; longitude += 0.00005) {
      if (isPointOnLand(croatiaPack, longitude, latitude)) continue;
      widestClearance = Math.max(widestClearance, findNearestShore(croatiaPack, longitude, latitude)?.distance ?? 0);
    }
    assert.ok(
      widestClearance - routeClearance <= 60,
      `channel route lost ${(widestClearance - routeClearance).toFixed(1)} m of available clearance at ${latitude}`,
    );
  }
});

test("the bundled Croatia chart uses the shorter Tisno passage when near-shore speed is unrestricted", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const start = { longitude: 15.61, latitude: 43.72 };
  const destination = { longitude: 15.65, latitude: 43.82 };
  const startedAt = performance.now();
  const result = planWaterRoute(croatiaPack, start, destination, {
    ...OPTIONS,
    clearanceMetres: 300,
    startAccuracyMetres: 12,
    speedWarningEnabled: false,
  });
  assert.ok(result.route, result.failure);
  assert.ok(performance.now() - startedAt < 5_000, "route calculation must remain interactive on a phone");
  assert.equal(result.route.mode, "restricted");
  assert.deepEqual(result.route.passageIds, ["tisno-murter-bridge"]);
  assert.ok(result.route.distanceMetres < 21_000);
  for (let index = 1; index < result.route.points.length; index += 1) {
    assert.equal(routeSegmentCrossesShoreline(croatiaPack, result.route.points[index - 1], result.route.points[index]), false);
  }
});

test("the Pakoštane screenshot corridor no longer produces a 29-mile raster detour", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const start = { longitude: 15.8074, latitude: 43.6946 };
  const destination = { longitude: 15.5, latitude: 43.82 };
  const startedAt = performance.now();
  const result = planWaterRoute(croatiaPack, start, destination, {
    ...OPTIONS,
    clearanceMetres: 300,
    startAccuracyMetres: 12,
  });

  assert.ok(result.route, result.failure);
  assert.ok(performance.now() - startedAt < 5_000, "screenshot route must remain interactive on a phone");
  assert.ok(formatRouteDistance(result.route.distanceMetres) < 18, "A* should reject the former 29-mile detour");
  assert.ok(result.route.points.length <= 8, "the displayed route should not expose raster staircase turns");
  assert.equal(routeGeometryIsWaterOnly(croatiaPack, result.route.points), true);
});

test("the Tisno passage remains water-only and works in reverse at unrestricted speed", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const passage = ROUTE_PASSAGE_HINTS.find(({ id }) => id === "tisno-murter-bridge");
  assert.ok(passage);
  assert.equal(isPointOnLand(croatiaPack, passage.gate[0].longitude, passage.gate[0].latitude), true);
  assert.equal(isPointOnLand(croatiaPack, passage.gate[1].longitude, passage.gate[1].latitude), true);
  const cross = (start, end, point) => (end.longitude - start.longitude) * (point.latitude - start.latitude)
    - (end.latitude - start.latitude) * (point.longitude - start.longitude);
  assert.ok(passage.points.slice(1).some((point, index) => {
    const previous = passage.points[index];
    const gateStartSide = cross(previous, point, passage.gate[0]);
    const gateEndSide = cross(previous, point, passage.gate[1]);
    const passageStartSide = cross(passage.gate[0], passage.gate[1], previous);
    const passageEndSide = cross(passage.gate[0], passage.gate[1], point);
    return gateStartSide * gateEndSide <= 0 && passageStartSide * passageEndSide <= 0;
  }), "the water-only passage centreline must cross its shore-to-shore gate");
  assert.equal(routeGeometryIsWaterOnly(croatiaPack, passage.points), true);
  for (let index = 1; index < passage.points.length; index += 1) {
    assert.equal(routeSegmentCrossesShoreline(croatiaPack, passage.points[index - 1], passage.points[index]), false);
  }

  const result = planWaterRoute(
    croatiaPack,
    { longitude: 15.65, latitude: 43.82 },
    { longitude: 15.61, latitude: 43.72 },
    { ...OPTIONS, clearanceMetres: 300, startAccuracyMetres: 12, speedWarningEnabled: false },
  );
  assert.ok(result.route, result.failure);
  assert.equal(result.route.mode, "restricted");
  assert.deepEqual(result.route.passageIds, ["tisno-murter-bridge"]);
  assert.ok(result.route.distanceMetres < 22_500);
});

test("the screenshot route recovers a charted-land GPS fix before using the Tisno passage", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const start = { longitude: 15.642176, latitude: 43.785804 };
  const destination = { longitude: 15.630405, latitude: 43.818146 };
  const startAccuracyMetres = 5;
  const startedAt = performance.now();
  const result = planWaterRoute(croatiaPack, start, destination, {
    ...OPTIONS,
    clearanceMetres: 300,
    startAccuracyMetres,
  });

  assert.ok(result.route, result.failure);
  assert.ok(performance.now() - startedAt < 5_000, "screenshot route must remain interactive on a phone");
  assert.equal(isPointOnLand(croatiaPack, start.longitude, start.latitude), true);
  assert.equal(isPointOnLand(croatiaPack, result.route.points[1].longitude, result.route.points[1].latitude), false);
  assert.ok(geoDistanceMetres(result.route.points[0], result.route.points[1]) <= getStartFixCorrectionTolerance(startAccuracyMetres));
  assert.equal(routeGeometryIsWaterOnly(croatiaPack, result.route.points, getStartFixCorrectionTolerance(startAccuracyMetres)), true);
  assert.equal(result.route.mode, "restricted");
  assert.deepEqual(result.route.passageIds, ["tisno-murter-bridge"]);
  assert.ok(result.route.distanceMetres < 10_000);
  for (let index = 2; index < result.route.points.length; index += 1) {
    assert.equal(routeSegmentCrossesShoreline(croatiaPack, result.route.points[index - 1], result.route.points[index]), false);
  }
});

test("charted-land start recovery stays bounded by the accuracy-derived correction tolerance", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const result = planWaterRoute(
    croatiaPack,
    { longitude: 15.642176, latitude: 43.785804 },
    { longitude: 15.630405, latitude: 43.818146 },
    { ...OPTIONS, clearanceMetres: 300, startAccuracyMetres: 2 },
  );
  assert.equal(result.failure, "no-route");
});

test("every actual Tisno gate crossing is conditional even without hint nodes", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const passage = ROUTE_PASSAGE_HINTS.find(({ id }) => id === "tisno-murter-bridge");
  assert.ok(passage);
  const start = passage.points[4];
  const destination = { longitude: 15.630, latitude: 43.801 };
  const enabled = planWaterRoute(croatiaPack, start, destination, { ...OPTIONS, clearanceMetres: 300 });
  assert.ok(enabled.route, enabled.failure);
  assert.equal(enabled.route.mode, "restricted");
  assert.deepEqual(enabled.route.passageIds, ["tisno-murter-bridge"]);
  assert.ok(enabled.route.distanceMetres < 1_500);

  const disabled = planWaterRoute(croatiaPack, start, destination, {
    ...OPTIONS,
    clearanceMetres: 300,
    conditionalPassagesEnabled: false,
  });
  assert.ok(disabled.route, disabled.failure);
  assert.deepEqual(disabled.route.passageIds, []);
  assert.ok(disabled.route.distanceMetres > 20_000);
});

test("conditional passage routing can be disabled without weakening shoreline checks", async () => {
  const croatiaPack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const result = planWaterRoute(
    croatiaPack,
    { longitude: 15.61, latitude: 43.72 },
    { longitude: 15.65, latitude: 43.82 },
    { ...OPTIONS, clearanceMetres: 300, startAccuracyMetres: 12, conditionalPassagesEnabled: false },
  );
  assert.ok(result.route, result.failure);
  assert.deepEqual(result.route.passageIds, []);
  assert.ok(result.route.distanceMetres > 20_000);
  for (let index = 1; index < result.route.points.length; index += 1) {
    assert.equal(routeSegmentCrossesShoreline(croatiaPack, result.route.points[index - 1], result.route.points[index]), false);
  }
});
