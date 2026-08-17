import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const app = await readFile(new URL("../app/shoreline-app.tsx", import.meta.url), "utf8");

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function luminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(left, right) {
  const bright = Math.max(luminance(left), luminance(right));
  const dark = Math.min(luminance(left), luminance(right));
  return (bright + 0.05) / (dark + 0.05);
}

function variablesFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  assert.ok(block, `Missing CSS block for ${selector}`);
  return Object.fromEntries(Array.from(block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi), (match) => [match[1], match[2]]));
}

const themeSelectors = {
  Ocean: ":root",
  Dark: 'html[data-theme="dark"]',
  "Windows XP": 'html[data-theme="xp"]',
  Nautical: 'html[data-theme="nautical"]',
};

for (const [theme, selector] of Object.entries(themeSelectors)) {
  test(`${theme} theme keeps the shoreline visually distinct`, () => {
    const variables = variablesFor(selector);
    assert.ok(contrast(variables["shore-stroke"], variables["instrument-surface"]) >= 3);
    assert.ok(contrast(variables["shore-close"], variables["instrument-surface"]) >= 3);
  });
}

test("tracking instrument is borderless and the coastline is continuous", () => {
  assert.match(css, /\.instrument\s*\{[^}]*border-radius:\s*0;/s);
  assert.match(css, /\.instrument\s*\{[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.shore-segment\s*\{[^}]*stroke-width:\s*3;/s);
  const regularCoast = css.match(/\.shore-segment\s*\{[^}]*\}/s)?.[0] ?? "";
  const closeCoast = css.match(/\.shore-segment\.close\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.doesNotMatch(regularCoast, /stroke-dasharray/);
  assert.doesNotMatch(closeCoast, /stroke-dasharray/);
});

test("land is hatched across the complete plot with Safari-stable scan bands", () => {
  assert.match(app, /<pattern id="landHatch"[^>]*>[\s\S]*className="land-hatch-mark"/);
  assert.doesNotMatch(app, /<clipPath id="plotClip"/);
  assert.match(app, /className="land-hatch-layer" aria-hidden="true"/);
  assert.doesNotMatch(app, /clipPath="url\(#plotClip\)"/);
  assert.match(app, /landHatchBands\.map\(\(band, index\) => <rect className="land-hatch-area"/);
  assert.match(css, /\.land-hatch-area\s*\{[^}]*fill:\s*url\(#landHatch\)/s);
  assert.match(css, /\.land-hatch-mark\s*\{[^}]*stroke:\s*var\(--shore-stroke\)/s);
  assert.match(app, /getLandIntervalsAtLatitude\(pack, latitude, minimumLongitude, maximumLongitude\)/);
  assert.match(app, /const bandHeight = 4/);
  assert.doesNotMatch(app, /getLandHatchPolygon/);
  assert.doesNotMatch(app, /const landHatchPath/);
});

test("nearest shoreline guide is dashed, subtle, and behind the coast", () => {
  assert.match(css, /\.nearest-shore-line\s*\{[^}]*stroke-dasharray:\s*2\.5 7/s);
  assert.match(css, /\.nearest-shore-line\s*\{[^}]*opacity:\s*\.3/s);
  assert.match(app, /className="nearest-shore-line"[\s\S]*x1=\{centre\}[\s\S]*x2=\{nearestPoint\.x\}/);
  assert.ok(app.indexOf('className="land-hatch-layer"') < app.indexOf('className="nearest-shore-line"'));
  assert.ok(app.indexOf('className="nearest-shore-line"') < app.indexOf('className="coast-layer"'));
});

test("SVG layers preserve hatch, guide, coast, warning, course, target, and boat order", () => {
  const positions = [
    'className="land-hatch-layer"',
    'className="nearest-shore-line"',
    'className="coast-layer"',
    'className="proximity-ring"',
    'className="course-line"',
    'className="nearest-point"',
    'className="map-boat"',
  ].map((needle) => app.indexOf(needle));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, positions.toSorted((left, right) => left - right));
});

test("visual alerts include distinct danger and safe-water signals", () => {
  assert.match(css, /\.visual-signal\.distance, \.visual-signal\.speed\s*\{[^}]*danger-screen-signal/s);
  assert.match(css, /\.visual-signal\.safe\s*\{[^}]*safe-screen-signal/s);
  assert.match(css, /@keyframes danger-screen-signal/);
  assert.match(css, /@keyframes safe-screen-signal/);
});

test("sunlight mode provides a dedicated high-contrast instrument", () => {
  assert.match(css, /\.sunlight-mode \.instrument[^}]*#fbfdfc/s);
  assert.match(css, /\.sunlight-mode \.distance-readout strong\s*\{[^}]*#071b22/s);
  assert.match(css, /\.sunlight-mode\s*\{[^}]*--shore-stroke:\s*#385f64/s);
});

test("weather cards keep dedicated readable colors in every visual mode", () => {
  assert.match(css, /\.weather-panel\s*\{[^}]*--weather-ink:\s*#edf5f1[^}]*--weather-muted:\s*#a9c1bf[^}]*color:\s*var\(--weather-ink\)/s);
  assert.match(css, /\.weather-condition-copy > strong\s*\{[^}]*color:\s*var\(--weather-ink\)/s);
  assert.match(css, /\.weather-primary-grid strong\s*\{[^}]*color:\s*var\(--weather-ink\)/s);
  assert.match(css, /\.weather-details-grid strong\s*\{[^}]*color:\s*var\(--weather-ink\)/s);
  assert.match(css, /\.theme-xp \.weather-panel\s*\{[^}]*--weather-ink:\s*#10213b[^}]*--weather-muted:\s*#4f5966/s);
  assert.match(css, /\.theme-nautical \.weather-panel\s*\{[^}]*--weather-ink:\s*#152f3b[^}]*--weather-muted:\s*#655b43/s);
  assert.match(css, /\.sunlight-mode \.weather-panel\s*\{[^}]*--weather-ink:\s*#071b22[^}]*--weather-muted:\s*#49696b[^}]*#f8fbfa/s);
  assert.ok(contrast("#071b22", "#f8fbfa") >= 12);
  assert.ok(contrast("#49696b", "#f8fbfa") >= 5);
});

test("distance digits cannot collide on a narrow phone", () => {
  assert.match(css, /\.distance-readout strong\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(css, /\.distance-readout\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css, /\.distance-readout strong\s*\{[^}]*11\.2rem[^}]*56vw[^}]*17rem/s);
  assert.match(css, /\.distance-readout\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /\.distance-readout strong\s*\{[^}]*font-size:\s*min\([^}]*100cqi/s);
  assert.match(css, /\.distance-readout strong\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.distance-readout strong\s*\{[^}]*letter-spacing:\s*-\.055em/s);
  assert.match(css, /\.distance-readout strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(css, /\.distance-readout strong\s*\{[^}]*letter-spacing:\s*-\.10[5-9]em/s);
});

test("GO status and OLED power saver have dedicated high-contrast surfaces", () => {
  assert.match(css, /\.go-no-go\.go\s*\{[^}]*border-color:\s*#7ff3d1[^}]*background:\s*#075f50[^}]*color:\s*#fff/s);
  assert.match(css, /\.go-no-go\.go span\s*\{[^}]*background:\s*#8ff5d8[^}]*color:\s*#063f36/s);
  assert.match(css, /\.go-no-go\.no-go\s*\{[^}]*background:\s*rgba\(139,31,23,.96\)[^}]*color:\s*#fff/s);
  assert.match(css, /\.power-save-screen\s*\{[^}]*background:\s*#000/s);
  assert.match(css, /\.power-save-active \*\s*\{[^}]*animation-play-state:\s*paused/s);
});

test("distance, status, GO, and warning cards are sized for viewing from afar", () => {
  assert.match(css, /\.distance-readout strong\s*\{[^}]*--distance-scale/s);
  assert.match(css, /\.status-pill\s*\{[^}]*min-height:\s*42px[^}]*font-size:\s*\.78rem/s);
  assert.match(css, /\.go-no-go\s*\{[^}]*min-height:\s*58px[^}]*font-size:\s*1\.12rem/s);
  assert.match(css, /\.course-alert\s*\{[^}]*min-height:\s*64px/s);
  assert.match(css, /\.visual-signal-card strong\s*\{[^}]*font-size:\s*1\.28rem/s);
  assert.match(css, /\.theme-xp \.go-no-go\.no-go, \.theme-nautical \.go-no-go\.no-go, \.sunlight-mode \.go-no-go\.no-go\s*\{[^}]*#9f2d23[^}]*#fff/s);
  assert.match(css, /\.theme-xp \.go-no-go\.go, \.theme-nautical \.go-no-go\.go, \.sunlight-mode \.go-no-go\.go\s*\{[^}]*#006b54[^}]*#fff/s);
  assert.match(css, /\.instrument-meta\s*\{[^}]*min-height:\s*48px[^}]*font-variant-numeric:\s*tabular-nums/s);
});

test("live map keeps the distance instrument as a readable map overlay", () => {
  assert.match(css, /\.is-tracking \.topbar\s*\{[^}]*min-height:\s*38px/s);
  assert.match(css, /\.instrument\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.map-stage\s*\{[^}]*position:\s*relative[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.proximity-plot\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(css, /\.instrument-footer\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.current-depth-footer strong\s*\{[^}]*var\(--aqua\)/s);
  assert.match(css, /\.current-speed-footer strong\s*\{[^}]*var\(--aqua\)/s);
  assert.match(css, /\.distance-map-overlay\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*background:\s*none/s);
  assert.match(css, /\.distance-map-overlay > \.distance-readout\s*\{[^}]*border-radius:\s*18px[^}]*background:\s*linear-gradient[^}]*backdrop-filter:\s*blur\(14px\)/s);
});

test("active route view becomes a distance-first navigation cockpit", () => {
  assert.match(css, /\.route-live-map-overlay > \.route-live-distance\s*\{[^}]*width:\s*min\(72%, 280px\)/s);
  assert.match(css, /\.journey-active \.route-screen-header \.route-live-guidance, \.journey-arrived \.route-screen-header \.route-live-guidance\s*\{[^}]*grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.route-live-footer\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) auto/s);
  assert.match(css, /\.route-live-footer \.route-live-meta\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.route-warning-ring\s*\{[^}]*stroke-dasharray:[^}]*vector-effect:\s*non-scaling-stroke/s);
  assert.match(css, /\.route-live-proximity\.danger \.route-warning-ring\s*\{[^}]*var\(--danger\)[^}]*ring-breathe/s);
  assert.match(css, /\.journey-active, \.journey-arrived\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.journey-active \.route-map-wrap, \.journey-arrived \.route-map-wrap\s*\{[^}]*height:\s*100%[^}]*aspect-ratio:\s*auto/s);
  assert.match(css, /\.distance-map-overlay\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.route-static-map\s*\{[^}]*will-change:\s*transform/s);
  assert.doesNotMatch(css, /\.route-live-(?:distance|guidance|go-no-go)\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(css, /\.journey-(?:active|arrived) \.map-feature-label[^}]*display:\s*none/s);
  assert.match(css, /\.journey-active \.route-screen-header, \.journey-arrived \.route-screen-header\s*\{[^}]*min-height:\s*96px[^}]*backdrop-filter:\s*blur\(12px\)/s);
});

test("route map declares touch panning and strong focus affordances", () => {
  assert.match(css, /\.route-map\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /\.route-map\s*\{[^}]*-webkit-touch-callout:\s*none/s);
  assert.match(css, /\.route-map:focus-visible\s*\{[^}]*outline:\s*3px/s);
  assert.match(css, /\.route-zoom button\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/s);
  assert.match(css, /\.journey-active \.route-map, \.journey-arrived \.route-map\s*\{[^}]*cursor:\s*grab/s);
});

test("place search and long-press confirmation stay legible in normal and sunlight modes", () => {
  assert.match(css, /\.route-place-search form\s*\{[^}]*min-height:\s*42px/s);
  assert.match(css, /\.route-place-results\s*\{[^}]*max-height:\s*min\(48svh,340px\)[^}]*overflow:\s*auto/s);
  assert.match(css, /\.route-long-press-hint\s*\{[^}]*background:\s*rgba\(8,28,32,.8\)[^}]*font-weight:\s*750/s);
  assert.match(css, /\.route-long-press-hint\.active span\s*\{[^}]*long-press-fill/s);
  assert.match(css, /\.sunlight-mode \.route-place-results\s*\{[^}]*background:\s*rgba\(250,255,253,.98\)/s);
});

test("danger, course, and speed states retain visible motion with a reduced-motion fallback", () => {
  assert.match(css, /\.course-danger \.proximity-ring\s*\{[^}]*ring-breathe/s);
  assert.match(css, /\.course-danger \.course-line\s*\{[^}]*course-flow/s);
  assert.match(css, /\.speed-danger \.danger-ring-arc\s*\{[^}]*arc-pulse/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*\.01ms/s);
});

test("tracking view is locked to one viewport while launch settings remain scrollable", () => {
  assert.match(css, /\.is-tracking\s*\{[^}]*height:\s*100svh/s);
  assert.match(css, /\.is-tracking\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.tracker\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.tracker-content\s*\{[^}]*flex:\s*1/s);
  assert.match(css, /\.tracker-content\s*\{[^}]*overflow:\s*hidden/s);
});

test("route map hatches all land while keeping coastline and route solid", () => {
  assert.match(css, /\.route-land-area\s*\{[^}]*fill:\s*url\(#routeLandHatch\)/s);
  assert.match(css, /\.route-land-area\s*\{[^}]*shape-rendering:\s*crispEdges/s);
  assert.match(css, /\.route-land-fill-mark\s*\{[^}]*fill:\s*#c8c4aa/s);
  assert.match(css, /\.route-land-hatch-mark\s*\{[^}]*stroke:\s*var\(--shore-stroke\)[^}]*opacity:\s*\.25/s);
  const depthTile = css.match(/\.route-depth-tile\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(depthTile, /filter:\s*none/);
  assert.match(depthTile, /image-rendering:\s*auto/);
  assert.doesNotMatch(depthTile, /grayscale|invert|hue-rotate/);
  const routeCoast = css.match(/\.route-coast-layer line\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(routeCoast, /stroke:\s*var\(--shore-stroke\)/);
  assert.doesNotMatch(routeCoast, /stroke-dasharray/);
  assert.match(css, /\.planned-route\s*\{[^}]*stroke:\s*var\(--aqua\)/s);
  assert.match(css, /\.planned-route\.restricted\s*\{[^}]*stroke:\s*var\(--danger\)/s);
  assert.match(css, /\.route-water\s*\{[^}]*fill:\s*#85bac8/s);
  assert.match(css, /\.land-fill-mark\s*\{[^}]*fill:\s*#415353/s);
  assert.match(css, /\.map-feature-label text\s*\{[^}]*paint-order:\s*stroke/s);
  assert.match(css, /\.map-feature-label\.restaurant circle\s*\{[^}]*var\(--amber\)/s);
});

test("anchor timer and debug panel remain compact and readable", () => {
  assert.match(css, /\.anchor-timer-chip\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(css, /\.anchor-timer-chip\.active\s*\{[^}]*background:/s);
  assert.match(css, /\.debug-panel pre\s*\{[^}]*max-height:\s*42svh[^}]*overflow:\s*auto/s);
  assert.match(css, /\.debug-panel\s*\{[^}]*position:\s*relative[^}]*width:\s*30px/s);
  assert.match(css, /\.debug-panel\[open\]\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.power-save-go\.no-go\s*\{[^}]*#a83229/s);
});
