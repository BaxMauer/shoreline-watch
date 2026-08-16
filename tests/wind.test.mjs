import assert from "node:assert/strict";
import test from "node:test";
import { buildWindProxyRequestUrl, buildWindRequestUrl, fetchMapWindSample, parseWindProxyResponse, parseWindSample, windCellKey, windCompassLabel, windFlowAngleRadians, windSampleCanBeReused } from "../lib/wind.ts";

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
