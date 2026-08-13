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
