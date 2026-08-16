import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function cssBlock(selector, offset = 0) {
  const start = css.indexOf(selector, offset);
  assert.ok(start >= 0, `Missing CSS selector ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  assert.ok(open >= 0 && close > open, `Malformed CSS selector ${selector}`);
  return css.slice(open + 1, close);
}

const tabletMedia = css.indexOf("@media (min-width: 600px) and (max-width: 1199px)");
const landscapeMedia = css.indexOf("@media (min-width: 600px) and (max-width: 1199px) and (orientation: landscape)");

test("tablet tracking uses the complete viewport width instead of the phone cap", () => {
  assert.ok(tabletMedia >= 0);
  assert.match(cssBlock(".app-shell.is-tracking", tabletMedia), /width:\s*100%/);
  const trackingWidth = cssBlock(".is-tracking .tracker, .is-tracking .topbar", tabletMedia);
  assert.match(trackingWidth, /width:\s*100%/);
  assert.match(trackingWidth, /max-width:\s*none/);
});

test("tablet distance view gives the full instrument height to the map", () => {
  assert.match(cssBlock(".instrument {", tabletMedia), /grid-template-rows:\s*minmax\(0, 1fr\)/);
  assert.match(cssBlock(".map-stage", tabletMedia), /height:\s*100%/);
  assert.match(cssBlock(".map-stage", tabletMedia), /grid-row:\s*1/);
  assert.match(cssBlock(".instrument-summary", tabletMedia), /position:\s*absolute/);
  assert.match(cssBlock(".instrument-footer", tabletMedia), /position:\s*absolute/);
  assert.match(cssBlock(".distance-map-overlay", tabletMedia), /padding:\s*106px 18px 78px/);
});

test("portrait tablet navigation grows the map between compact controls", () => {
  const journey = cssBlock(".journey-active, .journey-arrived", tabletMedia);
  assert.match(journey, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(journey, /"map"/);
  assert.match(journey, /overflow:\s*hidden/);

  const map = cssBlock(".journey-active .route-map-wrap, .journey-arrived .route-map-wrap", tabletMedia);
  assert.match(map, /max-width:\s*none/);
  assert.match(map, /height:\s*100%/);
  assert.match(map, /grid-area:\s*map/);
  assert.match(map, /aspect-ratio:\s*auto/);
});

test("landscape tablet navigation keeps map overlays compact", () => {
  assert.ok(landscapeMedia > tabletMedia);
  assert.match(cssBlock(".journey-active .route-map-wrap, .journey-arrived .route-map-wrap", landscapeMedia), /min-height:\s*0/);
  assert.match(cssBlock(".route-live-map-overlay", landscapeMedia), /padding:\s*14px 18px 12px/);
  assert.match(cssBlock(".route-live-map-overlay > .route-live-distance", landscapeMedia), /width:\s*min\(48%, 320px\)/);
});
