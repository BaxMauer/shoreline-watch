import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFLINE_BATHYMETRY_CACHE,
  OFFLINE_PACKAGES,
  buildOfflinePackageTiles,
  packageContainsPoint,
  parseInstalledOfflinePackages,
} from "../lib/offline-packages.ts";

test("offline packages cover four distinct Croatian boating regions", () => {
  assert.equal(OFFLINE_PACKAGES.length, 4);
  assert.equal(new Set(OFFLINE_PACKAGES.map((pack) => pack.id)).size, 4);
  assert.match(OFFLINE_BATHYMETRY_CACHE, /^shoreline-watch-offline-/);
});

test("offline packages generate bounded unique EMODnet tiles for zooms 8 through 14", () => {
  for (const pack of OFFLINE_PACKAGES) {
    const tiles = buildOfflinePackageTiles(pack);
    assert.ok(tiles.length > 100 && tiles.length < 1_100, `${pack.id}: ${tiles.length}`);
    assert.equal(new Set(tiles.map((tile) => tile.key)).size, tiles.length);
    assert.ok(tiles.every((tile) => /^https:\/\/tiles\.emodnet-bathymetry\.eu\/2020\/baselayer\/web_mercator\/(?:8|9|10|11|12|13|14)\//.test(tile.url)));
  }
});

test("installed package state ignores malformed, duplicate, and unknown ids", () => {
  assert.deepEqual(parseInstalledOfflinePackages(null), []);
  assert.deepEqual(parseInstalledOfflinePackages("not json"), []);
  assert.deepEqual(parseInstalledOfflinePackages('["murter","unknown","murter"]'), ["murter"]);
});

test("package bounds identify fixes inside and outside a region", () => {
  const murter = OFFLINE_PACKAGES.find((pack) => pack.id === "murter");
  assert.ok(murter);
  assert.equal(packageContainsPoint(murter, { latitude: 43.8, longitude: 15.55 }), true);
  assert.equal(packageContainsPoint(murter, { latitude: 45, longitude: 16 }), false);
});
