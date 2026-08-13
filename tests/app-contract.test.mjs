import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app/shoreline-app.tsx", import.meta.url), "utf8");

test("German and all four requested themes remain selectable", () => {
  assert.match(app, /useState<Language>\("de"\)/);
  for (const value of ["de", "en", "ocean", "xp", "dark", "nautical"]) {
    assert.match(app, new RegExp(`<option value="${value}">`));
  }
});

test("warning preferences are loaded, sanitized, and persisted locally", () => {
  assert.match(app, /localStorage\.getItem\(WARNING_CONFIG_STORAGE_KEY\)/);
  assert.match(app, /sanitizeWarningConfig\(JSON\.parse\(savedWarningConfig\)\)/);
  assert.match(app, /localStorage\.setItem\(WARNING_CONFIG_STORAGE_KEY, JSON\.stringify\(warningConfig\)\)/);
});

test("live GPS requests accurate frequent fixes with a bounded timeout", () => {
  assert.match(app, /navigator\.geolocation\.watchPosition/);
  assert.match(app, /enableHighAccuracy:\s*true/);
  assert.match(app, /maximumAge:\s*1_000/);
  assert.match(app, /timeout:\s*15_000/);
  assert.match(app, /navigator\.geolocation\.clearWatch/);
});

test("screen wake lock is acquired for tracking and released when stopped", () => {
  assert.match(app, /wakeLock\?\.request\("screen"\)/);
  assert.match(app, /await requestWakeLock\(\)/);
  assert.match(app, /wakeLock\.current\?\.release\(\)/);
});

test("distance warning retains visual and vibration paths independently from audio", () => {
  assert.match(app, /if \(outputPlan\.visual\) triggerVisualSignal\(outputPlan\.visual\)/);
  assert.match(app, /if \(outputPlan\.vibration\) triggerVibration\(outputPlan\.vibration\)/);
  assert.match(app, /if \(outputPlan\.sound === "warning"\) void soundAlarm\(\)/);
  assert.match(app, /if \(outputPlan\.sound === "safe"\) void soundSafeChime\(\)/);
});

test("alarm media is preloaded and primed from the user start gesture", () => {
  assert.match(app, /src="\/audio\/shoreline-alarm\.wav"/);
  assert.match(app, /preload="auto"/);
  assert.match(app, /const startLive = useCallback\(async \(\) => \{[\s\S]*void primeAlarm\(\)/);
  assert.match(app, /const startDemo = useCallback\(\(\) => \{[\s\S]*void primeAlarm\(\)/);
});

test("test-alarm control is rendered only in demo mode", () => {
  const demoBlock = app.match(/\{mode === "demo" && \([\s\S]*?copy\.nextPosition[\s\S]*?\)\}/)?.[0] ?? "";
  assert.match(demoBlock, /copy\.testAlarm/);
  assert.equal((app.match(/copy\.testAlarm/g) ?? []).length, 1);
});

test("GO state and GPS problems are announced accessibly", () => {
  assert.match(app, /className=\{`go-no-go \$\{goNoGoState\}`\} role="status" aria-live="polite"/);
  assert.match(app, /className=\{`status-pill[\s\S]*aria-live="assertive"/);
  assert.match(app, /className=\{`course-alert gps-alert[\s\S]*aria-live="assertive"/);
});

test("power saver runs only in live mode, wakes on tap, and retains GPS tracking", () => {
  assert.match(app, /tracking:\s*mode === "live"/);
  assert.match(app, /setPowerSaveWakeUntil\(Date\.now\(\) \+ 30_000\)/);
  assert.match(app, /className="power-save-screen" type="button" onClick=\{wakePowerDisplay\}/);
  assert.doesNotMatch(app, /powerSaveReason[\s\S]{0,200}clearWatch/);
});

test("nearest shore, warning ring, collision course, and boat remain separate SVG layers", () => {
  for (const className of ["nearest-shore-line", "coast-layer", "proximity-ring", "danger-ring-arc", "course-line", "nearest-point", "map-boat"]) {
    assert.match(app, new RegExp(`className=(?:\\{[^}]+\\}|\")${className}`));
  }
});
