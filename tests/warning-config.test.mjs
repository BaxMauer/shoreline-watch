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
});

test("power-saving thresholds are sanitized to practical ranges", () => {
  const low = sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, powerSaveDistanceMetres: 20, powerSaveStationaryMinutes: 0 });
  assert.equal(low.powerSaveDistanceMetres, 500);
  assert.equal(low.powerSaveStationaryMinutes, 1);
  const high = sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, powerSaveDistanceMetres: 50_000, powerSaveStationaryMinutes: 99 });
  assert.equal(high.powerSaveDistanceMetres, 20_000);
  assert.equal(high.powerSaveStationaryMinutes, 30);
});

test("alert volume is configurable from muted to 200 percent", () => {
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, alertVolumePercent: -20 }).alertVolumePercent, 0);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, alertVolumePercent: 175 }).alertVolumePercent, 175);
  assert.equal(sanitizeWarningConfig({ ...CROATIA_WARNING_CONFIG, alertVolumePercent: 280 }).alertVolumePercent, 200);
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
