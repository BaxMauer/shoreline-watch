import assert from "node:assert/strict";
import test from "node:test";
import { buildWindRequestUrl, parseWindSample, windCellKey, windCompassLabel, windFlowAngleRadians, windSampleCanBeReused } from "../lib/wind.ts";

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
