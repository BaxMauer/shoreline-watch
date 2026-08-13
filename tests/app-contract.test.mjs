import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { APP_VERSION } from "../lib/app-version.ts";

const app = await readFile(new URL("../app/shoreline-app.tsx", import.meta.url), "utf8");

test("visible app version is semantic and matches the package release", async () => {
  const packageData = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_VERSION, packageData.version);
  assert.match(app, /className="app-version">v\{APP_VERSION\}<\/span>/);
});

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
  const demoBlock = app.match(/\{mode === "demo" && trackerTab === "distance" && \([\s\S]*?copy\.nextPosition[\s\S]*?\)\}/)?.[0] ?? "";
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
  for (const className of ["land-hatch-layer", "nearest-shore-line", "coast-layer", "proximity-ring", "danger-ring-arc", "course-line", "nearest-point", "map-boat"]) {
    assert.match(app, new RegExp(`className=(?:\\{[^}]+\\}|\")${className}`));
  }
});

test("tracking exposes persistent distance and offline route-planning tabs", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(app, /type TrackerTab = "distance" \| "route"/);
  assert.match(app, /<nav className="tracker-tabs"/);
  assert.match(app, /<RoutePlanner[\s\S]*warningConfig=\{warningConfig\}/);
  assert.match(planner, /planWaterRoute\(pack, start, destination/);
  assert.match(planner, /getNearbyShorelineSegments/);
  assert.doesNotMatch(planner, /fetch\(|XMLHttpRequest|WebSocket/);
});

test("route planning applies warning distance and near-shore speed settings", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /clearanceMetres: warningConfig\.distanceMetres/);
  assert.match(planner, /speedWarningEnabled: warningConfig\.speedWarningEnabled/);
  assert.match(planner, /nearShoreSpeedKnots: warningConfig\.maxSpeedKnots/);
  assert.match(planner, /route\.mode === "clearance"/);
  assert.match(planner, /route\?\.mode === "restricted"/);
});

test("route destination can be selected by map tap or entered coordinates", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /onPointerUp=\{handlePointerUp\}/);
  assert.match(planner, /selectTarget\(routeMapPixelToGeo\(mapCentre, viewRangeMetres, size, x, y\)\)/);
  assert.match(planner, /inputMode="decimal"/);
  assert.match(planner, /selectTarget\(\{ latitude, longitude \}\)/);
});

test("route calculations ignore stale asynchronous results and reset completely", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /const sequence = \+\+calculationSequence\.current/);
  assert.ok((planner.match(/sequence !== calculationSequence\.current/g) ?? []).length >= 2);
  assert.match(planner, /const reset = \(\) => \{[\s\S]*calculationSequence\.current \+= 1;[\s\S]*setTarget\(null\)[\s\S]*setRoute\(null\)[\s\S]*plannedFrom\.current = null;/);
});

test("route planning automatically recalculates after movement and preference changes", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /shouldRerouteRoute\(plannedFrom\.current, fix, warningConfig\.distanceMetres\)/);
  assert.match(planner, /window\.setTimeout\(\(\) => calculate\(target, fix\), 500\)/);
  assert.match(planner, /\[cruiseSpeedKnots, warningConfig\.distanceMetres, warningConfig\.maxSpeedKnots, warningConfig\.speedWarningEnabled\]/);
});

test("route map controls are bounded and target selection requires a position", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /aria-disabled=\{!fix\}/);
  assert.match(planner, /wasSinglePointer && !gesture\?\.moved && fix && !planning/);
  assert.match(planner, /clampRouteViewRange\(value \/ 1\.7\)/);
  assert.match(planner, /clampRouteViewRange\(value \* 1\.7\)/);
  assert.match(planner, /routeViewRangeForTarget\(current, fix, destination\)/);
});

test("route map supports drag, pinch, wheel, keyboard zoom, and recenter", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  for (const handler of ["handlePointerDown", "handlePointerMove", "handlePointerUp", "handlePointerCancel", "handleWheel", "handleMapKey"]) {
    assert.match(planner, new RegExp(`on(?:PointerDown|PointerMove|PointerUp|PointerCancel|Wheel|KeyDown)=\\{${handler}\\}`));
  }
  assert.match(planner, /pinchRouteViewRange\(gesture\.range, gesture\.distance, metrics\.distance\)/);
  assert.match(planner, /panRouteMapCentre\(gesture\.centre, gesture\.range, size, deltaX, deltaY\)/);
  assert.match(planner, /className="route-recenter"[\s\S]*onClick=\{recenterMap\}/);
});

test("warning display uses hysteresis, suppresses the initial alarm, and exposes text scaling", () => {
  assert.match(app, /classifyWarningZone\(wasInside, conservativeDistance, warningConfig\.distanceMetres\)/);
  assert.match(app, /const transition = getWarningTransition\(wasInside, nextInside/);
  assert.match(app, /setWarningZoneInside\(nextInside\)/);
  assert.match(app, /--distance-scale": warningConfig\.distanceTextScalePercent \/ 100/);
  assert.match(app, /id="distance-text-size" type="range" min="80" max="150" step="5"/);
});

test("route result exposes all navigation metrics and accessible status messages", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  for (const metric of ["route.distanceMetres", "route.estimatedSeconds", "route.minimumShoreDistanceMetres", "nextBearing"]) {
    assert.match(planner, new RegExp(metric.replace(".", "\\.")));
  }
  assert.match(planner, /className="route-summary" aria-live="polite"/);
  assert.match(planner, /failure \? <p className="route-message error">\{copy\.failures\[failure\]\}<\/p>/);
  assert.match(planner, /route\.mode === "clearance" \? copy\.safeDetail/);
});

test("route planning copy covers German and English instructions and every failure", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /de:\s*\{[\s\S]*title: "Routenplanung"/);
  assert.match(planner, /en:\s*\{[\s\S]*title: "Route planning"/);
  for (const failure of ["outside-region", "destination-on-land", "too-far", "no-route"]) {
    assert.equal((planner.match(new RegExp(`"${failure}"`, "g")) ?? []).length, 2, failure);
  }
});
