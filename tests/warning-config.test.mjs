import assert from "node:assert/strict";
import test from "node:test";
import { CROATIA_WARNING_CONFIG, sanitizeWarningConfig } from "../lib/warning-config.ts";

test("older saved settings receive safe alert-output defaults", () => {
  const config = sanitizeWarningConfig({ distanceMetres: 450, speedWarningEnabled: false, maxSpeedKnots: 6 });
  assert.equal(config.distanceMetres, 450);
  assert.equal(config.warningSoundEnabled, true);
  assert.equal(config.safeSoundEnabled, true);
  assert.equal(config.visualAlertsEnabled, true);
  assert.equal(config.vibrationEnabled, true);
  assert.equal(config.alertVolumePercent, 100);
  assert.equal(config.suppressDistanceSoundAtSafeSpeed, true);
  assert.equal(config.powerSaveEnabled, true);
  assert.equal(config.powerSaveDistanceMetres, 2_000);
  assert.equal(config.powerSaveStationaryMinutes, 5);
  assert.equal(config.powerSaveAnchorRadiusMetres, 30);
  assert.equal(config.distanceTextScalePercent, 110);
});

test("power-saving thresholds are sanitized to practical ranges", () => {
  const low = sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, powerSaveDistanceMetres: 20, powerSaveStationaryMinutes: 0, powerSaveAnchorRadiusMetres: 2 });
  assert.equal(low.powerSaveDistanceMetres, 500);
  assert.equal(low.powerSaveStationaryMinutes, 1);
  assert.equal(low.powerSaveAnchorRadiusMetres, 10);
  const high = sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, powerSaveDistanceMetres: 50_000, powerSaveStationaryMinutes: 99, powerSaveAnchorRadiusMetres: 500 });
  assert.equal(high.powerSaveDistanceMetres, 20_000);
  assert.equal(high.powerSaveStationaryMinutes, 30);
  assert.equal(high.powerSaveAnchorRadiusMetres, 200);
});

test("alert volume is configurable from muted to 200 percent", () => {
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, alertVolumePercent: -20 }).alertVolumePercent, 0);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, alertVolumePercent: 175 }).alertVolumePercent, 175);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, alertVolumePercent: 280 }).alertVolumePercent, 200);
});

test("distance digit size is configurable from 80 to 150 percent", () => {
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, distanceTextScalePercent: 20 }).distanceTextScalePercent, 80);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, distanceTextScalePercent: 127 }).distanceTextScalePercent, 125);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, distanceTextScalePercent: 220 }).distanceTextScalePercent, 150);
});

test("all output switches preserve an explicit muted state", () => {
  const config = sanitizeWarningConfig({
    ...CROATIA_WARNING_CONFIG,
    warningSoundEnabled: false,
    safeSoundEnabled: false,
    visualAlertsEnabled: false,
    vibrationEnabled: false,
  });
  assert.equal(config.warningSoundEnabled, false);
  assert.equal(config.safeSoundEnabled, false);
  assert.equal(config.visualAlertsEnabled, false);
  assert.equal(config.vibrationEnabled, false);
});

test("invalid settings object falls back to the complete Croatia preset", () => {
  assert.deepEqual(sanitizeWarningConfig(null), CROATIA_WARNING_CONFIG);
  assert.deepEqual(sanitizeWarningConfig("invalid"), CROATIA_WARNING_CONFIG);
});

test("numeric settings clamp and round to supported control steps", () => {
  const config = sanitizeWarningConfig({
    ...CROATIA_WARNING_CONFIG,
    distanceMetres: 347,
    maxSpeedKnots: 8.26,
    alertVolumePercent: 102,
    powerSaveDistanceMetres: 2_049,
    powerSaveStationaryMinutes: 4.6,
    powerSaveAnchorRadiusMetres: 32,
    distanceTextScalePercent: 117,
  });
  assert.equal(config.distanceMetres, 350);
  assert.equal(config.maxSpeedKnots, 8.3);
  assert.equal(config.alertVolumePercent, 100);
  assert.equal(config.powerSaveDistanceMetres, 2_000);
  assert.equal(config.powerSaveStationaryMinutes, 5);
  assert.equal(config.powerSaveAnchorRadiusMetres, 30);
  assert.equal(config.distanceTextScalePercent, 115);
});

test("distance and speed settings enforce their minimum and maximum", () => {
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, distanceMetres: 0 }).distanceMetres, 50);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, distanceMetres: 9_999 }).distanceMetres, 2_000);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, maxSpeedKnots: 0 }).maxSpeedKnots, 1);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, maxSpeedKnots: 100 }).maxSpeedKnots, 40);
});

test("every boolean setting preserves an explicit false value", () => {
  const config = sanitizeWarningConfig(Object.fromEntries(
    Object.entries(CROATIA_WARNING_CONFIG).map(([key, value]) => [key, typeof value === "boolean" ? false : value]),
  ));
  for (const [key, value] of Object.entries(config)) {
    if (typeof CROATIA_WARNING_CONFIG[key] === "boolean") assert.equal(value, false, key);
  }
});
