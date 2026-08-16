import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  getMapFeaturesInView,
  getAnchorPlace,
  placeMapFeatureLabels,
  searchCroatianMapFeatures,
} from "../lib/map-features.ts";

const catalog = JSON.parse(await readFile(new URL("../public/data/croatia-map-features.json", import.meta.url), "utf8"));

test("offline OSM catalog covers all requested Croatian feature classes", () => {
  assert.equal(catalog.version, 1);
  assert.equal(catalog.license, "https://www.openstreetmap.org/copyright");
  assert.ok(catalog.stats.island >= 1_000);
  assert.ok(catalog.stats.restaurant >= 5_000);
  assert.ok(catalog.stats.settlement >= 1_000);
  assert.ok(Object.keys(catalog.cells).length > 500);
  const islands = new Set(catalog.features.filter((feature) => feature.kind === "island").map((feature) => feature.name));
  for (const name of ["Žut", "Krapanj", "Vele Srakane", "Murter"]) assert.ok(islands.has(name), `missing island ${name}`);
});

test("anchor place lookup adds nearby bay and island names", () => {
  const place = getAnchorPlace(catalog, { latitude: 43.8826, longitude: 15.2849 });
  assert.equal(typeof place, "object");
  assert.ok(place.bayName || place.islandName);
});

test("catalog search handles Croatian diacritics and transposed characters", () => {
  assert.equal(searchCroatianMapFeatures(catalog, "Zut")[0]?.name, "Žut");
  assert.equal(searchCroatianMapFeatures(catalog, "Krapnaj")[0]?.name, "Krapanj");
  assert.equal(searchCroatianMapFeatures(catalog, "Vele Srakane")[0]?.kind, "island");
});

test("spatial lookup uses the cell index and zoom gates restaurant clutter", () => {
  const centre = { latitude: 43.8826, longitude: 15.2849 };
  const close = getMapFeaturesInView(catalog, centre, 2_000);
  assert.ok(close.some((feature) => feature.kind === "restaurant"));
  const wide = getMapFeaturesInView(catalog, centre, 40_000);
  assert.ok(wide.some((feature) => feature.kind === "island"));
  assert.equal(wide.some((feature) => feature.kind === "restaurant"), false);
});

test("label placement is deterministic, bounded, and prioritizes islands", () => {
  const features = [
    { id: "restaurant", name: "Restaurant", aliases: [], kind: "restaurant", subtype: "restaurant", latitude: 1, longitude: 1 },
    { id: "island", name: "Island", aliases: [], kind: "island", subtype: "island", latitude: 1, longitude: 1 },
    { id: "village", name: "Village", aliases: [], kind: "settlement", subtype: "village", latitude: 2, longitude: 2 },
  ];
  const project = (feature) => feature.id === "village" ? { x: 80, y: 80 } : { x: 50, y: 50 };
  const first = placeMapFeatureLabels(features, project, 100, 2);
  const second = placeMapFeatureLabels(features, project, 100, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(({ id }) => id), ["island", "village"]);
});
