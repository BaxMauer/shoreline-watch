import {
  findNearestShore,
  getLandIntervalsAtLatitude,
  isPointOnLand,
  distanceToSegment,
  type CoastlinePack,
  type LongitudeInterval,
} from "./shoreline.ts";

export type GeoPoint = { longitude: number; latitude: number };

export type RoutePlanningOptions = {
  clearanceMetres: number;
  cruiseSpeedKnots: number;
  speedWarningEnabled: boolean;
  nearShoreSpeedKnots: number;
  maximumDistanceMetres?: number;
  /** Accuracy of the live fix. Used only to recover a start fix that falls just inside the charted shoreline. */
  startAccuracyMetres?: number;
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

export function getRouteGridResolutions(widthMetres: number, heightMetres: number, clearanceMetres: number) {
  const width = Math.max(1, widthMetres);
  const height = Math.max(1, heightMetres);
  const span = Math.max(width, height);
  const clearance = Math.max(0, clearanceMetres);
  const coarse = Math.max(180, clearance * 0.7, span / 58);
  const preferredFine = Math.max(45, Math.min(90, clearance > 0 ? clearance * 0.25 : 45));
  // Keep the refinement bounded on very long routes while allowing roughly
  // 50–90 m cells around islands, marinas, and narrow passages.
  const boundedFine = Math.max(preferredFine, Math.sqrt(width * height / 260_000));
  return boundedFine < coarse * 0.82 ? [coarse, boundedFine] : [coarse];
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
type EndpointCandidate = { key: number; connectionDistance: number; adjusted: boolean };

function interpolate(left: GeoPoint, right: GeoPoint, position: number): GeoPoint {
  return {
    longitude: left.longitude + (right.longitude - left.longitude) * position,
    latitude: left.latitude + (right.latitude - left.latitude) * position,
  };
}

function intervalContains(intervals: LongitudeInterval[], longitude: number) {
  let low = 0;
  let high = intervals.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const interval = intervals[middle];
    if (longitude < interval[0]) high = middle - 1;
    else if (longitude > interval[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function segmentLandProfile(pack: CoastlinePack, start: GeoPoint, end: GeoPoint, spacingMetres = 22) {
  const distance = geoDistanceMetres(start, end);
  const samples = Math.max(1, Math.ceil(distance / spacingMetres));
  let hasLand = false;
  let hasWater = false;
  let landAfterWater = false;
  for (let sample = 0; sample <= samples; sample += 1) {
    const point = interpolate(start, end, sample / samples);
    if (isPointOnLand(pack, point.longitude, point.latitude)) {
      hasLand = true;
      if (hasWater) landAfterWater = true;
    } else {
      hasWater = true;
    }
  }
  return { waterOnly: !hasLand, exitsLandOnce: hasLand && hasWater && !landAfterWater };
}

function segmentsIntersect(
  firstStart: GeoPoint,
  firstEnd: GeoPoint,
  secondStart: GeoPoint,
  secondEnd: GeoPoint,
) {
  const cross = (a: GeoPoint, b: GeoPoint, c: GeoPoint) => (b.longitude - a.longitude) * (c.latitude - a.latitude)
    - (b.latitude - a.latitude) * (c.longitude - a.longitude);
  const epsilon = 1e-12;
  const firstA = cross(firstStart, firstEnd, secondStart);
  const firstB = cross(firstStart, firstEnd, secondEnd);
  const secondA = cross(secondStart, secondEnd, firstStart);
  const secondB = cross(secondStart, secondEnd, firstEnd);
  const between = (value: number, left: number, right: number) => value >= Math.min(left, right) - epsilon && value <= Math.max(left, right) + epsilon;
  const onSegment = (start: GeoPoint, end: GeoPoint, point: GeoPoint) => between(point.longitude, start.longitude, end.longitude)
    && between(point.latitude, start.latitude, end.latitude);

  if (((firstA > epsilon && firstB < -epsilon) || (firstA < -epsilon && firstB > epsilon))
    && ((secondA > epsilon && secondB < -epsilon) || (secondA < -epsilon && secondB > epsilon))) return true;
  if (Math.abs(firstA) <= epsilon && onSegment(firstStart, firstEnd, secondStart)) return true;
  if (Math.abs(firstB) <= epsilon && onSegment(firstStart, firstEnd, secondEnd)) return true;
  if (Math.abs(secondA) <= epsilon && onSegment(secondStart, secondEnd, firstStart)) return true;
  if (Math.abs(secondB) <= epsilon && onSegment(secondStart, secondEnd, firstEnd)) return true;
  return false;
}

export function routeSegmentCrossesShoreline(pack: CoastlinePack, start: GeoPoint, end: GeoPoint) {
  const minimumX = Math.floor(Math.min(start.longitude, end.longitude) / pack.cellSize);
  const maximumX = Math.floor(Math.max(start.longitude, end.longitude) / pack.cellSize);
  const minimumY = Math.floor(Math.min(start.latitude, end.latitude) / pack.cellSize);
  const maximumY = Math.floor(Math.max(start.latitude, end.latitude) / pack.cellSize);
  for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      const values = pack.cells[`${cellX}:${cellY}`];
      if (!values) continue;
      for (let index = 0; index < values.length; index += 4) {
        if (segmentsIntersect(start, end, {
          longitude: values[index],
          latitude: values[index + 1],
        }, {
          longitude: values[index + 2],
          latitude: values[index + 3],
        })) return true;
      }
    }
  }
  return false;
}

function shorelineDistanceWithin(pack: CoastlinePack, point: GeoPoint, limitMetres: number) {
  const safeLimit = Math.max(1, limitMetres);
  const longitudeRadius = safeLimit / longitudeScale(point.latitude);
  const latitudeRadius = safeLimit / METRES_PER_LATITUDE_DEGREE;
  const minimumX = Math.floor((point.longitude - longitudeRadius) / pack.cellSize);
  const maximumX = Math.floor((point.longitude + longitudeRadius) / pack.cellSize);
  const minimumY = Math.floor((point.latitude - latitudeRadius) / pack.cellSize);
  const maximumY = Math.floor((point.latitude + latitudeRadius) / pack.cellSize);
  let nearest = safeLimit;

  // Coastline segments are already spatially indexed in the offline pack. For
  // routing we only need exact distances inside the configured clearance band;
  // avoiding the much wider nearest-shore ring scan makes island searches fast
  // enough to run interactively on a phone.
  for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      const values = pack.cells[`${cellX}:${cellY}`];
      if (!values) continue;
      for (let index = 0; index < values.length; index += 4) {
        nearest = Math.min(nearest, distanceToSegment(point.longitude, point.latitude, [
          values[index],
          values[index + 1],
          values[index + 2],
          values[index + 3],
        ]).distance);
      }
    }
  }
  return nearest;
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
  const startIsLand = isPointOnLand(pack, start.longitude, start.latitude);
  // A phone fix can land a few metres inside the charted shoreline while the
  // boat is still afloat. Permit one short, outward-only correction from that
  // start; destinations and all later route legs remain strictly water-only.
  const startSnapTolerance = Math.max(120, Math.min(350, (options.startAccuracyMetres ?? 0) * 2.5));
  const baseMargin = Math.max(3_000, options.clearanceMetres * 3.5, Math.min(25_000, directDistance * 0.55));
  // Peninsulas and island chains often require a route that initially moves
  // away from the target. A second, wider search avoids treating the straight
  // start/target corridor as the whole navigable world.
  const expandedMargin = Math.min(40_000, Math.max(baseMargin * 2.4, directDistance * 1.15, 8_000));
  const margins = expandedMargin > baseMargin * 1.2 ? [baseMargin, expandedMargin] : [baseMargin];
  const packWest = (pack.bounds[0] - origin.longitude) * metresPerLongitudeDegree;
  const packEast = (pack.bounds[2] - origin.longitude) * metresPerLongitudeDegree;
  const packSouth = (pack.bounds[1] - origin.latitude) * METRES_PER_LATITUDE_DEGREE;
  const packNorth = (pack.bounds[3] - origin.latitude) * METRES_PER_LATITUDE_DEGREE;

  const search = (margin: number, cellSize: number, allowRestricted: boolean) => {
    const minimumX = Math.max(packWest, Math.min(startLocal.x, destinationLocal.x) - margin);
    const maximumX = Math.min(packEast, Math.max(startLocal.x, destinationLocal.x) + margin);
    const minimumY = Math.max(packSouth, Math.min(startLocal.y, destinationLocal.y) - margin);
    const maximumY = Math.min(packNorth, Math.max(startLocal.y, destinationLocal.y) + margin);
    const width = maximumX - minimumX;
    const height = maximumY - minimumY;
    const columns = Math.max(3, Math.floor(width / cellSize) + 1);
    const rows = Math.max(3, Math.floor(height / cellSize) + 1);
    const pointFor = (column: number, row: number) => toGeo({ x: minimumX + column * cellSize, y: minimumY + row * cellSize });
    const nearestIndex = (point: LocalPoint) => ({
      column: Math.max(0, Math.min(columns - 1, Math.round((point.x - minimumX) / cellSize))),
      row: Math.max(0, Math.min(rows - 1, Math.round((point.y - minimumY) / cellSize))),
    });
    const endpointGrace = Math.max(options.clearanceMetres * 1.2, cellSize * 1.8);
    const routedClearance = options.clearanceMetres + cellSize * 0.5;
    const nodeCache = new Map<number, NodeInfo>();
    const landIntervalsByRow = new Map<number, LongitudeInterval[]>();
    const minimumLongitude = toGeo({ x: minimumX - cellSize, y: 0 }).longitude;
    const maximumLongitude = toGeo({ x: maximumX + cellSize, y: 0 }).longitude;
    const node = (key: number) => {
      const cached = nodeCache.get(key);
      if (cached) return cached;
      const row = Math.floor(key / columns);
      const column = key % columns;
      const point = pointFor(column, row);
      let intervals = landIntervalsByRow.get(row);
      if (!intervals) {
        intervals = getLandIntervalsAtLatitude(pack, point.latitude, minimumLongitude, maximumLongitude);
        landIntervalsByRow.set(row, intervals);
      }
      const land = intervalContains(intervals, point.longitude);
      const value = {
        point,
        land,
        shoreDistance: land ? 0 : shorelineDistanceWithin(pack, point, routedClearance * 1.8),
      };
      nodeCache.set(key, value);
      return value;
    };

    const endpointCandidates = (point: GeoPoint, pointLocal: LocalPoint, startEndpoint: boolean) => {
      const centreIndex = nearestIndex(pointLocal);
      const connectionLimit = startEndpoint && startIsLand
        ? startSnapTolerance
        : Math.max(cellSize * 3.25, 180);
      const radius = Math.max(1, Math.ceil(connectionLimit / cellSize));
      const candidates: EndpointCandidate[] = [];
      for (let row = Math.max(0, centreIndex.row - radius); row <= Math.min(rows - 1, centreIndex.row + radius); row += 1) {
        for (let column = Math.max(0, centreIndex.column - radius); column <= Math.min(columns - 1, centreIndex.column + radius); column += 1) {
          const key = row * columns + column;
          const candidate = node(key);
          if (candidate.land) continue;
          const connectionDistance = geoDistanceMetres(point, candidate.point);
          if (connectionDistance > connectionLimit) continue;
          const adjusted = startEndpoint && startIsLand;
          if (adjusted) {
            if (!segmentLandProfile(pack, point, candidate.point, 8).exitsLandOnce) continue;
          } else if (routeSegmentCrossesShoreline(pack, point, candidate.point)) continue;
          candidates.push({ key, connectionDistance, adjusted });
        }
      }
      // Multi-source/multi-target anchoring prevents a narrow inlet from being
      // lost merely because the nearest grid centre happens to lie on land.
      return candidates.sort((left, right) => left.connectionDistance - right.connectionDistance).slice(0, 40);
    };

    const startCandidates = endpointCandidates(start, startLocal, true);
    const destinationCandidates = endpointCandidates(destination, destinationLocal, false);
    if (startCandidates.length === 0 || destinationCandidates.length === 0) return null;
    const destinationConnections = new Map<number, number>();
    for (const candidate of destinationCandidates) {
      const current = destinationConnections.get(candidate.key);
      if (current === undefined || candidate.connectionDistance < current) destinationConnections.set(candidate.key, candidate.connectionDistance);
    }
    const nearEndpoint = (point: GeoPoint) => geoDistanceMetres(point, start) <= endpointGrace || geoDistanceMetres(point, destination) <= endpointGrace;
    const open = new MinHeap();
    const costs = new Float64Array(columns * rows);
    costs.fill(Number.POSITIVE_INFINITY);
    const previous = new Int32Array(columns * rows);
    previous.fill(-1);
    for (const candidate of startCandidates) {
      // Starting from a chart-adjusted fix is deliberately more expensive than
      // a normal water connection, so it is chosen only as far as necessary.
      const cost = candidate.connectionDistance * (candidate.adjusted ? 6 : 1);
      if (cost >= costs[candidate.key]) continue;
      costs[candidate.key] = cost;
      previous[candidate.key] = -2;
      open.push({ key: candidate.key, score: cost + geoDistanceMetres(node(candidate.key).point, destination) });
    }
    const closed = new Uint8Array(columns * rows);
    const directions = [-1, 0, 1];
    const edgeCache = new Map<string, boolean>();
    let reachedKey = -1;

    while (open.size) {
      const currentEntry = open.pop();
      if (!currentEntry || closed[currentEntry.key]) continue;
      if (destinationConnections.has(currentEntry.key)) {
        reachedKey = currentEntry.key;
        break;
      }
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
        const edgeId = currentEntry.key < nextKey ? `${currentEntry.key}:${nextKey}` : `${nextKey}:${currentEntry.key}`;
        let edgeBlocked = edgeCache.get(edgeId);
        if (edgeBlocked === undefined) {
          edgeBlocked = routeSegmentCrossesShoreline(pack, current.point, next.point);
          edgeCache.set(edgeId, edgeBlocked);
        }
        if (edgeBlocked) continue;
        // Diagonal movement is valid when the sampled segment itself remains
        // in water. Requiring both neighbouring square cells to be water used
        // to reject real angled channels and Croatian island narrows.
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

    if (reachedKey < 0) return null;
    const reversed: GeoPoint[] = [];
    let key = reachedKey;
    while (key >= 0) {
      reversed.push(node(key).point);
      key = previous[key];
      if (key === -2) break;
      if (key < 0) return null;
    }
    const points = [start, ...reversed.reverse(), destination]
      .filter((point, index, routePoints) => index === 0 || geoDistanceMetres(routePoints[index - 1], point) > 0.5);
    for (let index = 1; index < points.length; index += 1) {
      if (index === 1 && startIsLand) {
        const profile = segmentLandProfile(pack, points[0], points[1], 8);
        if (profile.exitsLandOnce && geoDistanceMetres(points[0], points[1]) <= startSnapTolerance) continue;
      }
      if (routeSegmentCrossesShoreline(pack, points[index - 1], points[index])) return null;
    }
    return points;
  };

  let rawPoints: GeoPoint[] | null = null;
  let strict = false;
  const searchAreas = margins.map((margin) => {
    const width = Math.min(packEast, Math.max(startLocal.x, destinationLocal.x) + margin)
      - Math.max(packWest, Math.min(startLocal.x, destinationLocal.x) - margin);
    const height = Math.min(packNorth, Math.max(startLocal.y, destinationLocal.y) + margin)
      - Math.max(packSouth, Math.min(startLocal.y, destinationLocal.y) - margin);
    return { margin, width, height, resolutions: getRouteGridResolutions(width, height, options.clearanceMetres) };
  });
  const runAttempt = (margin: number, cellSize: number, restricted: boolean) => {
    return search(margin, cellSize, restricted);
  };

  // Widen the search before spending time on the fine raster. This is crucial
  // around long peninsulas: zoom does not define the route corridor, and a
  // coarse expanded path is preferable to proving every cell in a corridor
  // that simply cannot contain the required detour.
  let restrictedFallback: GeoPoint[] | null = null;
  for (const { margin, resolutions } of searchAreas) {
    const coarse = resolutions[0];
    rawPoints = runAttempt(margin, coarse, false);
    if (rawPoints) {
      strict = true;
      break;
    }
    const candidate = runAttempt(margin, coarse, true);
    if (!candidate) continue;
    const measured = buildRoute(pack, candidate, options, "restricted");
    if (measured.restrictedDistanceMetres === 0) {
      rawPoints = candidate;
      strict = true;
      break;
    }
    if (!restrictedFallback || measured.distanceMetres < buildRoute(pack, restrictedFallback, options, "restricted").distanceMetres) {
      restrictedFallback = candidate;
    }
  }
  if (!rawPoints) {
    for (const { margin, width, height, resolutions } of searchAreas) {
      const fine = resolutions.at(-1) as number;
      if (fine === resolutions[0]) continue;
      // A fine strict pass improves paths through small but sufficiently wide
      // channels. Bound this refinement so a phone does not exhaustively scan
      // a whole archipelago when a valid restricted route is already known.
      if (width * height / (fine * fine) > 70_000 && restrictedFallback) continue;
      rawPoints = runAttempt(margin, fine, false);
      if (rawPoints) {
        strict = true;
        break;
      }
      const refinedCandidate = runAttempt(margin, fine, true);
      if (!refinedCandidate) continue;
      const refined = buildRoute(pack, refinedCandidate, options, "restricted");
      if (refined.restrictedDistanceMetres === 0) {
        rawPoints = refinedCandidate;
        strict = true;
        break;
      }
      if (!restrictedFallback || refined.restrictedDistanceMetres
        < buildRoute(pack, restrictedFallback, options, "restricted").restrictedDistanceMetres) {
        restrictedFallback = refinedCandidate;
      }
    }
  }
  if (!rawPoints && restrictedFallback) rawPoints = restrictedFallback;
  if (!rawPoints) {
    for (const { margin, resolutions } of searchAreas) {
      const fine = resolutions.at(-1) as number;
      if (fine === resolutions[0]) continue;
      rawPoints = runAttempt(margin, fine, true);
      if (rawPoints) break;
    }
  }
  if (!rawPoints) return { failure: "no-route" };
  const route = buildRoute(pack, rawPoints, options, strict ? "clearance" : "restricted");
  // Endpoint grace helps with normal GPS drift close to shore, but the result
  // must still be labelled restricted whenever the measured route enters the
  // configured clearance zone.
  route.mode = route.restrictedDistanceMetres > 0 ? "restricted" : "clearance";
  return { route };
}
