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

test("screen wake lock recovers while live and releases cleanly when stopped", () => {
  assert.match(app, /wakeLock\?\.request\("screen"\)/);
  assert.match(app, /await requestWakeLock\(\)/);
  assert.match(app, /wakeLock\.current\?\.release\(\)/);
  assert.match(app, /addEventListener\("release",/);
  assert.match(app, /addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(app, /document\.visibilityState === "visible" && modeRef\.current === "live"/);
  assert.match(app, /void acquireWakeLock\(\)/);
  assert.match(app, /modeRef\.current = "idle";[\s\S]*wakeLockRetryTimer/);
});

test("distance warning retains visual and vibration paths independently from audio", () => {
  assert.match(app, /if \(outputPlan\.visual\) triggerVisualSignal\(outputPlan\.visual\)/);
  assert.match(app, /if \(outputPlan\.vibration\) triggerVibration\(outputPlan\.vibration\)/);
  assert.match(app, /gateWarningSoundForDangerEpisode\([\s\S]*outputPlan\.sound/);
  assert.match(app, /if \(gatedSound\.sound === "warning"\) void soundAlarm\(\)/);
  assert.match(app, /if \(gatedSound\.sound === "safe"\) void soundSafeChime\(\)/);
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

test("distance and route readiness require fresh GPS at the accuracy threshold", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(app, /getGpsNavigationState\(gpsSignalState, fix\?\.accuracy\)/);
  assert.match(app, /getGoNoGoState\([\s\S]*gpsReliable,[\s\S]*warningZoneInside/);
  assert.match(app, /gpsIsReliable:\s*gpsReliable/);
  assert.match(app, /gpsNavigationState=\{gpsNavigationState\}/);
  assert.match(planner, /if \(start === fix && !gpsReliable\) return;/);
  assert.match(planner, /getRouteReadinessState\(\{/);
  assert.match(planner, /!gpsReliable \|\| !fix \|\| !target \|\| !hasReachedRouteTarget\(fix, target\)/);
});

test("distance mode samples and displays the current EMODnet chart depth", async () => {
  assert.match(app, /depthSampleCellKey\(fix\)/);
  assert.match(app, /fetch\(buildCurrentDepthRequestUrl\(/);
  assert.match(app, /parseEmodnetWaterDepth\(payload\)/);
  assert.match(app, /className=\{`current-depth-chip \$\{currentDepthState\}`\}/);
  assert.match(app, /copy\.chartDepth/);
  assert.match(app, /currentDepthState=\{currentDepthState\}/);
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
  assert.match(planner, /new Worker\(/);
  assert.match(planner, /route-planning\.worker\.ts/);
  assert.doesNotMatch(planner, /planWaterRoute\(/);
  assert.match(planner, /getNearbyShorelineSegments/);
  assert.doesNotMatch(planner, /fetch\(|XMLHttpRequest|WebSocket/);
});

test("route planning applies warning distance and near-shore speed settings", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /clearanceMetres: warningConfig\.distanceMetres/);
  assert.match(planner, /speedWarningEnabled: warningConfig\.speedWarningEnabled/);
  assert.match(planner, /nearShoreSpeedKnots: warningConfig\.maxSpeedKnots/);
  assert.match(planner, /startAccuracyMetres: start === fix \? fix\?\.accuracy : undefined/);
  assert.match(planner, /route\.mode === "restricted"/);
  assert.match(planner, /route\?\.mode === "restricted"/);
});

test("route destination can be selected by map tap or entered coordinates", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /onPointerUp=\{handlePointerUp\}/);
  assert.match(planner, /const selected = routeMapPixelToGeo\(mapCentre, viewRangeMetres, size, x, y\)/);
  assert.match(planner, /if \(mapEditMode === "start"\) selectStart\(selected\);[\s\S]*else selectTarget\(selected\);/);
  assert.match(planner, /inputMode="decimal"/);
  assert.match(planner, /const destination = \{ latitude: parsedTargetLatitude, longitude: parsedTargetLongitude \}/);
});

test("route calculations use a cancellable worker and reset completely", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /RoutePlanningWorkerController/);
  assert.match(planner, /routeWorker\.current\?\.cancel\(\)/);
  assert.match(planner, /controller\.dispose\(\)/);
  assert.match(planner, /const reset = \(\) => \{[\s\S]*routeWorker\.current\?\.cancel\(\);[\s\S]*setTarget\(null\)[\s\S]*setRoute\(null\)[\s\S]*plannedFrom\.current = null;/);
});

test("route planning keeps a pending movement reroute across high-frequency GPS fixes", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  const movementEffect = planner.match(/useEffect\(\(\) => \{\n    latestRerouteFix\.current = fix;[\s\S]*?\n  \}, \[calculate, clearPendingReroute, fix, gpsReliable, journeyState, planning, target, warningConfig\.distanceMetres\]\);/)?.[0] ?? "";

  assert.notEqual(movementEffect, "");
  assert.match(movementEffect, /journeyState !== "active"/);
  assert.match(movementEffect, /shouldRerouteRoute\(plannedFrom\.current, fix, warningConfig\.distanceMetres\)/);
  assert.match(movementEffect, /rerouteTimer\.current !== null/);
  assert.match(movementEffect, /const rerouteFix = latestRerouteFix\.current;/);
  assert.match(movementEffect, /shouldRerouteRoute\(plannedFrom\.current, rerouteFix, warningConfig\.distanceMetres\)/);
  assert.match(movementEffect, /calculate\(target, rerouteFix, true\)/);
  assert.doesNotMatch(movementEffect, /return \(\) => window\.clearTimeout/);
});

test("route planning cancels pending reroutes only when navigation becomes unsafe or the route is reset", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /if \(\(journeyState !== "active" && startMode !== "gps"\) \|\| gpsReliable\) return;\n    clearPendingReroute\(\);\n    routeWorker\.current\?\.cancel\(\);/);
  assert.match(planner, /const reset = \(\) => \{\n    clearPendingReroute\(\);\n    routeWorker\.current\?\.cancel\(\);/);
  assert.match(planner, /useEffect\(\(\) => \(\) => clearPendingReroute\(\), \[clearPendingReroute\]\);/);
  assert.match(planner, /\[conditionalPassagesEnabled, cruiseSpeedKnots, warningConfig\.distanceMetres, warningConfig\.maxSpeedKnots, warningConfig\.speedWarningEnabled\]/);
});

test("route map controls are bounded and can edit either route point", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /aria-disabled=\{journeyState !== "planning" \|\| planning\}/);
  assert.match(planner, /wasSinglePointer && !gesture\?\.moved && !planning/);
  assert.match(planner, /mapEditMode === "start"/);
  assert.match(planner, /clampRouteViewRange\(value \/ 1\.7\)/);
  assert.match(planner, /clampRouteViewRange\(value \* 1\.7\)/);
  assert.match(planner, /routeViewRangeForTarget\(2_500, start, destination\)/);
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
  assert.match(planner, /route\.mode === "restricted" && <p className="route-detail restricted">/);
  assert.match(planner, /className="route-notices"/);
});

test("route planning exposes editable start and target points", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /type StartMode = "gps" \| "manual"/);
  assert.match(planner, /aria-label=\{`\$\{copy\.start\} \$\{copy\.latitude\}`\}/);
  assert.match(planner, /aria-label=\{`\$\{copy\.target\} \$\{copy\.longitude\}`\}/);
  assert.match(planner, /const swapPoints = \(\) =>/);
  assert.match(planner, /className="route-calculate"/);
  assert.match(planner, /setMapEditMode\("start"\)/);
});

test("route planning keeps secondary controls in compact disclosure panels", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /<header className="route-screen-header">/);
  assert.match(planner, /<details ref=\{routeEditor\} className="route-panel route-editor">/);
  assert.match(planner, /<details className="route-panel route-options">/);
  assert.match(planner, /<details className="route-notices">/);
  assert.match(planner, /preserveAspectRatio="none" role="img"/);
  assert.doesNotMatch(planner, /route-map-heading|route-depth-credit/);
});

test("depth relief is optional, attributed, and excluded from routing options", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /buildEmodnetBathymetryTiles\(mapCentre, viewRangeMetres, 720\)/);
  assert.match(planner, /className="route-depth-tile"/);
  assert.match(planner, /EMODNET_BATHYMETRY_ATTRIBUTION/);
  assert.match(planner, /route-bathymetry-layer/);
  assert.doesNotMatch(planner, /depthMetres:/);
});

test("a planned route can become an active trip with progress and arrival", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /type JourneyState = "planning" \| "active" \| "arrived"/);
  assert.match(planner, /const startJourney = \(\) =>/);
  assert.match(planner, /calculate\(target, fix, true\)/);
  assert.match(planner, /hasReachedRouteTarget\(fix, target\)/);
  assert.match(planner, /routeProgressPercent\(route\.distanceMetres, progressMetres\)/);
  assert.match(planner, /className="route-start-trip"/);
  assert.match(planner, /route-navigation[\s\S]*copy\.remaining[\s\S]*copy\.remainingEta/);
  assert.match(planner, /route-clearance-chip[\s\S]*copy\.clearance/);
  assert.match(planner, /\{journeyState === "planning" && <div className="route-metrics">/);
  assert.match(planner, /REISE AKTIV/);
  assert.match(planner, /TRIP ACTIVE/);
  assert.match(planner, /getActiveRouteViewRange\(proximityRangeMetres, warningConfig\.distanceMetres\)/);
  assert.match(planner, /className="route-live-readouts"/);
  assert.match(planner, /shoreDistanceMetres === null/);
  assert.match(planner, /currentDepthState === "ready"/);
});

test("route bearing follows monotonic projected progress instead of a passed waypoint", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /getProgressAwareRouteGuidance\(route\.points, guidancePosition/);
  assert.match(planner, /geoBearing\(guidancePosition, routeGuidance\.target\)/);
  assert.doesNotMatch(planner, /route\.points\.find\(\(candidate, index\)/);
});

test("navigation claims avoid overpromising and omit obsolete scope disclaimers", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /className="navigation-scope"/);
  assert.match(app, /<span className="power-save-scope">\{copy\.powerNavigationScope\}<\/span>/);
  assert.doesNotMatch(planner, /navigationScope|navigation-scope|route-scope/);
  assert.doesNotMatch(planner, /Nur Küstengeometrie & Abstand|Shoreline geometry & clearance only/);
  assert.doesNotMatch(app, /Freifahrtton|Safe-water chime/);
  assert.doesNotMatch(planner, /Sichere Wasserroute|safe water route|available Croatia chart/);
});

test("conditional Tisno routes remain CHECK routes with bilingual bridge warnings", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /Tisno-Klappbrücke:[\s\S]*geöffneter Brücke/);
  assert.match(planner, /Tisno lift bridge:[\s\S]*only while raised/);
  assert.match(planner, /route\.passageIds\.includes\("tisno-murter-bridge"\)/);
  assert.match(planner, /className="route-passage-warning" role="alert"/);
});

test("route planning copy covers German and English instructions and every failure", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /de:\s*\{[\s\S]*title: "Routenplanung"/);
  assert.match(planner, /en:\s*\{[\s\S]*title: "Route planning"/);
  for (const failure of ["outside-region", "destination-on-land", "too-far", "no-route"]) {
    assert.equal((planner.match(new RegExp(`"${failure}"`, "g")) ?? []).length, 2, failure);
  }
  assert.doesNotMatch(planner, /Keine durchgehende Wasserroute gefunden\. Ziel oder Zoom ändern/);
  assert.doesNotMatch(planner, /No continuous water route found\. Change the target or zoom/);
});
