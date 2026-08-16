import assert from "node:assert/strict";
import test from "node:test";
import { advanceWindParticle, buildWindProxyRequestUrl, buildWindRequestUrl, fetchMapWindSample, getWindCanvasSize, getWindMapOffset, parseWindProxyResponse, parseWindSample, windCanvasSizeChanged, windCellKey, windCompassLabel, windFlowAngleRadians, windFlowSpeedPixelsPerSecond, windSampleCanBeReused, wrapWindCoordinate } from "../lib/wind.ts";

test("wind request uses current 10-m speed, direction, gusts, and knots", () => {
  const url = new URL(buildWindRequestUrl({ latitude: 43.8, longitude: 15.55 }));
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("current"), "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  assert.equal(url.searchParams.get("wind_speed_unit"), "kn");
});

test("wind response is normalized and invalid samples fail closed", () => {
  assert.deepEqual(parseWindSample({ current: { wind_speed_10m: 12.4, wind_direction_10m: 370, wind_gusts_10m: 19.1, time: "2026-08-15T12:00" } }, 123), {
    speedKnots: 12.4,
    directionDegrees: 10,
    gustKnots: 19.1,
    observedAt: "2026-08-15T12:00",
    fetchedAt: 123,
  });
  assert.equal(parseWindSample({ current: { wind_speed_10m: "bad" } }), null);
});

test("wind parsers reject coercible null, empty, and boolean values", () => {
  const base = { current: { wind_speed_10m: 8, wind_direction_10m: 90, wind_gusts_10m: 12, time: "2026-08-16T12:00" } };
  for (const invalid of [null, "", false]) {
    assert.equal(parseWindSample({ current: { ...base.current, wind_speed_10m: invalid } }), null);
    assert.equal(parseWindProxyResponse({ sample: { speedKnots: invalid, directionDegrees: 90, gustKnots: 12, observedAt: "2026-08-16T12:00", fetchedAt: Date.now() } }), null);
  }
});

test("map wind uses the same-origin proxy and validates its sample", () => {
  const request = new URL(buildWindProxyRequestUrl({ latitude: 43.8, longitude: 15.55 }), "https://boot.maxi-bauer.de");
  assert.equal(request.pathname, "/api/wind");
  assert.equal(request.searchParams.get("latitude"), "43.80000");
  assert.equal(request.searchParams.get("longitude"), "15.55000");
  const sample = { speedKnots: 12.4, directionDegrees: 370, gustKnots: 19.1, observedAt: "2026-08-15T12:00", fetchedAt: 123 };
  assert.deepEqual(parseWindProxyResponse({ sample }), { ...sample, directionDegrees: 10 });
  assert.equal(parseWindProxyResponse({ sample: { ...sample, fetchedAt: "bad" } }), null);
  assert.equal(parseWindProxyResponse({ sample: null }), null);
});

test("map wind falls back to Open-Meteo when the proxy is unavailable", async () => {
  const requested = [];
  const sample = await fetchMapWindSample({ latitude: 43.8, longitude: 15.55 }, async (input) => {
    requested.push(input);
    if (input.startsWith("/api/wind")) return new Response(null, { status: 502 });
    return Response.json({ current: { wind_speed_10m: 12.4, wind_direction_10m: 10, wind_gusts_10m: 19.1, time: "2026-08-15T12:00" } });
  });
  assert.equal(requested.length, 2);
  assert.match(requested[0], /^\/api\/wind\?/);
  assert.match(requested[1], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.equal(sample.speedKnots, 12.4);
});

test("wind cells avoid refetching for tiny GPS movement", () => {
  assert.equal(windCellKey({ latitude: 43.801, longitude: 15.551 }), windCellKey({ latitude: 43.802, longitude: 15.552 }));
  assert.notEqual(windCellKey({ latitude: 43.801, longitude: 15.551 }), windCellKey({ latitude: 43.88, longitude: 15.64 }));
});

test("meteorological directions map to compass labels and downwind flow", () => {
  assert.equal(windCompassLabel(45, "de"), "NO");
  assert.equal(windCompassLabel(45, "en"), "NE");
  assert.ok(Math.abs(windFlowAngleRadians(0) - Math.PI / 2) < 1e-9);
});

test("offline wind is reused for at most three hours", () => {
  const sample = { speedKnots: 10, directionDegrees: 0, gustKnots: 15, observedAt: "now", fetchedAt: 1_000 };
  assert.equal(windSampleCanBeReused(sample, 1_000 + 3 * 60 * 60 * 1_000), true);
  assert.equal(windSampleCanBeReused(sample, 1_001 + 3 * 60 * 60 * 1_000), false);
});

test("offline wind never crosses a location cell", () => {
  const sample = { speedKnots: 10, directionDegrees: 0, gustKnots: 15, observedAt: "now", fetchedAt: 1_000, cellKey: "43.80:15.55" };
  assert.equal(windSampleCanBeReused(sample, 2_000, "43.80:15.55"), true);
  assert.equal(windSampleCanBeReused(sample, 2_000, "43.88:15.64"), false);
  assert.equal(windSampleCanBeReused({ ...sample, cellKey: undefined }, 2_000, "43.80:15.55"), false);
});

test("wind flow is calm-aware and gust-responsive", () => {
  assert.equal(windFlowSpeedPixelsPerSecond(0, 0), 0);
  assert.equal(windFlowSpeedPixelsPerSecond(.04, .04), 0);
  assert.ok(windFlowSpeedPixelsPerSecond(.6, .8) > 0, "a value displayed as 1 kn must visibly animate");
  assert.ok(windFlowSpeedPixelsPerSecond(12, 26) > windFlowSpeedPixelsPerSecond(12, 12));
});

test("wind particles advance across animation frames", () => {
  const particle = { x: .5, y: .5, age: 10, life: 100, speed: 1 };
  const before = { ...particle };
  advanceWindParticle(particle, 0, 40, .016, 320, 480);
  assert.ok(particle.x > before.x);
  assert.equal(particle.y, before.y);
  assert.ok(particle.age > before.age);
});

test("stable canvas bounds do not reset wind frame timing", () => {
  const size = getWindCanvasSize(390, 640, 3);
  assert.deepEqual(size, { pixelRatio: 1.5, width: 585, height: 960 });
  assert.equal(windCanvasSizeChanged(size.width, size.height, size.width, size.height), false);
  assert.equal(windCanvasSizeChanged(size.width, size.height, size.width + 1, size.height), true);
});

test("wind field is geographically anchored while the route map pans", () => {
  const centre = { latitude: 43.7869, longitude: 15.6431 };
  const longitudeScale = 111_320 * Math.cos(centre.latitude * Math.PI / 180);
  const movedEast = { ...centre, longitude: centre.longitude + 100 / longitudeScale };
  const original = getWindMapOffset({ centre, rangeMetres: 2_500 }, 360, 360);
  const moved = getWindMapOffset({ centre: movedEast, rangeMetres: 2_500 }, 360, 360);

  assert.ok(Math.abs((moved.x - original.x) + 7.2) < .01);
  assert.equal(wrapWindCoordinate(-4, 360), 356);
  assert.equal(wrapWindCoordinate(364, 360), 4);
});
