import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPhotonPlaceSearchUrl,
  fuzzyPlaceScore,
  formatPlaceSearchDetail,
  mergePlaceSearchResults,
  normalizePlaceSearchText,
  parsePhotonPlaceSearchPayload,
  searchLocalCroatianPlaces,
} from "../lib/place-search.ts";

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
