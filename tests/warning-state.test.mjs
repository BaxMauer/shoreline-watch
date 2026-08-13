import assert from "node:assert/strict";
import test from "node:test";
import { getWarningOutputPlan, getWarningTransition } from "../lib/warning-state.ts";

test("entering the configured distance requests the warning alarm", () => {
  assert.equal(getWarningTransition(false, true, false, false), "enter-distance");
});

test("exiting the configured distance requests the safe-water chime", () => {
  assert.equal(getWarningTransition(true, false, false, false), "exit-distance");
});

test("crossing the speed limit while already close requests a warning alarm", () => {
  assert.equal(getWarningTransition(true, true, false, true), "enter-speed");
});

test("steady safe and steady warning states do not repeat sounds", () => {
  assert.equal(getWarningTransition(false, false, false, false), "none");
  assert.equal(getWarningTransition(true, true, true, true), "none");
});

test("muted warning sound still produces visual and haptic outputs", () => {
  const plan = getWarningOutputPlan("enter-distance", {
    alertVolumePercent: 200,
    warningSoundEnabled: false,
    safeSoundEnabled: true,
    visualAlertsEnabled: true,
    vibrationEnabled: true,
  });
  assert.deepEqual(plan, { sound: null, visual: "distance", vibration: "danger" });
});

test("safe-water outputs can be controlled independently", () => {
  const plan = getWarningOutputPlan("exit-distance", {
    alertVolumePercent: 150,
    warningSoundEnabled: true,
    safeSoundEnabled: false,
    visualAlertsEnabled: true,
    vibrationEnabled: false,
  });
  assert.deepEqual(plan, { sound: null, visual: "safe", vibration: null });
});

test("zero volume acts as a master sound mute without hiding visuals", () => {
  const plan = getWarningOutputPlan("enter-speed", {
    alertVolumePercent: 0,
    warningSoundEnabled: true,
    safeSoundEnabled: true,
    visualAlertsEnabled: true,
    vibrationEnabled: true,
  });
  assert.deepEqual(plan, { sound: null, visual: "speed", vibration: "danger" });
});
