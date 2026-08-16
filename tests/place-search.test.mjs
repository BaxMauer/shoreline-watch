import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PLACE_TARGET_WATER_OFFSET_METRES,
  buildPhotonPlaceSearchUrl,
  fuzzyPlaceScore,
  formatPlaceSearchDetail,
  mergePlaceSearchResults,
  normalizePlaceSearchText,
  parsePhotonPlaceSearchPayload,
  resolvePlaceSearchTarget,
  searchLocalCroatianPlaces,
} from "../lib/place-search.ts";
import { findNearestShore, isPointOnLand } from "../lib/shoreline.ts";
import { geoDistanceMetres, planWaterRoute } from "../lib/route-planning.ts";

test("Croatian diacritics and common misspellings match locally", () => {
  assert.equal(normalizePlaceSearchText("  Pakoštane  "), "pakostane");
  assert.equal(searchLocalCroatianPlaces("Pakostnae")[0]?.name, "Pakoštane");
  assert.equal(searchLocalCroatianPlaces("Sibenk")[0]?.name, "Šibenik");
  assert.equal(searchLocalCroatianPlaces("Telascica")[0]?.name, "Telašćica");
  assert.ok(fuzzyPlaceScore("Murta", "Murter") < .46);
});

test("Photon search is bounded to Croatia and keeps the requested language", () => {
  const url = new URL(buildPhotonPlaceSearchUrl("Dugi otok", "de"));
  assert.equal(url.origin, "https://photon.komoot.io");
  assert.equal(url.pathname, "/api/");
  assert.equal(url.searchParams.get("q"), "Dugi otok");
  assert.equal(url.searchParams.get("lang"), "de");
  assert.equal(url.searchParams.get("bbox"), "13.2,42.2,19.6,46.7");
  assert.equal(url.searchParams.get("limit"), "12");
});

test("Photon results retain Croatian towns, bays, and islands inside the coastal bounds", () => {
  const results = parsePhotonPlaceSearchPayload({ features: [
    { geometry: { coordinates: [15.59, 43.82] }, properties: { name: "Murter", osm_type: "R", osm_id: 1, osm_value: "island", state: "Šibenik-Knin", country: "Hrvatska" } },
    { geometry: { coordinates: [15.17, 43.89] }, properties: { name: "Telašćica", osm_type: "W", osm_id: 2, osm_value: "bay", country: "Hrvatska" } },
    { geometry: { coordinates: [10, 50] }, properties: { name: "Outside", osm_id: 3 } },
    { geometry: { coordinates: [15.5, 43.8] }, properties: {} },
  ] });
  assert.deepEqual(results.map(({ name, kind }) => [name, kind]), [["Murter", "island"], ["Telašćica", "bay"]]);
});

test("local and online place results are deduplicated and fuzzy-ranked", () => {
  const local = searchLocalCroatianPlaces("Pakostnae");
  const online = [{ ...local[0], id: "osm-duplicate", source: "osm" }, { id: "osm-zadar", name: "Zadar", detail: "Kroatien", kind: "place", latitude: 44.119, longitude: 15.231, source: "osm" }];
  const merged = mergePlaceSearchResults("Pakostnae", local, online);
  assert.equal(merged[0]?.name, "Pakoštane");
  assert.equal(merged.filter((result) => result.name === "Pakoštane").length, 1);
});

test("place details do not repeat the result category", () => {
  const result = searchLocalCroatianPlaces("Pakostane")[0];
  assert.equal(formatPlaceSearchDetail(result, "de"), "Ort · Zadar");
  assert.equal(formatPlaceSearchDetail(result, "en"), "Place · Zadar");
});

test("an island search result resolves to nearby water instead of its land centroid", async () => {
  const coastline = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const result = { latitude: 43.830668, longitude: 15.515315 };
  assert.equal(isPointOnLand(coastline, result.longitude, result.latitude), true, "Murvenjak centroid must reproduce the reported failure");
  const originalShore = findNearestShore(coastline, result.longitude, result.latitude);

  const target = resolvePlaceSearchTarget(coastline, result);
  const shore = findNearestShore(coastline, target.longitude, target.latitude);
  assert.equal(isPointOnLand(coastline, target.longitude, target.latitude), false);
  assert.ok(shore && shore.distance >= 2);
  assert.ok(shore && shore.distance <= PLACE_TARGET_WATER_OFFSET_METRES + 2);
  assert.ok(originalShore && geoDistanceMetres(result, target) <= originalShore.distance + PLACE_TARGET_WATER_OFFSET_METRES + 1);

  const route = planWaterRoute(coastline, { longitude: 15.5, latitude: 43.82 }, target, {
    clearanceMetres: 300,
    cruiseSpeedKnots: 16,
    speedWarningEnabled: true,
    nearShoreSpeedKnots: 8,
  });
  assert.ok(route.route, route.failure);
});

test("a route start on land is moved to the nearest navigable sea point", async () => {
  const coastline = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const requestedStart = { latitude: 43.830668, longitude: 15.515315 };
  const destination = { latitude: 43.82, longitude: 15.5 };
  const originalShore = findNearestShore(coastline, requestedStart.longitude, requestedStart.latitude);
  assert.equal(isPointOnLand(coastline, requestedStart.longitude, requestedStart.latitude), true);

  const start = resolvePlaceSearchTarget(coastline, requestedStart, undefined, destination);
  assert.equal(isPointOnLand(coastline, start.longitude, start.latitude), false);
  assert.ok(originalShore && geoDistanceMetres(requestedStart, start) <= originalShore.distance + PLACE_TARGET_WATER_OFFSET_METRES + 3);

  const result = planWaterRoute(coastline, start, destination, {
    clearanceMetres: 300,
    cruiseSpeedKnots: 16,
    speedWarningEnabled: true,
    nearShoreSpeedKnots: 8,
  });
  assert.ok(result.route, result.failure);
  assert.deepEqual(result.route.points[0], start);
});

test("an island target uses the water-facing side nearest the route start", async () => {
  const coastline = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const ljutac = { latitude: 43.789751, longitude: 15.659253 };
  const start = { latitude: 43.7902, longitude: 15.6596 };
  const target = resolvePlaceSearchTarget(coastline, ljutac, undefined, start);

  assert.equal(isPointOnLand(coastline, target.longitude, target.latitude), false);
  assert.ok(geoDistanceMetres(start, target) < geoDistanceMetres(start, ljutac));
  const result = planWaterRoute(coastline, start, target, {
    clearanceMetres: 300,
    cruiseSpeedKnots: 16,
    speedWarningEnabled: true,
    nearShoreSpeedKnots: 8,
  });
  assert.ok(result.route, result.failure);
});

test("an inland-water target is moved to reachable coastal water", async () => {
  const coastline = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  const start = { latitude: 43.6901, longitude: 15.6916 };
  const vranskoLake = { latitude: 43.8066, longitude: 15.8748 };
  assert.equal(isPointOnLand(coastline, vranskoLake.longitude, vranskoLake.latitude), false, "the regression point must remain classified as water");

  const target = resolvePlaceSearchTarget(coastline, vranskoLake, undefined, start);
  assert.equal(isPointOnLand(coastline, target.longitude, target.latitude), false);
  assert.ok(geoDistanceMetres(vranskoLake, target) > 5_000, "the target must leave the isolated lake");
  assert.ok(target.longitude < 15.8, "the target must move to the Adriatic side of the mainland");

  const result = planWaterRoute(coastline, start, target, {
    clearanceMetres: 300,
    cruiseSpeedKnots: 16,
    speedWarningEnabled: true,
    nearShoreSpeedKnots: 8,
  });
  assert.ok(result.route, result.failure);
});
