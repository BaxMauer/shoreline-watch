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
  assert.match(app, /migrateWarningConfig\(JSON\.parse\(savedWarningConfig\)\)/);
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
  assert.match(planner, /if \(gpsStart && !gpsReliable\) return;/);
  assert.match(planner, /getRouteReadinessState\(\{/);
  assert.match(planner, /!gpsReliable \|\| !fix \|\| !target \|\| !hasReachedRouteTarget\(fix, target\)/);
});

test("distance mode samples and displays the current EMODnet chart depth", async () => {
  const depthRoute = await readFile(new URL("../app/api/depth/route.ts", import.meta.url), "utf8");
  assert.match(app, /depthSampleCellKey\(fix\)/);
  assert.match(app, /depthQueryPoint\.current = \{ key: depthCellKey, latitude: fix\.latitude, longitude: fix\.longitude \}/);
  assert.match(app, /gpsSignalState !== "fresh"/);
  assert.doesNotMatch(app, /fix\.latitude\.toFixed\(3\)/);
  assert.match(app, /fetchCurrentWaterDepth\(/);
  assert.match(app, /\(input, init\) => fetch\(input, \{ \.\.\.init, signal: controller\.signal \}\)/);
  assert.match(depthRoute, /fetchEmodnetWaterDepth\(point/);
  assert.match(depthRoute, /AbortSignal\.timeout\(6_500\)/);
  assert.match(await readFile(new URL("../lib/bathymetry.ts", import.meta.url), "utf8"), /const restDepth = finiteNumber\(sample\.avg\) \?\? finiteNumber\(sample\.smoothed\)/);
  assert.match(app, /className=\{`current-depth-footer \$\{currentDepthState\} \$\{shallowWaterActive/);
  assert.match(app, /copy\.chartDepth/);
  assert.match(app, /currentDepthState=\{currentDepthState\}/);
  assert.match(app, /depthMetres === null \? "unavailable" : "ready"/);
});

test("anchor timer is observable, uses wall-clock receipt time, and never hardcodes GO", () => {
  assert.match(app, /getAnchorTimerSnapshot\(\{/);
  assert.match(app, /const observedAt = Date\.now\(\)/);
  assert.match(app, /updateStationaryState\(current, nextFix, warningConfig\.powerSaveAnchorRadiusMetres, observedAt\)/);
  assert.match(app, /className=\{`anchor-timer-chip/);
  assert.match(app, /className=\{`power-save-go \$\{goNoGoState\}`\}/);
  assert.doesNotMatch(app, /className="power-save-go"><i aria-hidden="true">✓/);
});

test("live overview keeps GPS speed in knots and collision prediction is opt-in", () => {
  assert.match(app, /className=\{`current-speed-footer \$\{activeSpeedViolation \? "danger" : ""\}`\}/);
  assert.match(app, /speedKnots === null \? "—" : speedKnots\.toFixed\(1\)/);
  assert.doesNotMatch(app, /className="live-readouts"/);
  assert.match(app, /checked=\{warningConfig\.courseWarningEnabled\}/);
  assert.match(app, /if \(!warningConfig\.courseWarningEnabled \|\| !gpsReliable/);
});

test("live overview places the distance instrument over the map", () => {
  const summary = app.indexOf('className="instrument-summary"');
  const anchor = app.indexOf("anchor-timer-chip", summary);
  const mapStage = app.indexOf('className="map-stage"');
  const proximityPlot = app.indexOf("<ProximityPlot", mapStage);
  const distance = app.indexOf('className="summary-primary-row distance-map-overlay"', proximityPlot);
  const footer = app.indexOf('className="instrument-footer"');
  const depth = app.indexOf("current-depth-footer", footer);
  const accuracy = app.indexOf("m GPS", depth);
  const speed = app.indexOf("current-speed-footer", accuracy);
  assert.ok(summary >= 0 && anchor > summary && mapStage > anchor && proximityPlot > mapStage && distance > proximityPlot && footer > distance);
  assert.ok(depth > footer && accuracy > depth && speed > accuracy);
  assert.doesNotMatch(app, /className="tracker-head"/);
  assert.match(app, /className="tracking-controls"/);
});

test("anchor timer stays in debug data but appears in the overview only after twenty seconds", () => {
  assert.match(app, /const anchorTimerVisible = mode === "live" && shouldShowAnchorTimer\(anchorTimer\.elapsedMs\)/);
  assert.match(app, /visibleInOverview: anchorTimerVisible/);
  assert.match(app, /anchorWatch \? <div className=\{`anchor-watch-card/);
  assert.match(app, /\{anchorTimerVisible && <div className=\{`anchor-timer-chip/);
  assert.match(app, /<button className="anchor-set-button"/);
});

test("explicit anchor watch persists and renders anchor, rode, swing circle, and breach state", () => {
  assert.match(app, /ANCHOR_WATCH_STORAGE_KEY/);
  assert.match(app, /createAnchorWatch\(fix, Date\.now\(\), place\)/);
  assert.match(app, /getAnchorWatchSnapshot\(anchorWatch, fix/);
  assert.match(app, /className="anchor-swing-circle"/);
  assert.match(app, /className="anchor-rode"/);
  assert.match(app, /anchorWatchSnapshot\.breached \? copy\.anchorDragging/);
});

test("activity log is local, bounded, and available during and outside tracking", async () => {
  const activity = await readFile(new URL("../lib/activity-log.ts", import.meta.url), "utf8");
  const tracks = await readFile(new URL("../lib/activity-track.ts", import.meta.url), "utf8");
  const overview = await readFile(new URL("../app/activity-overview.tsx", import.meta.url), "utf8");
  const miniMap = await readFile(new URL("../app/activity-mini-map.tsx", import.meta.url), "utf8");
  assert.match(app, /ACTIVITY_LOG_STORAGE_KEY/);
  assert.match(app, /<ActivityOverview/);
  assert.match(app, /trackerTab === "activities"/);
  assert.match(activity, /MAX_ACTIVITY_RECORDS = 200/);
  assert.match(activity, /slice\(0, MAX_ACTIVITY_RECORDS\)/);
  assert.match(app, /finishTripDraft\(draft, endedAt/);
  assert.match(app, /getAnchorPlace\(mapFeaturePack, fix\)/);
  assert.match(app, /mode !== "live" \|\| !fix \|\| !currentTrip\.current/);
  assert.match(app, /saveTripTrackPoint\(trackPoint\)/);
  assert.match(app, /PENDING_TRACK_POINT_STORAGE_KEY/);
  assert.match(app, /addEventListener\("pagehide", persistActiveTrip\)/);
  assert.match(app, /localStorage\.setItem\(ACTIVITY_LOG_STORAGE_KEY, JSON\.stringify\(restoredActivities\)\)/);
  assert.match(app, /const storeActivityRecord = useCallback/);
  assert.match(app, /localStorage\.setItem\(ACTIVITY_LOG_STORAGE_KEY, JSON\.stringify\(nextRecords\)\)/);
  assert.doesNotMatch(app.match(/useEffect\(\(\) => \{[\s\S]*?saveTripTrackPoint\(trackPoint\)[\s\S]*?\}, \[[^\]]+\]\);/)?.[0] ?? "", /trackerTab|route/);
  assert.match(tracks, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
  assert.match(tracks, /createIndex\("tripId", "tripId"/);
  assert.match(overview, /getTripTrack\(trip\.id\)/);
  assert.match(overview, /buildTripGpx\(title, points\)/);
  assert.match(overview, /auch ohne aktive Navigation/);
  assert.match(overview, /import ActivityMiniMap from "\.\/activity-mini-map"/);
  assert.match(overview, /<ActivityMiniMap trip=\{record\} coastline=\{coastline\} language=\{language\} \/>/);
  assert.match(miniMap, /fallbackTrack\(trip\)/);
  assert.match(miniMap, /getTripTrack\(trip\.id\)/);
  assert.match(miniMap, /className="activity-mini-map"/);
  assert.match(miniMap, /className="activity-mini-land"/);
  assert.match(activity, /export function removeActivityRecord/);
  assert.match(app, /const deleteActivityLogEntry = useCallback/);
  assert.match(app, /window\.localStorage\.setItem\(ACTIVITY_LOG_STORAGE_KEY, JSON\.stringify\(nextRecords\)\)/);
  assert.match(app, /if \(record\.kind === "trip"\) void deleteTripTrack\(record\.id\)/);
  assert.match(app, /onDelete=\{\(record\) => window\.confirm/);
  assert.match(overview, /className="activity-delete"/);
  assert.match(overview, /onClick=\{\(\) => onDelete\(record\)\}/);
  assert.match(overview, /Diesen Logbucheintrag löschen/);
  assert.match(overview, /getMapViewportExtent\(TRACK_MAP_WIDTH, TRACK_MAP_HEIGHT, scale, 4\)/);
  assert.match(overview, /className="track-map-land">\{map\.landBands\.map/);
  assert.doesNotMatch(overview, /let landPath =/);
  assert.match(overview, /onPointerMove=\{handlePointerMove\}/);
  assert.match(overview, /onWheel=\{handleWheel\}/);
  assert.match(overview, /aria-label=\{language === "de" \? "Vergrößern" : "Zoom in"\}/);
  assert.match(overview, /Ziehen · Aufziehen zum Zoomen/);
});

test("anchor drift alarm sounds, vibrates, flashes, and repeats while breached", () => {
  assert.match(app, /shouldSoundAnchorDriftAlarm\(/);
  assert.match(app, /triggerVisualSignal\("anchor"\)/);
  assert.match(app, /triggerVibration\("danger"\)/);
  assert.match(app, /void soundAlarm\(\)/);
});

test("offline packages and shallow-water marking are exposed as user controls", async () => {
  const manager = await readFile(new URL("../app/offline-package-manager.tsx", import.meta.url), "utf8");
  assert.match(app, /<OfflinePackageManager language=\{language\} fix=\{fix\} \/>/);
  assert.match(manager, /downloadOfflinePackage\(/);
  assert.match(manager, /removeOfflinePackage\(/);
  assert.match(app, /checked=\{warningConfig\.shallowWaterEnabled\}/);
  assert.match(app, /className="shallow-water-zone"/);
});

test("wind data drives a reusable animated overlay on distance and route maps", async () => {
  const overlay = await readFile(new URL("../app/wind-overlay.tsx", import.meta.url), "utf8");
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  const windRoute = await readFile(new URL("../app/api/wind/route.ts", import.meta.url), "utf8");
  assert.match(app, /fetchMapWindSample\(\{ latitude: windLatitude, longitude: windLongitude \}, fetch, requestController\.signal\)/);
  assert.match(app, /<WindOverlay sample=\{windSample\} visible=\{showWind && trackerTab === "distance" && !powerSaveReason\}/);
  assert.match(app, /windReloadSequence/);
  assert.match(app, /windUnavailable/);
  assert.match(planner, /<WindOverlay sample=\{windSample\} visible=\{showWind\} mapRotationDegrees=\{mapRotationDegrees\} mapView=\{\{ centre: mapCentre, rangeMetres: viewRangeMetres \}\} paused=\{mapInteracting\} \/>/);
  assert.match(overlay, /requestAnimationFrame\(callback\)/);
  assert.match(overlay, /document\.visibilityState !== "visible"/);
  assert.match(overlay, /new IntersectionObserver/);
  assert.match(overlay, /createAnimationFrameLoop/);
  assert.match(overlay, /motionQuery\.addEventListener\("change"/);
  assert.match(overlay, /context\.setTransform\(1, 0, 0, 1, 0, 0\)/);
  assert.match(overlay, /getWindCanvasSize\(bounds\.width, bounds\.height, devicePixelRatio\)/);
  assert.match(overlay, /const scheduleResize/);
  assert.match(overlay, /if \(changed\) lastFrameAt = 0/);
  assert.match(overlay, /if \(changed \|\| reducedMotion\) draw\(\)/);
  assert.match(overlay, /observer\.observe\(canvas\.parentElement \?\? canvas\)/);
  assert.match(overlay, /advanceWindParticle\(particle, angle, speed, elapsedSeconds, width, height\)/);
  assert.match(overlay, /getWindMapOffset\(mapViewRef\.current, width, height\)/);
  assert.match(overlay, /wrapWindCoordinate\(particle\.x \* width \+ mapOffset\.x, width\)/);
  assert.doesNotMatch(overlay, /ResizeObserver\(\(\) => \{ resize\(\); draw\(\); \}\)/);
  assert.match(overlay, /length: 96/);
  assert.match(overlay, /--wind-flow-colour/);
  assert.match(overlay, /context\.arc\(x, y, 1\.45/);
  assert.match(overlay, /prefers-reduced-motion: reduce/);
  assert.match(windRoute, /AbortSignal\.timeout\(6_500\)/);
  assert.match(windRoute, /max-age=600, stale-while-revalidate=1800/);
});

test("launch screen is compact and uses a motion-safe radar treatment", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(app, /className="launch-radar"/);
  assert.match(css, /\.intro\s*\{[^}]*min-height:\s*210px[^}]*grid-template-columns:/s);
  assert.match(css, /@keyframes launch-sweep/);
  assert.match(css, /@keyframes launch-button-shine/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("wide launch and tab icons use an intentional shared layout contract", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 1200px\)[\s\S]*\.app-shell:not\(\.is-tracking\):has\(\.launch-panel\)[^{]*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.tracker-tabs button > span:first-child\s*\{[^}]*width:\s*30px[^}]*border-radius:\s*50%/s);
});

test("debug setting persists and exposes live GPS, anchor, depth, alarm, and map data", () => {
  assert.match(app, /localStorage\.getItem\(DEBUG_STORAGE_KEY\)/);
  assert.match(app, /localStorage\.setItem\(DEBUG_STORAGE_KEY, String\(debugEnabled\)\)/);
  for (const key of ["environment", "session", "gps", "anchor", "shore", "depth", "warning", "alarm", "mapData"]) {
    assert.match(app, new RegExp(`${key}: \\{`));
  }
  assert.match(app, /className="debug-panel"/);
});

test("OSM feature catalog loads non-blockingly and labels both map modes", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(app, /fetch\("\/data\/croatia-map-features\.json"\)/);
  assert.match(app, /mapFeatureError/);
  assert.match(app, /<ProximityPlot[\s\S]*mapFeaturePack=\{mapFeaturePack\}/);
  assert.match(planner, /getMapFeaturesInView\(mapFeaturePack, mapCentre, currentMapDataRangeMetres\)\.slice\(0, currentRenderingDetail\.maximumLabels\)/);
  assert.match(planner, /© OpenStreetMap contributors/);
  const depthLayer = planner.indexOf("className=\"route-bathymetry-layer\"");
  const landLayer = planner.indexOf("className=\"route-land-area\"");
  const labelLayer = planner.indexOf("className=\"map-feature-labels\"");
  assert.ok(depthLayer >= 0 && landLayer > depthLayer && labelLayer > landLayer);
});

test("active trip map mirrors the distance instrument's clearance geometry", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /findNearestShore\(pack, fix\.longitude, fix\.latitude\)/);
  assert.match(planner, /className="route-warning-ring"/);
  assert.match(planner, /className="route-nearest-line"/);
  assert.doesNotMatch(planner, /className="route-distance-label"/);
  assert.match(planner, /getActiveRouteViewRange\(proximityRangeMetres, warningConfig\.distanceMetres\)/);
  assert.match(app, /<RoutePlanner[\s\S]*goNoGoState=\{goNoGoState\}/);
});

test("active navigation uses a map-first distance instrument layout", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /className="route-screen-header"[\s\S]*activeJourney && route[\s\S]*className="route-live-guidance"/);
  assert.match(planner, /className="summary-primary-row distance-map-overlay route-live-map-overlay"[\s\S]*className="distance-readout route-live-distance"[\s\S]*copy\.nearestShore/);
  assert.match(planner, /className=\{`go-no-go route-live-go-no-go \$\{goNoGoState\}`\}/);
  assert.match(planner, /className="instrument-footer route-live-footer"[\s\S]*className="instrument-meta route-live-meta"[\s\S]*copy\.chartDepth[\s\S]*GPS[\s\S]*copy\.currentSpeed[\s\S]*route-end-trip/);
});

test("active navigation keeps zoom controls visible", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.journey-active \.route-zoom > button[\s\S]*display: grid/);
  assert.doesNotMatch(css, /\.journey-active \.route-zoom > button:not\(\.route-orientation-control\)[^{]*\{[^}]*display: none/);
});

test("power saver runs only in live mode, honours all recent interaction, and retains GPS tracking", () => {
  assert.match(app, /tracking:\s*mode === "live"/);
  assert.match(app, /setPowerSaveWakeUntil\(interactedAt \+ POWER_SAVE_INTERACTION_GUARD_MS\)/);
  for (const handler of ["onPointerDownCapture", "onKeyDownCapture", "onWheelCapture"]) {
    assert.match(app, new RegExp(`${handler}=\\{registerInteraction\\}`));
  }
  assert.match(app, /className="power-save-screen" type="button" onClick=\{wakePowerDisplay\}/);
  assert.doesNotMatch(app, /powerSaveReason[\s\S]{0,200}clearWatch/);
});

test("nearest shore, warning ring, collision course, and boat remain separate SVG layers", () => {
  for (const className of ["land-hatch-layer", "nearest-shore-line", "coast-layer", "proximity-ring", "danger-ring-arc", "course-line", "nearest-point", "map-boat"]) {
    assert.match(app, new RegExp(`className=(?:\\{[^}]+\\}|\")${className}`));
  }
});

test("tracking exposes distance, route, and nautical weather tabs", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  const weather = await readFile(new URL("../app/nautical-weather.tsx", import.meta.url), "utf8");
  const chart = await readFile(new URL("../app/weather-chart.tsx", import.meta.url), "utf8");
  const weatherMap = await readFile(new URL("../app/weather-map.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(app, /type TrackerTab = "distance" \| "route" \| "weather"/);
  assert.match(app, /<nav className="tracker-tabs"/);
  assert.match(app, /<NauticalWeather point=\{fix\} active=\{trackerTab === "weather"\}/);
  assert.match(app, /<RoutePlanner[\s\S]*warningConfig=\{warningConfig\}/);
  assert.match(weather, /Promise\.allSettled\(\[/);
  assert.match(weather, /activeForecast\.days\.slice\(0, 2\)/);
  assert.match(weather, /getBestBoatingWindow\(day\)/);
  assert.match(weather, /setSelectedMetric\("wind"\)/);
  assert.match(weather, /<WeatherChart hours=\{day\.hours\}/);
  assert.match(weather, /<WeatherMap point=\{point\}/);
  assert.match(weather, /buildNauticalWeatherMapRequestUrls\(queryPoint\)/);
  assert.match(chart, /type="range"/);
  assert.match(chart, /onPointerDown=\{selectFromPointer\}/);
  assert.match(weatherMap, /weather-map-heat/);
  assert.match(weatherMap, /weather-map-coast/);
  assert.match(weatherMap, /weather-map-land/);
  assert.match(weatherMap, /weather-map-labels/);
  assert.match(weatherMap, /weather-map-vectors/);
  assert.match(weatherMap, /weather-map-inspector/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /weather-wave/);
  assert.match(planner, /new Worker\(/);
  assert.match(planner, /route-planning\.worker\.ts/);
  assert.doesNotMatch(planner, /planWaterRoute\(/);
  assert.match(planner, /getNearbyShorelineSegments/);
  assert.equal((planner.match(/fetch\(/g) ?? []).length, 1);
  assert.match(planner, /fetch\(`\/api\/places/);
  assert.doesNotMatch(planner, /XMLHttpRequest|WebSocket/);
});

test("weather map prioritizes geography and one selected value over grid bubbles", async () => {
  const weatherMap = await readFile(new URL("../app/weather-map.tsx", import.meta.url), "utf8");
  const weather = await readFile(new URL("../app/nautical-weather.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const layers = ["weather-map-heat", "weather-map-land", "weather-map-coast", "weather-map-labels", "weather-map-vectors", "weather-map-hit-areas", "weather-map-boat"]
    .map((className) => weatherMap.indexOf(`className="${className}"`));
  assert.ok(layers.every((position) => position >= 0));
  assert.deepEqual(layers, layers.toSorted((left, right) => left - right));
  assert.match(weatherMap, /getLandIntervalsAtLatitude/);
  assert.match(weatherMap, /placeMapFeatureLabels/);
  assert.match(weatherMap, /role="button" tabIndex=\{0\}/);
  assert.match(weatherMap, /10 km/);
  assert.doesNotMatch(weatherMap, /weather-map-values/);
  assert.match(weather, /mapFeatures=\{mapFeatures\}/);
  assert.match(styles, /\.weather-map-land\s*\{[^}]*weather-map-land-hatch/s);
  assert.match(styles, /\.weather-map-hit-areas g:focus-visible/s);
});

test("route planning applies warning distance and near-shore speed settings", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /clearanceMetres: warningConfig\.distanceMetres/);
  assert.match(planner, /speedWarningEnabled: warningConfig\.speedWarningEnabled/);
  assert.match(planner, /nearShoreSpeedKnots: warningConfig\.maxSpeedKnots/);
  assert.match(planner, /startAccuracyMetres: gpsStart \? fix\?\.accuracy : undefined/);
  assert.match(planner, /route\.mode === "restricted"/);
  assert.match(planner, /route\?\.mode === "restricted"/);
});

test("place search converts land centroids into navigable water targets", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /const destination = resolvePlaceSearchTarget\(pack, result, undefined, effectiveStart\)/);
  assert.match(planner, /selectTarget\(destination\)/);
  assert.match(planner, /pendingPlaceTarget\.current = pack \? null : result/);
  assert.match(planner, /setFocusedPlace\(\{ \.\.\.result, \.\.\.destination \}\)/);
});

test("route destination requires a stationary long press or entered coordinates", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /const navigableDestination = resolvePlaceSearchTarget\(pack, destination, undefined, start\)/);
  assert.match(planner, /longPressTimer\.current = window\.setTimeout/);
  assert.match(planner, /shouldCommitRouteMapLongPress\(\{/);
  assert.match(planner, /elapsedMs: Date\.now\(\) - activeCandidate\.startedAt/);
  assert.match(planner, /if \(mapEditMode === "start"\) selectStart\(activeCandidate\.point\);[\s\S]*else selectTarget\(activeCandidate\.point\);/);
  assert.doesNotMatch(planner, /wasSinglePointer && !gesture\?\.moved/);
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
  assert.match(planner, /const reset = \(\) => \{\n    cancelLongPress\(\);\n    clearPendingReroute\(\);\n    routeWorker\.current\?\.cancel\(\);/);
  assert.match(planner, /useEffect\(\(\) => \(\) => clearPendingReroute\(\), \[clearPendingReroute\]\);/);
  assert.match(planner, /\[conditionalPassagesEnabled, cruiseSpeedKnots, warningConfig\.distanceMetres, warningConfig\.maxSpeedKnots, warningConfig\.speedWarningEnabled\]/);
});

test("route map controls are bounded and can edit either route point", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /aria-disabled=\{planning\}/);
  assert.match(planner, /ROUTE_MAP_LONG_PRESS_MS/);
  assert.match(planner, /ROUTE_MAP_MOVE_TOLERANCE_PX/);
  assert.match(planner, /mapEditMode === "start"/);
  assert.match(planner, /clampMapRange\(value \/ 1\.7\)/);
  assert.match(planner, /clampMapRange\(value \* 1\.7\)/);
  assert.match(planner, /routeViewRangeForTarget\(2_500, start, destination\)/);
});

test("route planning snaps land starts to navigable water before using the worker", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /const routingStart = resolveNearestNavigableWater\(pack, requestedStart\)/);
  assert.match(planner, /start: routingStart/);
  assert.match(planner, /const navigableStart = resolveNearestNavigableWater\(pack, start\)/);
});

test("navigation makes speed and wind readings easier to scan", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(planner, /className="current-speed-footer"><strong>\{speedKnots/);
  assert.match(css, /\.wind-map-control b\s*\{[^}]*font-size:\s*\.68rem/s);
  assert.match(css, /\.route-layer-tools button\.wind\s*\{[^}]*font-size:\s*\.68rem/s);
  assert.match(css, /\.current-speed-footer strong\s*\{[^}]*font-size:\s*1\.05rem/s);
});

test("route map supports drag, pinch, wheel, keyboard zoom, and recenter", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  for (const handler of ["handlePointerDown", "handlePointerMove", "handlePointerUp", "handlePointerCancel", "handleWheel", "handleMapKey"]) {
    assert.match(planner, new RegExp(`on(?:PointerDown|PointerMove|PointerUp|PointerCancel|Wheel|KeyDown)=\\{${handler}\\}`));
  }
  assert.match(planner, /pinchRouteViewRange\(gesture\.range, gesture\.distance, metrics\.distance, clampMapRange\)/);
  assert.match(planner, /panRouteMapCentre\(gesture\.centre, gesture\.range, size, northUpDelta\.x, northUpDelta\.y, clampMapRange\)/);
  assert.match(planner, /window\.requestAnimationFrame\(commitMapView\)/);
  assert.match(planner, /scheduleMapView\(/);
  assert.match(planner, /latestMapView\.current = \{ centre: mapCentre, rangeMetres: viewRangeMetres \}/);
  assert.match(planner, /setRenderedMapView\(latestMapView\.current\)/);
  assert.match(planner, /const staticMapLayers = useMemo\(\(\) => <>/);
  assert.match(planner, /className="route-static-map" transform=\{staticMapTransform\}/);
  assert.match(planner, /className="route-dynamic-map"/);
  assert.match(planner, /className="route-recenter"[\s\S]*onClick=\{recenterMap\}/);
  assert.match(planner, /journeyState === "planning" \? clampRouteViewRange : clampActiveRouteViewRange/);
  assert.doesNotMatch(planner, /journeyState === "planning" && <button type="button" aria-label=\{copy\.zoomIn\}/);
});

test("compact app typography has one readable minimum", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const remSizes = [...css.matchAll(/font-size:\s*(\.\d+)rem/g)].map((match) => Number(match[1]));
  assert.ok(remSizes.length > 0);
  assert.ok(remSizes.every((size) => size >= .68), `found font size below .68rem: ${Math.min(...remSizes)}`);
  assert.match(css, /\.map-feature-label text\s*\{[^}]*font-size:\s*8\.5px/s);
});

test("distance and route maps share a persisted heading-up compass mode", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  const orientationControl = await readFile(new URL("../app/map-orientation-control.tsx", import.meta.url), "utf8");
  assert.match(app, /MAP_HEADING_UP_STORAGE_KEY/);
  assert.match(app, /className="distance-orientation-control"/);
  assert.match(app, /<RoutePlanner[\s\S]*headingUp=\{headingUp\}[\s\S]*onToggleHeadingUp=/);
  assert.match(planner, /className="route-oriented-map" transform=\{mapOrientationTransform\}/);
  assert.match(planner, /rotateMapPoint\(\{ x, y \}, mapRotationPivot, -mapRotationDegrees\)/);
  assert.match(planner, /rotateMapDelta\(\{ x: deltaX, y: deltaY \}, -mapRotationDegrees\)/);
  assert.match(planner, /className="route-orientation-control"/);
  assert.match(orientationControl, /aria-pressed=\{headingUp\}/);
});

test("Croatian place search combines local fuzzy matching with bounded Photon results", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  const placeRoute = await readFile(new URL("../app/api/places/route.ts", import.meta.url), "utf8");
  assert.match(planner, /searchLocalCroatianPlaces\(placeQuery\)/);
  assert.match(planner, /searchCroatianMapFeatures\(mapFeaturePack, placeQuery\)/);
  assert.match(planner, /fetch\(`\/api\/places\?q=\$\{encodeURIComponent\(query\)\}&lang=\$\{language\}`/);
  assert.match(planner, /focusPlaceResult\(result\)/);
  assert.match(planner, /const destination = resolvePlaceSearchTarget\(pack, result, undefined, effectiveStart\)/);
  assert.match(planner, /focusPlaceResult[\s\S]{0,400}selectTarget\(destination\)/);
  assert.match(placeRoute, /buildPhotonPlaceSearchUrl\(query, language\)/);
  assert.match(placeRoute, /AbortSignal\.timeout\(5_500\)/);
  assert.match(placeRoute, /User-Agent": "Shoreline-Watch place-search \(\+https:\/\/boot\.maxi-bauer\.de\)"/);
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
  assert.match(planner, /preserveAspectRatio="xMidYMid meet" role="img"/);
  assert.doesNotMatch(planner, /route-map-heading|route-depth-credit/);
});

test("depth relief is optional, attributed, and excluded from routing options", async () => {
  const planner = await readFile(new URL("../app/route-planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /buildEmodnetBathymetryTiles\(renderedCentre, mapDataRangeMetres, 720\)/);
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
  assert.match(planner, /route-live-guidance[\s\S]*copy\.remaining[\s\S]*copy\.remainingEta/);
  assert.match(planner, /className=\{`clearance \$\{route\.mode\}`\}[\s\S]*copy\.clearance/);
  assert.match(planner, /\{journeyState === "planning" && <div className="route-metrics">/);
  assert.match(planner, /REISE AKTIV/);
  assert.match(planner, /TRIP ACTIVE/);
  assert.match(planner, /getActiveRouteViewRange\(proximityRangeMetres, warningConfig\.distanceMetres\)/);
  assert.match(planner, /className="distance-readout route-live-distance"/);
  assert.match(planner, /route-live-go-no-go \$\{goNoGoState\}/);
  assert.match(planner, /className="summary-primary-row distance-map-overlay route-live-map-overlay"/);
  assert.match(planner, /className="instrument-footer route-live-footer"/);
  assert.match(planner, /liveShallow \? copy\.shallow : copy\.chartDepth/);
  assert.match(planner, /kn · \{copy\.currentSpeed\}/);
  assert.match(planner, /goNoGoState: GoNoGoState/);
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
