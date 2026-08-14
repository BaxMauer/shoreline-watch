import { fuzzyPlaceScore, normalizePlaceSearchText, type PlaceSearchResult } from "./place-search.ts";
import type { GeoPoint } from "./route-planning.ts";

export type MapFeatureKind = "island" | "bay" | "settlement" | "restaurant";
export type MapFeature = GeoPoint & {
  id: string;
  name: string;
  aliases: string[];
  kind: MapFeatureKind;
  subtype: string;
};
export type MapFeaturePack = {
  version: number;
  generatedAt: string;
  source: string;
  license: string;
  stats: Record<MapFeatureKind, number>;
  cellSizeDegrees: number;
  cells: Record<string, number[]>;
  features: MapFeature[];
};
export type PositionedMapFeature = MapFeature & { x: number; y: number };

const METRES_PER_LATITUDE_DEGREE = 110_540;

function longitudeScale(latitude: number) {
  return 111_320 * Math.max(0.1, Math.cos((latitude * Math.PI) / 180));
}

function featureRangeLimit(feature: MapFeature) {
  if (feature.kind === "island") return feature.subtype === "islet" ? 24_000 : 120_000;
  if (feature.kind === "bay") return 18_000;
  if (feature.kind === "restaurant") return 2_800;
  if (feature.subtype === "city") return 120_000;
  if (feature.subtype === "town") return 55_000;
  if (feature.subtype === "village") return 24_000;
  return 6_000;
}

function featurePriority(feature: MapFeature) {
  if (feature.kind === "island") return feature.subtype === "archipelago" ? 0 : feature.subtype === "island" ? 1 : 4;
  if (feature.kind === "settlement") return feature.subtype === "city" ? 2 : feature.subtype === "town" ? 3 : feature.subtype === "village" ? 5 : 7;
  if (feature.kind === "bay") return 6;
  return 8;
}

export function getMapFeaturesInView(
  pack: MapFeaturePack | null,
  centre: GeoPoint,
  halfRangeMetres: number,
) {
  if (!pack || !Number.isFinite(halfRangeMetres) || halfRangeMetres <= 0) return [];
  const latitudeDelta = halfRangeMetres / METRES_PER_LATITUDE_DEGREE;
  const longitudeDelta = halfRangeMetres / longitudeScale(centre.latitude);
  const cellSize = pack.cellSizeDegrees;
  const southCell = Math.floor((centre.latitude - latitudeDelta) / cellSize);
  const northCell = Math.floor((centre.latitude + latitudeDelta) / cellSize);
  const westCell = Math.floor((centre.longitude - longitudeDelta) / cellSize);
  const eastCell = Math.floor((centre.longitude + longitudeDelta) / cellSize);
  const indices = new Set<number>();
  for (let latitudeCell = southCell; latitudeCell <= northCell; latitudeCell += 1) {
    for (let longitudeCell = westCell; longitudeCell <= eastCell; longitudeCell += 1) {
      for (const index of pack.cells[`${latitudeCell}:${longitudeCell}`] ?? []) indices.add(index);
    }
  }
  return [...indices]
    .map((index) => pack.features[index])
    .filter((feature): feature is MapFeature => Boolean(feature)
      && Math.abs(feature.latitude - centre.latitude) <= latitudeDelta
      && Math.abs(feature.longitude - centre.longitude) <= longitudeDelta
      && halfRangeMetres <= featureRangeLimit(feature));
}

export function placeMapFeatureLabels(
  features: MapFeature[],
  project: (point: GeoPoint) => { x: number; y: number },
  size: number,
  limit = 24,
) {
  const placed: PositionedMapFeature[] = [];
  const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const candidates = features
    .map((feature) => ({ feature, position: project(feature) }))
    .filter(({ position }) => position.x >= -20 && position.x <= size + 20 && position.y >= -12 && position.y <= size + 12)
    .sort((left, right) => featurePriority(left.feature) - featurePriority(right.feature)
      || Math.hypot(left.position.x - size / 2, left.position.y - size / 2) - Math.hypot(right.position.x - size / 2, right.position.y - size / 2)
      || left.feature.id.localeCompare(right.feature.id));

  for (const { feature, position } of candidates) {
    const halfWidth = Math.min(46, Math.max(10, feature.name.length * 2.65));
    const box = { left: position.x - halfWidth, right: position.x + halfWidth, top: position.y - 7, bottom: position.y + 7 };
    if (boxes.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
    boxes.push(box);
    placed.push({ ...feature, ...position });
    if (placed.length >= limit) break;
  }
  return placed;
}

export function searchCroatianMapFeatures(pack: MapFeaturePack | null, query: string, limit = 10): PlaceSearchResult[] {
  const normalized = normalizePlaceSearchText(query);
  if (!pack || normalized.length < 2) return [];
  const firstCharacter = normalized[0];
  return pack.features
    .filter((feature) => feature.kind !== "restaurant")
    .map((feature) => ({
      feature,
      names: [feature.name, ...feature.aliases],
    }))
    .filter(({ names }) => names.some((name) => {
      const candidate = normalizePlaceSearchText(name);
      return candidate.startsWith(firstCharacter) || candidate.includes(normalized);
    }))
    .map((feature) => ({
      feature: feature.feature,
      score: Math.min(...feature.names.map((name) => fuzzyPlaceScore(query, name))),
    }))
    .filter(({ score }) => score <= 0.46)
    .sort((left, right) => left.score - right.score || featurePriority(left.feature) - featurePriority(right.feature) || left.feature.name.localeCompare(right.feature.name, "hr"))
    .slice(0, limit)
    .map(({ feature }) => ({
      id: `catalog-${feature.id}`,
      name: feature.name,
      aliases: feature.aliases,
      detail: "Kroatien",
      kind: feature.kind === "island" ? "island" : feature.kind === "bay" ? "bay" : "place",
      latitude: feature.latitude,
      longitude: feature.longitude,
      source: "local",
    }));
}
