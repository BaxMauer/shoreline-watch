import assert from "node:assert/strict";
import test from "node:test";
import {
  MAXIMUM_CRUISE_SPEED_KNOTS,
  MAXIMUM_ACTIVE_ROUTE_VIEW_METRES,
  MAXIMUM_ROUTE_VIEW_METRES,
  MINIMUM_CRUISE_SPEED_KNOTS,
  MINIMUM_ACTIVE_ROUTE_VIEW_METRES,
  MINIMUM_ROUTE_VIEW_METRES,
  ROUTE_ARRIVAL_RADIUS_METRES,
  buildEmodnetBathymetryTiles,
  canPlanRoute,
  clampActiveRouteViewRange,
  clampCruiseSpeed,
  clampRouteViewRange,
  createBathymetryLoadTracker,
  formatRouteClearance,
  formatRouteEta,
  getActiveRouteViewRange,
  getProgressAwareRouteGuidance,
  getRouteMapPreviewTransform,
  getRouteMapInteractionInterval,
  getRouteMapRefreshInterval,
  getRouteMapRenderingDetail,
  getRouteReadinessState,
  hasReachedRouteTarget,
  parseRouteCoordinate,
  panRouteMapCentre,
  pinchRouteViewRange,
  routeMapPixelToGeo,
  routeProgressPercent,
  routeRemainingDistance,
  routeCoordinateIsValid,
  routeRerouteThreshold,
  routeViewRangeForTarget,
  recordBathymetryTileResult,
  shouldRerouteRoute,
} from "../lib/route-ui.ts";

test("destination coordinates accept German and international decimals", () => {
  assert.equal(parseRouteCoordinate("43,801234"), 43.801234);
  assert.equal(parseRouteCoordinate(" 15.551234 "), 15.551234);
  assert.equal(parseRouteCoordinate("-0,25"), -0.25);
});

test("empty, partial, and malformed coordinates are rejected", () => {
  for (const value of ["", " ", "43.8 north", "--15", "12,3,4", "NaN", "Infinity"]) {
    assert.equal(parseRouteCoordinate(value), null, value);
  }
});

test("route points reject impossible latitude and longitude values", () => {
  assert.equal(routeCoordinateIsValid({ latitude: 43.8, longitude: 15.6 }), true);
  assert.equal(routeCoordinateIsValid({ latitude: 91, longitude: 15.6 }), false);
  assert.equal(routeCoordinateIsValid({ latitude: 43.8, longitude: 361 }), false);
  assert.equal(routeCoordinateIsValid({ latitude: Number.NaN, longitude: 15.6 }), false);
});

test("EMODnet bathymetry uses bounded cached tiles that cover the visible route map", () => {
  const tiles = buildEmodnetBathymetryTiles({ latitude: 43.8, longitude: 15.6 }, 10_000, 720);
  assert.ok(tiles.length >= 4);
  assert.ok(tiles.length <= 20);
  for (const tile of tiles) {
    const url = new URL(tile.url);
    assert.equal(url.origin, "https://tiles.emodnet-bathymetry.eu");
    assert.match(url.pathname, /\/2020\/baselayer\/web_mercator\/\d+\/\d+\/\d+\.png$/);
    assert.ok(tile.west < tile.east);
    assert.ok(tile.south < tile.north);
  }
  assert.ok(Math.min(...tiles.map((tile) => tile.west)) < 15.6);
  assert.ok(Math.max(...tiles.map((tile) => tile.east)) > 15.6);
  assert.ok(Math.min(...tiles.map((tile) => tile.south)) < 43.8);
  assert.ok(Math.max(...tiles.map((tile) => tile.north)) > 43.8);
  assert.deepEqual(buildEmodnetBathymetryTiles({ latitude: 90, longitude: 15.6 }, 10_000), []);
});

test("bathymetry waits for a complete remounted tile generation and keeps errors sticky", () => {
  const firstGeneration = createBathymetryLoadTracker("a", 2);
  assert.equal(recordBathymetryTileResult(firstGeneration, "shared", "loaded"), "loading");
  assert.equal(recordBathymetryTileResult(firstGeneration, "old-edge", "loaded"), "ready");

  const overlappingGeneration = createBathymetryLoadTracker("b", 2);
  assert.equal(recordBathymetryTileResult(overlappingGeneration, "shared", "loaded"), "loading");
  assert.equal(recordBathymetryTileResult(overlappingGeneration, "new-edge", "loaded"), "ready");

  const failedGeneration = createBathymetryLoadTracker("c", 3);
  assert.equal(recordBathymetryTileResult(failedGeneration, "broken", "failed"), "error");
  assert.equal(recordBathymetryTileResult(failedGeneration, "healthy-1", "loaded"), "error");
  assert.equal(recordBathymetryTileResult(failedGeneration, "healthy-2", "loaded"), "error");
});

test("active route progress remains bounded and detects arrival", () => {
  assert.equal(routeRemainingDistance(1_000, 250), 750);
  assert.equal(routeRemainingDistance(1_000, 1_500), 0);
  assert.equal(routeProgressPercent(1_000, 250), 25);
  assert.equal(routeProgressPercent(1_000, 1_500), 100);
  assert.equal(routeProgressPercent(0, 500), 0);
  const target = { latitude: 43.8, longitude: 15.6 };
  assert.equal(hasReachedRouteTarget(target, target), true);
  assert.equal(hasReachedRouteTarget({ latitude: 43.798, longitude: 15.6 }, target), false);
  assert.equal(ROUTE_ARRIVAL_RADIUS_METRES, 75);
});

test("route ETA formats short and multi-hour journeys without a 60-minute display", () => {
  assert.equal(formatRouteEta(0, "Min."), "1 Min.");
  assert.equal(formatRouteEta(29 * 60, "Min."), "29 Min.");
  assert.equal(formatRouteEta(59 * 60 + 40, "Min."), "1:00 h");
  assert.equal(formatRouteEta(2 * 3_600 + 34 * 60, "min"), "2:34 h");
});

test("route clearance formatting switches from metres to kilometres", () => {
  assert.equal(formatRouteClearance(48.4), "48 m");
  assert.equal(formatRouteClearance(999.6), "1000 m");
  assert.equal(formatRouteClearance(1_249), "1.2 km");
  assert.equal(formatRouteClearance(-20), "0 m");
});

test("map zoom remains inside the supported offline planning range", () => {
  assert.equal(clampRouteViewRange(1), MINIMUM_ROUTE_VIEW_METRES);
  assert.equal(clampRouteViewRange(20_000), 20_000);
  assert.equal(clampRouteViewRange(500_000), MAXIMUM_ROUTE_VIEW_METRES);
});

test("zoomed-out maps cap coastline and hatch rendering work", () => {
  assert.deepEqual(getRouteMapRenderingDetail(9_999), { hatchBandHeight: 2, maximumShorelineSegments: 3_500, maximumLabels: 72 });
  assert.deepEqual(getRouteMapRenderingDetail(10_000), { hatchBandHeight: 2, maximumShorelineSegments: 0, maximumLabels: 28 });
  assert.deepEqual(getRouteMapRenderingDetail(30_000), { hatchBandHeight: 2, maximumShorelineSegments: 0, maximumLabels: 18 });
  assert.deepEqual(getRouteMapRenderingDetail(100_000), { hatchBandHeight: 2, maximumShorelineSegments: 0, maximumLabels: 12 });
  assert.equal(getRouteMapRefreshInterval(5_000), 80);
  assert.equal(getRouteMapRefreshInterval(20_000), 160);
  assert.equal(getRouteMapRefreshInterval(80_000), 240);
  assert.equal(getRouteMapInteractionInterval(5_000), 16);
  assert.equal(getRouteMapInteractionInterval(20_000), 32);
});

test("map preview transform follows pan and pinch without rebuilding geometry", () => {
  const origin = { longitude: 15.6, latitude: 43.8 };
  assert.deepEqual(getRouteMapPreviewTransform(origin, 20_000, origin, 20_000, 360), {
    scale: 1,
    translateX: 0,
    translateY: -0,
  });
  const zoomed = getRouteMapPreviewTransform(origin, 20_000, origin, 10_000, 360);
  assert.equal(zoomed.scale, 2);
  assert.equal(zoomed.translateX, 0);
  assert.equal(zoomed.translateY, -0);
  const panned = getRouteMapPreviewTransform(origin, 20_000, { longitude: 15.61, latitude: 43.81 }, 20_000, 360);
  assert.ok(panned.translateX < 0);
  assert.ok(panned.translateY > 0);
});

test("active navigation starts one step closer while preserving route context", () => {
  assert.equal(getActiveRouteViewRange(405, 300), MINIMUM_ACTIVE_ROUTE_VIEW_METRES);
  assert.equal(getActiveRouteViewRange(1_230, 300), MINIMUM_ACTIVE_ROUTE_VIEW_METRES);
  assert.equal(getActiveRouteViewRange(6_000, 300), 4_500);
  assert.equal(getActiveRouteViewRange(20_000, 300), MAXIMUM_ACTIVE_ROUTE_VIEW_METRES);
  assert.equal(getActiveRouteViewRange(Number.NaN, 300), MINIMUM_ACTIVE_ROUTE_VIEW_METRES);
});

test("active navigation zoom remains useful from close shore detail to route context", () => {
  assert.equal(clampActiveRouteViewRange(10), 250);
  assert.equal(clampActiveRouteViewRange(1_200), 1_200);
  assert.equal(clampActiveRouteViewRange(50_000), 10_000);
  assert.equal(pinchRouteViewRange(1_000, 100, 200, clampActiveRouteViewRange), 500);
  assert.equal(pinchRouteViewRange(1_000, 100, 1_000, clampActiveRouteViewRange), 250);
  assert.equal(pinchRouteViewRange(1_000, 100, 1, clampActiveRouteViewRange), 10_000);
});

test("selecting a distant target zooms out enough to keep it visible", () => {
  const start = { longitude: 15, latitude: 43 };
  const nearby = { longitude: 15.01, latitude: 43 };
  const distant = { longitude: 15.4, latitude: 43 };
  assert.equal(routeViewRangeForTarget(20_000, start, nearby), 20_000);
  assert.ok(routeViewRangeForTarget(20_000, start, distant) > 30_000);
  assert.equal(routeViewRangeForTarget(20_000, start, { longitude: 30, latitude: 43 }), MAXIMUM_ROUTE_VIEW_METRES);
});

test("planning speed input is clamped to a practical boat range", () => {
  assert.equal(clampCruiseSpeed(-5), MINIMUM_CRUISE_SPEED_KNOTS);
  assert.equal(clampCruiseSpeed(16), 16);
  assert.equal(clampCruiseSpeed(200), MAXIMUM_CRUISE_SPEED_KNOTS);
});

test("automatic rerouting uses at least 250 metres or the configured clearance", () => {
  assert.equal(routeRerouteThreshold(100), 250);
  assert.equal(routeRerouteThreshold(300), 300);
  assert.equal(routeRerouteThreshold(-20), 250);
  const plannedFrom = { longitude: 15, latitude: 43 };
  assert.equal(shouldRerouteRoute(null, plannedFrom, 300), false);
  assert.equal(shouldRerouteRoute(plannedFrom, { longitude: 15.001, latitude: 43 }, 300), false);
  assert.equal(shouldRerouteRoute(plannedFrom, { longitude: 15.005, latitude: 43 }, 300), true);
});

test("route guidance projects beyond a passed waypoint instead of pointing backward", () => {
  const points = [
    { longitude: 15, latitude: 43 },
    { longitude: 15.01, latitude: 43 },
    { longitude: 15.02, latitude: 43 },
  ];
  const current = { longitude: 15.0125, latitude: 43 };
  const guidance = getProgressAwareRouteGuidance(points, current);

  assert.ok(guidance);
  assert.ok(guidance.progressMetres > 900);
  assert.ok(guidance.target.longitude > current.longitude);
  assert.ok(guidance.distanceToRouteMetres < 1);
});

test("route progress cannot regress to a nearby earlier segment", () => {
  const points = [
    { longitude: 15, latitude: 43 },
    { longitude: 15.01, latitude: 43 },
    { longitude: 15.02, latitude: 43 },
  ];
  const guidance = getProgressAwareRouteGuidance(
    points,
    { longitude: 15.002, latitude: 43 },
    1_200,
    120,
  );

  assert.ok(guidance);
  assert.ok(guidance.progressMetres >= 1_200);
  assert.ok(guidance.target.longitude > 15.015);
});

test("route guidance rejects missing and degenerate polylines", () => {
  const current = { longitude: 15, latitude: 43 };
  assert.equal(getProgressAwareRouteGuidance([], current), null);
  assert.equal(getProgressAwareRouteGuidance([current], current), null);
  assert.equal(getProgressAwareRouteGuidance([current, current], current), null);
});

test("route calculation requires a fresh, accurate navigation fix", () => {
  const fix = { longitude: 15, latitude: 43 };
  assert.equal(canPlanRoute("reliable", fix), true);
  assert.equal(canPlanRoute("reliable", null), false);
  for (const state of ["waiting", "stale", "lost", "inaccurate"]) {
    assert.equal(canPlanRoute(state, fix), false, state);
  }
});

test("route readiness changes to check on stale GPS and recovers with the next reliable fix", () => {
  const route = {
    planning: false,
    hasRoute: true,
    routeRestricted: false,
    hasFailure: false,
  };
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "reliable" }), "ready");
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "stale" }), "check");
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "inaccurate" }), "check");
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "reliable" }), "ready");
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "reliable", routeRestricted: true }), "check");
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "reliable", hasFailure: true }), "check");
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "reliable", planning: true }), "calculating");
  assert.equal(getRouteReadinessState({ ...route, gpsNavigationState: "waiting", hasRoute: false }), "waiting");
});

test("map pixel conversion keeps centre exact and cardinal directions correct", () => {
  const centre = { longitude: 15.5, latitude: 43.8 };
  assert.deepEqual(routeMapPixelToGeo(centre, 10_000, 360, 180, 180), centre);
  assert.ok(routeMapPixelToGeo(centre, 10_000, 360, 300, 180).longitude > centre.longitude);
  assert.ok(routeMapPixelToGeo(centre, 10_000, 360, 180, 60).latitude > centre.latitude);
});

test("dragging the map pans content with the finger", () => {
  const centre = { longitude: 15.5, latitude: 43.8 };
  const right = panRouteMapCentre(centre, 10_000, 360, 60, 0);
  const down = panRouteMapCentre(centre, 10_000, 360, 0, 60);
  assert.ok(right.longitude < centre.longitude);
  assert.ok(down.latitude > centre.latitude);
});

test("pinch zoom is proportional and respects both zoom limits", () => {
  assert.equal(pinchRouteViewRange(20_000, 100, 200), 10_000);
  assert.equal(pinchRouteViewRange(20_000, 100, 50), 40_000);
  assert.equal(pinchRouteViewRange(3_000, 100, 1_000), MINIMUM_ROUTE_VIEW_METRES);
  assert.equal(pinchRouteViewRange(100_000, 100, 1), MAXIMUM_ROUTE_VIEW_METRES);
  assert.equal(pinchRouteViewRange(20_000, 0, 100), 20_000);
});
