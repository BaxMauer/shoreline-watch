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

test("land is hatched, clipped to the plot, and painted as one background path", () => {
  assert.match(app, /<pattern id="landHatch"[^>]*>[\s\S]*className="land-hatch-mark"/);
  assert.match(app, /<clipPath id="plotClip"><circle[^>]*r="166"/);
  assert.match(app, /className="land-hatch-layer"[^>]*clipPath="url\(#plotClip\)"/);
  assert.match(app, /landHatchPath && <path className="land-hatch-area" d=\{landHatchPath\}/);
  assert.match(css, /\.land-hatch-area\s*\{[^}]*fill:\s*url\(#landHatch\)/s);
  assert.match(css, /\.land-hatch-mark\s*\{[^}]*stroke:\s*var\(--shore-stroke\)/s);
  assert.match(app, /getLandIntervalsAtLatitude\(pack, latitude, minimumLongitude, maximumLongitude\)/);
  assert.match(app, /const bandHeight = 4/);
  assert.doesNotMatch(app, /getLandHatchPolygon/);
  assert.equal((app.match(/className="land-hatch-area"/g) ?? []).length, 1);
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

test("distance digits cannot collide on a narrow phone", () => {
  assert.match(css, /\.distance-readout strong\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
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
  assert.match(css, /\.course-alert\s*\{[^}]*min-height:\s*76px/s);
  assert.match(css, /\.visual-signal-card strong\s*\{[^}]*font-size:\s*1\.28rem/s);
  assert.match(css, /\.theme-xp \.go-no-go\.no-go, \.theme-nautical \.go-no-go\.no-go, \.sunlight-mode \.go-no-go\.no-go\s*\{[^}]*#9f2d23[^}]*#fff/s);
  assert.match(css, /\.theme-xp \.go-no-go\.go, \.theme-nautical \.go-no-go\.go, \.sunlight-mode \.go-no-go\.go\s*\{[^}]*#006b54[^}]*#fff/s);
  assert.match(css, /\.current-depth-chip\s*\{[^}]*min-height:\s*36px[^}]*font-variant-numeric:\s*tabular-nums/s);
});

test("active route view exposes compact live shoreline and depth readouts", () => {
  assert.match(css, /\.route-live-readouts\s*\{[^}]*position:\s*absolute[^}]*display:\s*flex/s);
  assert.match(css, /\.route-live-readouts > span\s*\{[^}]*min-height:\s*48px/s);
  assert.match(css, /\.route-live-readouts > span\.ready strong\s*\{[^}]*#9ff5dd/s);
});

test("route map declares touch panning and strong focus affordances", () => {
  assert.match(css, /\.route-map\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /\.route-map:focus-visible\s*\{[^}]*outline:\s*3px/s);
  assert.match(css, /\.route-zoom button\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/s);
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

test("route map keeps land smooth, coastline solid, and route visually separate", () => {
  assert.match(css, /\.route-land-area\s*\{[^}]*fill:\s*#[0-9a-f]{6}/s);
  assert.match(css, /\.route-depth-tile\s*\{[^}]*image-rendering:\s*auto/s);
  const routeCoast = css.match(/\.route-coast-layer line\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(routeCoast, /stroke:\s*var\(--shore-stroke\)/);
  assert.doesNotMatch(routeCoast, /stroke-dasharray/);
  assert.match(css, /\.planned-route\s*\{[^}]*stroke:\s*var\(--aqua\)/s);
  assert.match(css, /\.planned-route\.restricted\s*\{[^}]*stroke:\s*var\(--danger\)/s);
});
