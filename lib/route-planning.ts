import { findNearestShore, isPointOnLand, type CoastlinePack } from "./shoreline.ts";

export type GeoPoint = { longitude: number; latitude: number };

export type RoutePlanningOptions = {
  clearanceMetres: number;
  cruiseSpeedKnots: number;
  speedWarningEnabled: boolean;
  nearShoreSpeedKnots: number;
  maximumDistanceMetres?: number;
};

export type PlannedRoute = {
  points: GeoPoint[];
  distanceMetres: number;
  estimatedSeconds: number;
  minimumShoreDistanceMetres: number;
  restrictedDistanceMetres: number;
  mode: "clearance" | "restricted";
};

export type RoutePlanningFailure = "outside-region" | "destination-on-land" | "too-far" | "no-route";
export type RoutePlanningResult = { route: PlannedRoute; failure?: never } | { route?: never; failure: RoutePlanningFailure };

const METRES_PER_LATITUDE_DEGREE = 110_540;
const KNOTS_TO_METRES_PER_SECOND = 0.514444;

function longitudeScale(latitude: number) {
  return 111_320 * Math.cos((latitude * Math.PI) / 180);
}

export function geoDistanceMetres(left: GeoPoint, right: GeoPoint) {
  const latitude = (left.latitude + right.latitude) / 2;
  return Math.hypot(
    (right.longitude - left.longitude) * longitudeScale(latitude),
    (right.latitude - left.latitude) * METRES_PER_LATITUDE_DEGREE,
  );
}

export function geoBearing(left: GeoPoint, right: GeoPoint) {
  const east = (right.longitude - left.longitude) * longitudeScale((left.latitude + right.latitude) / 2);
  const north = (right.latitude - left.latitude) * METRES_PER_LATITUDE_DEGREE;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

export function formatRouteDistance(distanceMetres: number) {
  return distanceMetres / 1_852;
}

type HeapEntry = { key: number; score: number };

class MinHeap {
  private values: HeapEntry[] = [];

  get size() { return this.values.length; }

  push(entry: HeapEntry) {
    this.values.push(entry);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].score <= entry.score) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = entry;
  }

  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].score < this.values[left].score ? right : left;
      if (this.values[child].score >= last.score) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

type LocalPoint = { x: number; y: number };
type NodeInfo = { point: GeoPoint; land: boolean; shoreDistance: number };

function interpolate(left: GeoPoint, right: GeoPoint, position: number): GeoPoint {
  return {
    longitude: left.longitude + (right.longitude - left.longitude) * position,
    latitude: left.latitude + (right.latitude - left.latitude) * position,
  };
}

function buildRoute(
  pack: CoastlinePack,
  points: GeoPoint[],
  options: RoutePlanningOptions,
  mode: PlannedRoute["mode"],
) {
  let distanceMetres = 0;
  let estimatedSeconds = 0;
  let minimumShoreDistanceMetres = Number.POSITIVE_INFINITY;
  let restrictedDistanceMetres = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = geoDistanceMetres(start, end);
    const samples = Math.max(1, Math.ceil(distance / Math.max(80, options.clearanceMetres / 2)));
    let restrictedSamples = 0;
    for (let sample = 0; sample <= samples; sample += 1) {
      const samplePoint = interpolate(start, end, sample / samples);
      const shore = findNearestShore(pack, samplePoint.longitude, samplePoint.latitude);
      if (!shore) continue;
      minimumShoreDistanceMetres = Math.min(minimumShoreDistanceMetres, shore.distance);
      if (shore.distance < options.clearanceMetres) restrictedSamples += 1;
    }
    const restrictedFraction = Math.min(1, restrictedSamples / (samples + 1));
    const restrictedDistance = distance * restrictedFraction;
    const openDistance = distance - restrictedDistance;
    const openSpeed = Math.max(1, options.cruiseSpeedKnots) * KNOTS_TO_METRES_PER_SECOND;
    const nearSpeed = (options.speedWarningEnabled ? Math.max(1, options.nearShoreSpeedKnots) : Math.max(1, options.cruiseSpeedKnots)) * KNOTS_TO_METRES_PER_SECOND;
    estimatedSeconds += openDistance / openSpeed + restrictedDistance / nearSpeed;
    restrictedDistanceMetres += restrictedDistance;
    distanceMetres += distance;
  }

  return {
    points,
    distanceMetres,
    estimatedSeconds,
    minimumShoreDistanceMetres: Number.isFinite(minimumShoreDistanceMetres) ? minimumShoreDistanceMetres : 0,
    restrictedDistanceMetres,
    mode,
  } satisfies PlannedRoute;
}

export function planWaterRoute(
  pack: CoastlinePack,
  start: GeoPoint,
  destination: GeoPoint,
  rawOptions: RoutePlanningOptions,
): RoutePlanningResult {
  const options = {
    ...rawOptions,
    clearanceMetres: Math.max(0, rawOptions.clearanceMetres),
    cruiseSpeedKnots: Math.max(1, rawOptions.cruiseSpeedKnots),
    nearShoreSpeedKnots: Math.max(1, rawOptions.nearShoreSpeedKnots),
    maximumDistanceMetres: rawOptions.maximumDistanceMetres ?? 120_000,
  };
  const insideBounds = (point: GeoPoint) => point.longitude >= pack.bounds[0] && point.longitude <= pack.bounds[2]
    && point.latitude >= pack.bounds[1] && point.latitude <= pack.bounds[3];
  if (!insideBounds(start) || !insideBounds(destination)) return { failure: "outside-region" };
  if (isPointOnLand(pack, destination.longitude, destination.latitude)) return { failure: "destination-on-land" };
  const directDistance = geoDistanceMetres(start, destination);
  if (directDistance > options.maximumDistanceMetres) return { failure: "too-far" };
  if (directDistance < 30) return { route: buildRoute(pack, [start, destination], options, "clearance") };

  const centreLatitude = (start.latitude + destination.latitude) / 2;
  const metresPerLongitudeDegree = longitudeScale(centreLatitude);
  const origin = start;
  const toLocal = (point: GeoPoint): LocalPoint => ({
    x: (point.longitude - origin.longitude) * metresPerLongitudeDegree,
    y: (point.latitude - origin.latitude) * METRES_PER_LATITUDE_DEGREE,
  });
  const toGeo = (point: LocalPoint): GeoPoint => ({
    longitude: origin.longitude + point.x / metresPerLongitudeDegree,
    latitude: origin.latitude + point.y / METRES_PER_LATITUDE_DEGREE,
  });
  const startLocal = { x: 0, y: 0 };
  const destinationLocal = toLocal(destination);
  const margin = Math.max(3_000, options.clearanceMetres * 3.5, Math.min(25_000, directDistance * 0.55));
  const minimumX = Math.min(startLocal.x, destinationLocal.x) - margin;
  const maximumX = Math.max(startLocal.x, destinationLocal.x) + margin;
  const minimumY = Math.min(startLocal.y, destinationLocal.y) - margin;
  const maximumY = Math.max(startLocal.y, destinationLocal.y) + margin;
  const span = Math.max(maximumX - minimumX, maximumY - minimumY);
  const cellSize = Math.max(180, options.clearanceMetres * 0.7, span / 58);
  const columns = Math.max(3, Math.ceil((maximumX - minimumX) / cellSize) + 1);
  const rows = Math.max(3, Math.ceil((maximumY - minimumY) / cellSize) + 1);
  const pointFor = (column: number, row: number) => toGeo({ x: minimumX + column * cellSize, y: minimumY + row * cellSize });
  const nearestIndex = (point: LocalPoint) => ({
    column: Math.max(0, Math.min(columns - 1, Math.round((point.x - minimumX) / cellSize))),
    row: Math.max(0, Math.min(rows - 1, Math.round((point.y - minimumY) / cellSize))),
  });
  const startIndex = nearestIndex(startLocal);
  const destinationIndex = nearestIndex(destinationLocal);
  const startKey = startIndex.row * columns + startIndex.column;
  const destinationKey = destinationIndex.row * columns + destinationIndex.column;
  const endpointGrace = Math.max(options.clearanceMetres * 2.2, cellSize * 2.2);
  const routedClearance = options.clearanceMetres + cellSize * 0.72;
  const nodeCache = new Map<number, NodeInfo>();
  const node = (key: number) => {
    const cached = nodeCache.get(key);
    if (cached) return cached;
    const row = Math.floor(key / columns);
    const column = key % columns;
    const point = pointFor(column, row);
    const shore = findNearestShore(pack, point.longitude, point.latitude);
    const value = { point, land: isPointOnLand(pack, point.longitude, point.latitude), shoreDistance: shore?.distance ?? 0 };
    nodeCache.set(key, value);
    return value;
  };
  const nearEndpoint = (point: GeoPoint) => geoDistanceMetres(point, start) <= endpointGrace || geoDistanceMetres(point, destination) <= endpointGrace;

  const search = (allowRestricted: boolean) => {
    const open = new MinHeap();
    const costs = new Float64Array(columns * rows);
    costs.fill(Number.POSITIVE_INFINITY);
    const previous = new Int32Array(columns * rows);
    previous.fill(-1);
    costs[startKey] = 0;
    open.push({ key: startKey, score: directDistance });
    const closed = new Uint8Array(columns * rows);
    const directions = [-1, 0, 1];

    while (open.size) {
      const currentEntry = open.pop();
      if (!currentEntry || closed[currentEntry.key]) continue;
      if (currentEntry.key === destinationKey) break;
      closed[currentEntry.key] = 1;
      const currentRow = Math.floor(currentEntry.key / columns);
      const currentColumn = currentEntry.key % columns;

      for (const rowStep of directions) for (const columnStep of directions) {
        if (rowStep === 0 && columnStep === 0) continue;
        const nextRow = currentRow + rowStep;
        const nextColumn = currentColumn + columnStep;
        if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
        const nextKey = nextRow * columns + nextColumn;
        if (closed[nextKey]) continue;
        const next = node(nextKey);
        if (next.land) continue;
        // Grid nodes keep an extra half-cell margin so an edge between two safe
        // nodes cannot silently shave the configured shoreline clearance.
        const restricted = next.shoreDistance < routedClearance;
        if (restricted && !allowRestricted && !nearEndpoint(next.point)) continue;
        const current = node(currentEntry.key);
        const edgeSamples = Math.max(1, Math.ceil(geoDistanceMetres(current.point, next.point) / 100));
        let edgeBlocked = false;
        for (let sample = 1; sample < edgeSamples; sample += 1) {
          const samplePoint = interpolate(current.point, next.point, sample / edgeSamples);
          if (isPointOnLand(pack, samplePoint.longitude, samplePoint.latitude)) {
            edgeBlocked = true;
            break;
          }
        }
        if (edgeBlocked) continue;
        if (rowStep !== 0 && columnStep !== 0) {
          const sideA = node(currentRow * columns + nextColumn);
          const sideB = node(nextRow * columns + currentColumn);
          if (sideA.land || sideB.land) continue;
        }
        const stepDistance = cellSize * (rowStep !== 0 && columnStep !== 0 ? Math.SQRT2 : 1);
        const proximity = options.clearanceMetres <= 0 ? 0 : Math.max(0, 1 - next.shoreDistance / Math.max(1, options.clearanceMetres));
        const penalty = restricted ? (allowRestricted ? 9 : 4) : 1 + proximity * 1.5;
        const nextCost = costs[currentEntry.key] + stepDistance * penalty;
        if (nextCost >= costs[nextKey]) continue;
        costs[nextKey] = nextCost;
        previous[nextKey] = currentEntry.key;
        open.push({ key: nextKey, score: nextCost + geoDistanceMetres(next.point, destination) });
      }
    }

    if (previous[destinationKey] < 0) return null;
    const reversed: GeoPoint[] = [destination];
    let key = destinationKey;
    while (key !== startKey) {
      key = previous[key];
      if (key < 0) return null;
      if (key !== startKey) reversed.push(node(key).point);
    }
    reversed.push(start);
    return reversed.reverse();
  };

  const strict = search(false);
  const rawPoints = strict ?? search(true);
  if (!rawPoints) return { failure: "no-route" };
  return { route: buildRoute(pack, rawPoints, options, strict ? "clearance" : "restricted") };
}
