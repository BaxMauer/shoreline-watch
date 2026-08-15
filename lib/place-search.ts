import type { GeoPoint } from "./route-planning.ts";
import {
  findNearestShore,
  isPointOnLand,
  offsetFromShore,
  type CoastlinePack,
} from "./shoreline.ts";

export type PlaceKind = "place" | "bay" | "island";
export type PlaceSearchResult = GeoPoint & {
  id: string;
  name: string;
  detail: string;
  kind: PlaceKind;
  source: "local" | "osm";
  aliases?: string[];
};

export const CROATIA_SEARCH_BOUNDS = {
  west: 13.2,
  south: 42.2,
  east: 19.6,
  north: 46.7,
} as const;

export const PLACE_TARGET_WATER_OFFSET_METRES = 8;

function pointAtDistance(origin: GeoPoint, bearing: number, distanceMetres: number): GeoPoint {
  const radians = bearing * Math.PI / 180;
  const longitudeScale = 111_320 * Math.max(.1, Math.cos(origin.latitude * Math.PI / 180));
  return {
    longitude: origin.longitude + Math.sin(radians) * distanceMetres / longitudeScale,
    latitude: origin.latitude + Math.cos(radians) * distanceMetres / 110_540,
  };
}

function bearingBetween(origin: GeoPoint, destination: GeoPoint) {
  const longitudeScale = 111_320 * Math.max(.1, Math.cos((origin.latitude + destination.latitude) / 2 * Math.PI / 180));
  const east = (destination.longitude - origin.longitude) * longitudeScale;
  const north = (destination.latitude - origin.latitude) * 110_540;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function waterLooksEnclosed(pack: CoastlinePack, origin: GeoPoint) {
  const bearings = Array.from({ length: 24 }, (_, index) => index * 15);
  return bearings.every((bearing) => {
    for (let distance = 150; distance <= 6_000; distance += 150) {
      const sample = pointAtDistance(origin, bearing, distance);
      if (isPointOnLand(pack, sample.longitude, sample.latitude)) return true;
    }
    return false;
  });
}

function findWaterBeyondLand(
  pack: CoastlinePack,
  origin: GeoPoint,
  destination: GeoPoint,
  waterOffsetMetres: number,
) {
  const bearing = bearingBetween(origin, destination);
  const longitudeScale = 111_320 * Math.max(.1, Math.cos((origin.latitude + destination.latitude) / 2 * Math.PI / 180));
  const maximumDistance = Math.min(50_000, Math.hypot(
    (destination.longitude - origin.longitude) * longitudeScale,
    (destination.latitude - origin.latitude) * 110_540,
  ));
  let crossedLand = false;
  let lastLandDistance = 0;
  for (let distance = 20; distance <= maximumDistance; distance += 20) {
    const sample = pointAtDistance(origin, bearing, distance);
    if (isPointOnLand(pack, sample.longitude, sample.latitude)) {
      crossedLand = true;
      lastLandDistance = distance;
      continue;
    }
    if (!crossedLand) continue;

    let landDistance = lastLandDistance;
    let waterDistance = distance;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const middle = (landDistance + waterDistance) / 2;
      const candidate = pointAtDistance(origin, bearing, middle);
      if (isPointOnLand(pack, candidate.longitude, candidate.latitude)) landDistance = middle;
      else waterDistance = middle;
    }
    return pointAtDistance(origin, bearing, waterDistance + waterOffsetMetres);
  }
  return null;
}

function findOpenWaterTowards(pack: CoastlinePack, origin: GeoPoint, destination: GeoPoint, waterOffsetMetres: number) {
  let cursor = origin;
  for (let transition = 0; transition < 8; transition += 1) {
    const candidate = findWaterBeyondLand(pack, cursor, destination, waterOffsetMetres);
    if (!candidate) return null;
    if (!waterLooksEnclosed(pack, candidate)) return candidate;
    cursor = candidate;
  }
  return null;
}

function findWaterTowards(
  pack: CoastlinePack,
  origin: GeoPoint,
  destination: GeoPoint,
  waterOffsetMetres: number,
) {
  const bearing = bearingBetween(origin, destination);
  const stepMetres = 20;
  let lastLandDistance = 0;

  for (let distance = stepMetres; distance <= 30_000; distance += stepMetres) {
    const sample = pointAtDistance(origin, bearing, distance);
    if (isPointOnLand(pack, sample.longitude, sample.latitude)) {
      lastLandDistance = distance;
      continue;
    }

    let landDistance = lastLandDistance;
    let waterDistance = distance;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const middle = (landDistance + waterDistance) / 2;
      const candidate = pointAtDistance(origin, bearing, middle);
      if (isPointOnLand(pack, candidate.longitude, candidate.latitude)) landDistance = middle;
      else waterDistance = middle;
    }

    for (let offset = waterOffsetMetres; offset >= 4; offset /= 2) {
      const candidate = pointAtDistance(origin, bearing, waterDistance + offset);
      if (!isPointOnLand(pack, candidate.longitude, candidate.latitude)) return candidate;
    }
    return sample;
  }
  return null;
}

export function resolvePlaceSearchTarget(
  pack: CoastlinePack | null,
  result: Pick<PlaceSearchResult, "latitude" | "longitude">,
  waterOffsetMetres = PLACE_TARGET_WATER_OFFSET_METRES,
  approachFrom?: GeoPoint | null,
): GeoPoint {
  const original = { latitude: result.latitude, longitude: result.longitude };
  if (!pack) return original;

  const offset = Math.max(4, Math.min(40, waterOffsetMetres));
  const originalOnLand = isPointOnLand(pack, original.longitude, original.latitude);
  if (!originalOnLand) {
    if (!approachFrom || !waterLooksEnclosed(pack, original)) return original;
    return findOpenWaterTowards(pack, original, approachFrom, offset) ?? original;
  }

  if (approachFrom) {
    const approachTarget = findWaterTowards(pack, original, approachFrom, offset);
    if (approachTarget && !waterLooksEnclosed(pack, approachTarget)) return approachTarget;
    if (approachTarget) return findOpenWaterTowards(pack, approachTarget, approachFrom, offset) ?? approachTarget;
  }

  const shore = findNearestShore(pack, original.longitude, original.latitude);
  if (!shore) return original;

  const distances = [offset, offset * 2, offset * 4, 50, 100];
  const bearingOffsets = Array.from({ length: 36 }, (_, index) => {
    if (index === 0) return 0;
    const step = Math.ceil(index / 2) * 10;
    return index % 2 === 1 ? -step : step;
  });

  for (const distance of [...new Set(distances)]) {
    for (const bearingOffset of bearingOffsets) {
      const candidate = offsetFromShore(shore, shore.bearing + bearingOffset, distance);
      if (!isPointOnLand(pack, candidate.longitude, candidate.latitude)) return candidate;
    }
  }
  return original;
}

const COASTAL_PLACES: PlaceSearchResult[] = [
  { id: "local-pakostane", name: "Pakoštane", aliases: ["Pakostane"], detail: "Ort · Zadar", kind: "place", latitude: 43.8197, longitude: 15.5086, source: "local" },
  { id: "local-biograd", name: "Biograd na Moru", aliases: ["Biograd"], detail: "Ort · Zadar", kind: "place", latitude: 43.9372, longitude: 15.4411, source: "local" },
  { id: "local-murter", name: "Murter", detail: "Ort und Insel · Šibenik-Knin", kind: "island", latitude: 43.8204, longitude: 15.5899, source: "local" },
  { id: "local-tisno", name: "Tisno", detail: "Ort · Šibenik-Knin", kind: "place", latitude: 43.8041, longitude: 15.6435, source: "local" },
  { id: "local-betina", name: "Betina", detail: "Ort · Insel Murter", kind: "place", latitude: 43.8232, longitude: 15.6072, source: "local" },
  { id: "local-jezera", name: "Jezera", detail: "Ort · Insel Murter", kind: "place", latitude: 43.7855, longitude: 15.6434, source: "local" },
  { id: "local-vodice", name: "Vodice", detail: "Ort · Šibenik-Knin", kind: "place", latitude: 43.7608, longitude: 15.7782, source: "local" },
  { id: "local-tribunj", name: "Tribunj", detail: "Ort · Šibenik-Knin", kind: "place", latitude: 43.7555, longitude: 15.7441, source: "local" },
  { id: "local-sibenik", name: "Šibenik", aliases: ["Sibenik"], detail: "Stadt · Šibenik-Knin", kind: "place", latitude: 43.735, longitude: 15.8952, source: "local" },
  { id: "local-primosten", name: "Primošten", aliases: ["Primosten"], detail: "Ort · Šibenik-Knin", kind: "place", latitude: 43.5863, longitude: 15.923, source: "local" },
  { id: "local-zadar", name: "Zadar", detail: "Stadt · Dalmatien", kind: "place", latitude: 44.1194, longitude: 15.2314, source: "local" },
  { id: "local-split", name: "Split", detail: "Stadt · Dalmatien", kind: "place", latitude: 43.5081, longitude: 16.4402, source: "local" },
  { id: "local-dubrovnik", name: "Dubrovnik", detail: "Stadt · Süddalmatien", kind: "place", latitude: 42.6507, longitude: 18.0944, source: "local" },
  { id: "local-pula", name: "Pula", detail: "Stadt · Istrien", kind: "place", latitude: 44.8666, longitude: 13.8496, source: "local" },
  { id: "local-rovinj", name: "Rovinj", detail: "Stadt · Istrien", kind: "place", latitude: 45.0812, longitude: 13.6387, source: "local" },
  { id: "local-rijeka", name: "Rijeka", detail: "Stadt · Kvarner", kind: "place", latitude: 45.3271, longitude: 14.4422, source: "local" },
  { id: "local-kornati", name: "Kornati", aliases: ["Kornaten"], detail: "Inselgruppe · Dalmatien", kind: "island", latitude: 43.797, longitude: 15.336, source: "local" },
  { id: "local-pasman", name: "Pašman", aliases: ["Pasman"], detail: "Insel · Zadar", kind: "island", latitude: 43.957, longitude: 15.386, source: "local" },
  { id: "local-ugljan", name: "Ugljan", detail: "Insel · Zadar", kind: "island", latitude: 44.078, longitude: 15.174, source: "local" },
  { id: "local-dugi-otok", name: "Dugi Otok", detail: "Insel · Zadar", kind: "island", latitude: 44.025, longitude: 14.997, source: "local" },
  { id: "local-pag", name: "Pag", detail: "Insel · Kvarner", kind: "island", latitude: 44.466, longitude: 15.03, source: "local" },
  { id: "local-rab", name: "Rab", detail: "Insel · Kvarner", kind: "island", latitude: 44.756, longitude: 14.759, source: "local" },
  { id: "local-krk", name: "Krk", detail: "Insel · Kvarner", kind: "island", latitude: 45.079, longitude: 14.6, source: "local" },
  { id: "local-cres", name: "Cres", detail: "Insel · Kvarner", kind: "island", latitude: 44.84, longitude: 14.408, source: "local" },
  { id: "local-losinj", name: "Lošinj", aliases: ["Losinj"], detail: "Insel · Kvarner", kind: "island", latitude: 44.586, longitude: 14.398, source: "local" },
  { id: "local-brac", name: "Brač", aliases: ["Brac"], detail: "Insel · Dalmatien", kind: "island", latitude: 43.322, longitude: 16.635, source: "local" },
  { id: "local-hvar", name: "Hvar", detail: "Insel · Dalmatien", kind: "island", latitude: 43.143, longitude: 16.734, source: "local" },
  { id: "local-vis", name: "Vis", detail: "Insel · Dalmatien", kind: "island", latitude: 43.045, longitude: 16.179, source: "local" },
  { id: "local-korcula", name: "Korčula", aliases: ["Korcula"], detail: "Insel · Dalmatien", kind: "island", latitude: 42.95, longitude: 16.95, source: "local" },
  { id: "local-mljet", name: "Mljet", detail: "Insel · Süddalmatien", kind: "island", latitude: 42.742, longitude: 17.54, source: "local" },
  { id: "local-lastovo", name: "Lastovo", detail: "Insel · Süddalmatien", kind: "island", latitude: 42.746, longitude: 16.88, source: "local" },
  { id: "local-telascica", name: "Telašćica", aliases: ["Telascica"], detail: "Bucht · Dugi Otok", kind: "bay", latitude: 43.89, longitude: 15.17, source: "local" },
  { id: "local-sakarun", name: "Sakarun", aliases: ["Saharun"], detail: "Bucht · Dugi Otok", kind: "bay", latitude: 44.133, longitude: 14.872, source: "local" },
  { id: "local-kosirina", name: "Kosirina", detail: "Bucht · Murter", kind: "bay", latitude: 43.799, longitude: 15.601, source: "local" },
  { id: "local-slanica", name: "Slanica", detail: "Bucht · Murter", kind: "bay", latitude: 43.819, longitude: 15.574, source: "local" },
  { id: "local-cikat", name: "Čikat", aliases: ["Cikat"], detail: "Bucht · Lošinj", kind: "bay", latitude: 44.53, longitude: 14.45, source: "local" },
  { id: "local-stiniva", name: "Stiniva", detail: "Bucht · Vis", kind: "bay", latitude: 43.022, longitude: 16.17, source: "local" },
];

export function normalizePlaceSearchText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("hr")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function damerauLevenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const rows = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let row = 0; row <= left.length; row += 1) rows[row][0] = row;
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost,
      );
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

export function fuzzyPlaceScore(query: string, candidate: string) {
  const normalizedQuery = normalizePlaceSearchText(query);
  const normalizedCandidate = normalizePlaceSearchText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return Number.POSITIVE_INFINITY;
  if (normalizedCandidate === normalizedQuery) return 0;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 0.05 + (normalizedCandidate.length - normalizedQuery.length) / 200;
  if (normalizedCandidate.includes(normalizedQuery)) return 0.14 + (normalizedCandidate.length - normalizedQuery.length) / 200;
  return damerauLevenshtein(normalizedQuery, normalizedCandidate) / Math.max(normalizedQuery.length, normalizedCandidate.length);
}

function resultScore(query: string, result: PlaceSearchResult) {
  return Math.min(...[result.name, ...(result.aliases ?? [])].map((candidate) => fuzzyPlaceScore(query, candidate)));
}

export function searchLocalCroatianPlaces(query: string, limit = 6) {
  if (normalizePlaceSearchText(query).length < 2) return [];
  return COASTAL_PLACES
    .map((result) => ({ result, score: resultScore(query, result) }))
    .filter(({ score }) => score <= 0.46)
    .sort((left, right) => left.score - right.score || left.result.name.localeCompare(right.result.name, "hr"))
    .slice(0, limit)
    .map(({ result }) => result);
}

export function mergePlaceSearchResults(query: string, ...groups: PlaceSearchResult[][]) {
  const unique = new Map<string, PlaceSearchResult>();
  for (const result of groups.flat()) {
    const key = `${normalizePlaceSearchText(result.name)}:${result.latitude.toFixed(3)}:${result.longitude.toFixed(3)}`;
    if (!unique.has(key) || result.source === "local") unique.set(key, result);
  }
  return [...unique.values()]
    .map((result) => ({ result, score: resultScore(query, result) }))
    .sort((left, right) => left.score - right.score || Number(left.result.source === "osm") - Number(right.result.source === "osm"))
    .slice(0, 8)
    .map(({ result }) => result);
}

export function formatPlaceSearchDetail(result: PlaceSearchResult, language: "de" | "en") {
  const kind = language === "de"
    ? { place: "Ort", bay: "Bucht", island: "Insel" }[result.kind]
    : { place: "Place", bay: "Bay", island: "Island" }[result.kind];
  const detail = result.detail.replace(/^(?:Ort und Insel|Ort|Stadt|Inselgruppe|Insel|Bucht)\s*·\s*/i, "");
  return detail ? `${kind} · ${detail}` : kind;
}

export function buildPhotonPlaceSearchUrl(query: string, language: "de" | "en") {
  const parameters = new URLSearchParams({
    q: query.trim(),
    lang: language,
    limit: "12",
    bbox: `${CROATIA_SEARCH_BOUNDS.west},${CROATIA_SEARCH_BOUNDS.south},${CROATIA_SEARCH_BOUNDS.east},${CROATIA_SEARCH_BOUNDS.north}`,
  });
  return `https://photon.komoot.io/api/?${parameters.toString()}`;
}

function photonKind(properties: Record<string, unknown>): PlaceKind {
  const value = String(properties.osm_value ?? properties.type ?? "").toLowerCase();
  if (value === "bay") return "bay";
  if (value === "island" || value === "islet") return "island";
  return "place";
}

export function parsePhotonPlaceSearchPayload(payload: unknown): PlaceSearchResult[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { features?: unknown }).features)) return [];
  const features = (payload as { features: unknown[] }).features;
  const results: PlaceSearchResult[] = [];
  for (const [index, feature] of features.entries()) {
    if (!feature || typeof feature !== "object") continue;
    const geometry = (feature as { geometry?: unknown }).geometry;
    const properties = (feature as { properties?: unknown }).properties;
    if (!geometry || typeof geometry !== "object" || !properties || typeof properties !== "object") continue;
    const coordinates = (geometry as { coordinates?: unknown }).coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    const values = properties as Record<string, unknown>;
    const name = typeof values.name === "string" ? values.name.trim() : "";
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (longitude < CROATIA_SEARCH_BOUNDS.west || longitude > CROATIA_SEARCH_BOUNDS.east || latitude < CROATIA_SEARCH_BOUNDS.south || latitude > CROATIA_SEARCH_BOUNDS.north) continue;
    const detail = [values.city, values.county, values.state, values.country]
      .filter((value, position, all): value is string => typeof value === "string" && value.trim().length > 0 && all.indexOf(value) === position)
      .slice(0, 2)
      .join(" · ");
    results.push({
      id: `osm-${String(values.osm_type ?? "feature")}-${String(values.osm_id ?? index)}`,
      name,
      detail: detail || "Kroatien",
      kind: photonKind(values),
      latitude,
      longitude,
      source: "osm",
    });
  }
  return results;
}
