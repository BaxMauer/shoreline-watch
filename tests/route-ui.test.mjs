import assert from "node:assert/strict";
import test from "node:test";
import {
  MAXIMUM_CRUISE_SPEED_KNOTS,
  MAXIMUM_ROUTE_VIEW_METRES,
  MINIMUM_CRUISE_SPEED_KNOTS,
  MINIMUM_ROUTE_VIEW_METRES,
  clampCruiseSpeed,
  clampRouteViewRange,
  formatRouteClearance,
  formatRouteEta,
  parseRouteCoordinate,
  panRouteMapCentre,
  pinchRouteViewRange,
  routeMapPixelToGeo,
  routeRerouteThreshold,
  routeViewRangeForTarget,
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
