import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFLINE_BATHYMETRY_CACHE,
  OFFLINE_PACKAGES,
  buildOfflinePackageTiles,
  downloadOfflinePackage,
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

test("offline package downloads resume by reusing tiles already in Cache Storage", async (context) => {
  const pack = {
    id: "test",
    nameDe: "Test",
    nameEn: "Test",
    detailDe: "Test",
    detailEn: "Test",
    bounds: { north: 43.8, east: 15.55, south: 43.8, west: 15.55 },
  };
  const tiles = buildOfflinePackageTiles(pack);
  const cachedUrl = tiles[0].url;
  const stored = [];
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { open: async () => ({
    match: async (request) => request.url === cachedUrl ? new Response("cached") : undefined,
    put: async (request) => stored.push(request.url),
  }) } });
  context.after(() => {
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else delete globalThis.caches;
  });
  let networkRequests = 0;
  context.mock.method(globalThis, "fetch", async () => {
    networkRequests += 1;
    return new Response("tile");
  });
  let progress = [0, 0];

  const total = await downloadOfflinePackage(pack, (completed, nextTotal) => { progress = [completed, nextTotal]; });

  assert.equal(total, tiles.length);
  assert.equal(networkRequests, tiles.length - 1);
  assert.equal(stored.length, tiles.length - 1);
  assert.deepEqual(progress, [tiles.length, tiles.length]);
});
