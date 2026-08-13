import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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

test("tracking instrument is borderless and coast uses a readable stroke", () => {
  assert.match(css, /\.instrument\s*\{[^}]*border-radius:\s*0;/s);
  assert.match(css, /\.instrument\s*\{[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.shore-segment\s*\{[^}]*stroke-width:\s*3;/s);
});
