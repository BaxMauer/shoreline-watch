import assert from "node:assert/strict";
import test from "node:test";
import { classifyWarningZone, getWarningHysteresisMetres, getWarningOutputPlan, getWarningTransition } from "../lib/warning-state.ts";

const OUTPUTS = {
  alertVolumePercent: 100,
  warningSoundEnabled: true,
  safeSoundEnabled: true,
  visualAlertsEnabled: true,
  vibrationEnabled: true,
  speedWarningEnabled: true,
  speedKnown: true,
  speedViolation: true,
  suppressDistanceSoundAtSafeSpeed: false,
};

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
    ...OUTPUTS,
    alertVolumePercent: 200,
    warningSoundEnabled: false,
  });
  assert.deepEqual(plan, { sound: null, visual: "distance", vibration: "danger" });
});

test("safe-water outputs can be controlled independently", () => {
  const plan = getWarningOutputPlan("exit-distance", {
    ...OUTPUTS,
    alertVolumePercent: 150,
    safeSoundEnabled: false,
    vibrationEnabled: false,
  });
  assert.deepEqual(plan, { sound: null, visual: "safe", vibration: null });
});

test("zero volume acts as a master sound mute without hiding visuals", () => {
  const plan = getWarningOutputPlan("enter-speed", {
    ...OUTPUTS,
    alertVolumePercent: 0,
  });
  assert.deepEqual(plan, { sound: null, visual: "speed", vibration: "danger" });
});

test("safe speed can suppress only the distance-entry sound", () => {
  const plan = getWarningOutputPlan("enter-distance", {
    ...OUTPUTS,
    speedViolation: false,
    suppressDistanceSoundAtSafeSpeed: true,
  });
  assert.deepEqual(plan, { sound: null, visual: "distance", vibration: "danger" });
});

test("distance-entry sound still plays above the configured speed", () => {
  const plan = getWarningOutputPlan("enter-distance", {
    ...OUTPUTS,
    speedViolation: true,
    suppressDistanceSoundAtSafeSpeed: true,
  });
  assert.equal(plan.sound, "warning");
});

test("unknown speed remains fail-safe and does not silence the warning", () => {
  const plan = getWarningOutputPlan("enter-distance", {
    ...OUTPUTS,
    speedKnown: false,
    speedViolation: false,
    suppressDistanceSoundAtSafeSpeed: true,
  });
  assert.equal(plan.sound, "warning");
});

test("the first GPS position establishes state without emitting an alert", () => {
  assert.equal(getWarningTransition(null, false, null, false), "none");
  assert.equal(getWarningTransition(null, true, null, true), "none");
});

test("warning hysteresis scales with distance but remains bounded", () => {
  assert.equal(getWarningHysteresisMetres(50), 10);
  assert.equal(getWarningHysteresisMetres(300), 15);
  assert.equal(getWarningHysteresisMetres(2_000), 50);
});

test("warning zone uses separate entry and exit thresholds", () => {
  assert.equal(classifyWarningZone(null, 299, 300), true);
  assert.equal(classifyWarningZone(null, 301, 300), false);
  assert.equal(classifyWarningZone(false, 286, 300), false);
  assert.equal(classifyWarningZone(false, 285, 300), true);
  assert.equal(classifyWarningZone(true, 314, 300), true);
  assert.equal(classifyWarningZone(true, 315, 300), false);
});

test("rapid GPS movement around the threshold does not chatter alarms", () => {
  let inside = classifyWarningZone(null, 320, 300);
  const transitions = [];
  for (const distance of [301, 299, 304, 296, 287, 284, 292, 303, 312, 316]) {
    const next = classifyWarningZone(inside, distance, 300);
    transitions.push(getWarningTransition(inside, next, false, false));
    inside = next;
  }
  assert.deepEqual(transitions.filter((value) => value !== "none"), ["enter-distance", "exit-distance"]);
});

test("leaving the distance zone takes priority over a contradictory speed sample", () => {
  assert.equal(getWarningTransition(true, false, false, true), "exit-distance");
});

test("safe-speed suppression is ignored when speed warnings are disabled", () => {
  const plan = getWarningOutputPlan("enter-distance", {
    ...OUTPUTS,
    speedWarningEnabled: false,
    speedViolation: false,
    suppressDistanceSoundAtSafeSpeed: true,
  });
  assert.equal(plan.sound, "warning");
});

test("screen and vibration can be disabled without muting warning audio", () => {
  const plan = getWarningOutputPlan("enter-speed", {
    ...OUTPUTS,
    visualAlertsEnabled: false,
    vibrationEnabled: false,
  });
  assert.deepEqual(plan, { sound: "warning", visual: null, vibration: null });
});

test("safe-water sound does not depend on the warning-alarm switch", () => {
  const plan = getWarningOutputPlan("exit-distance", {
    ...OUTPUTS,
    warningSoundEnabled: false,
    safeSoundEnabled: true,
  });
  assert.equal(plan.sound, "safe");
});

test("no transition never emits any output", () => {
  assert.deepEqual(getWarningOutputPlan("none", OUTPUTS), { sound: null, visual: null, vibration: null });
});
