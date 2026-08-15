import {
  findNearestShore,
  getLandIntervalsAtLatitude,
  isPointOnLand,
  offsetFromShore,
  distanceToSegment,
  type CoastlinePack,
  type LongitudeInterval,
} from "./shoreline.ts";
import { MAXIMUM_NAVIGATION_ACCURACY_METRES } from "./navigation-metrics.ts";
import { ROUTE_PASSAGE_HINTS } from "./route-passages.ts";

export type GeoPoint = { longitude: number; latitude: number };

export type RoutePlanningOptions = {
  clearanceMetres: number;
  cruiseSpeedKnots: number;
  speedWarningEnabled: boolean;
  nearShoreSpeedKnots: number;
  maximumDistanceMetres?: number;
  /** Accuracy of the live fix. Used only to recover a start fix that falls just inside the charted shoreline. */
  startAccuracyMetres?: number;
  /** Allow conditional, manually verified passages such as the Tisno lift bridge. */
  conditionalPassagesEnabled?: boolean;
};

export type PlannedRoute = {
  points: GeoPoint[];
  distanceMetres: number;
  estimatedSeconds: number;
  minimumShoreDistanceMetres: number;
  restrictedDistanceMetres: number;
  mode: "clearance" | "restricted";
  passageIds: string[];
};

export type RoutePlanningFailure = "outside-region" | "destination-on-land" | "too-far" | "no-route";
export type RoutePlanningResult = { route: PlannedRoute; failure?: never } | { route?: never; failure: RoutePlanningFailure };

const METRES_PER_LATITUDE_DEGREE = 110_540;
const KNOTS_TO_METRES_PER_SECOND = 0.514444;
const MAXIMUM_ROUTE_VALIDATION_SPACING_METRES = 40;
export const ROUTE_CLEARANCE_MARGIN_METRES = 50;

export function getPreferredRouteClearanceMetres(clearanceMetres: number) {
  return Math.max(0, Number.isFinite(clearanceMetres) ? clearanceMetres : 0) + ROUTE_CLEARANCE_MARGIN_METRES;
}

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

/** Travel time selects the route; clearance and distance break ETA ties. */
export function comparePlannedRoutes(left: PlannedRoute, right: PlannedRoute, clearanceMetres: number) {
  const timeDifference = left.estimatedSeconds - right.estimatedSeconds;
  if (Math.abs(timeDifference) > 1) return timeDifference < 0 ? -1 : 1;
  const preferredClearance = getPreferredRouteClearanceMetres(clearanceMetres);
  // Conditional passages already carry a manually verified centreline through
  // their unavoidable bottleneck. Treat that centreline as the safest possible
  // geometry for candidate ordering, then let ETA decide whether it beats the
  // open-water alternative.
  const leftClearance = left.passageIds.length > 0
    ? preferredClearance
    : Math.min(preferredClearance, left.minimumShoreDistanceMetres);
  const rightClearance = right.passageIds.length > 0
    ? preferredClearance
    : Math.min(preferredClearance, right.minimumShoreDistanceMetres);
  const clearanceDifference = leftClearance - rightClearance;
  if (Math.abs(clearanceDifference) > 1) return clearanceDifference > 0 ? -1 : 1;
  return left.distanceMetres - right.distanceMetres;
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

export function getStartFixCorrectionTolerance(startAccuracyMetres: number | undefined) {
  if (typeof startAccuracyMetres !== "number"
    || !Number.isFinite(startAccuracyMetres)
    || startAccuracyMetres <= 0
    || startAccuracyMetres > MAXIMUM_NAVIGATION_ACCURACY_METRES) return 0;
  return Math.min(100, startAccuracyMetres * 8);
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
type EndpointCandidate = { key: number; connectionDistance: number };
type RouteSearchGeometry = { points: GeoPoint[]; passageIds: string[] };

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

function isPointStrictlyOnLand(pack: CoastlinePack, point: GeoPoint) {
  return intervalContains(
    getLandIntervalsAtLatitude(pack, point.latitude, pack.bounds[0], pack.bounds[2]),
    point.longitude,
  );
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

function initialSegmentExitsLandOnce(pack: CoastlinePack, start: GeoPoint, end: GeoPoint) {
  if (!isPointOnLand(pack, start.longitude, start.latitude)
    || isPointOnLand(pack, end.longitude, end.latitude)) return false;

  // The offline rings can overlap within their three-metre simplification
  // tolerance. Treat any resulting land re-entry as ambiguous even when the
  // explicit segment intersections themselves appear monotonic.
  const sampleCount = Math.max(2, Math.ceil(geoDistanceMetres(start, end)));
  let sampledWater = false;
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const point = interpolate(start, end, sample / sampleCount);
    const land = isPointOnLand(pack, point.longitude, point.latitude);
    if (!land) sampledWater = true;
    else if (sampledWater) return false;
  }
  if (!sampledWater) return false;

  const scale = longitudeScale((start.latitude + end.latitude) / 2);
  const routeX = (end.longitude - start.longitude) * scale;
  const routeY = (end.latitude - start.latitude) * METRES_PER_LATITUDE_DEGREE;
  const routeLengthSquared = routeX * routeX + routeY * routeY;
  if (routeLengthSquared <= 0) return false;
  const cross = (leftX: number, leftY: number, rightX: number, rightY: number) => leftX * rightY - leftY * rightX;
  const parameters: number[] = [];
  let ambiguous = false;
  const minimumX = Math.floor(Math.min(start.longitude, end.longitude) / pack.cellSize);
  const maximumX = Math.floor(Math.max(start.longitude, end.longitude) / pack.cellSize);
  const minimumY = Math.floor(Math.min(start.latitude, end.latitude) / pack.cellSize);
  const maximumY = Math.floor(Math.max(start.latitude, end.latitude) / pack.cellSize);

  for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      const values = pack.cells[`${cellX}:${cellY}`];
      if (!values) continue;
      for (let index = 0; index < values.length; index += 4) {
        const shoreX = (values[index] - start.longitude) * scale;
        const shoreY = (values[index + 1] - start.latitude) * METRES_PER_LATITUDE_DEGREE;
        const shoreDeltaX = (values[index + 2] - values[index]) * scale;
        const shoreDeltaY = (values[index + 3] - values[index + 1]) * METRES_PER_LATITUDE_DEGREE;
        const denominator = cross(routeX, routeY, shoreDeltaX, shoreDeltaY);
        if (Math.abs(denominator) <= 1e-8) {
          const distanceFromRoute = Math.abs(cross(shoreX, shoreY, routeX, routeY)) / Math.sqrt(routeLengthSquared);
          const shoreStartPosition = (shoreX * routeX + shoreY * routeY) / routeLengthSquared;
          const shoreEndPosition = ((shoreX + shoreDeltaX) * routeX + (shoreY + shoreDeltaY) * routeY) / routeLengthSquared;
          const overlapsRoute = Math.max(0, Math.min(shoreStartPosition, shoreEndPosition))
            <= Math.min(1, Math.max(shoreStartPosition, shoreEndPosition));
          if (distanceFromRoute <= 0.01 && overlapsRoute) ambiguous = true;
          continue;
        }
        const position = cross(shoreX, shoreY, shoreDeltaX, shoreDeltaY) / denominator;
        const shorePosition = cross(shoreX, shoreY, routeX, routeY) / denominator;
        if (position >= -1e-10 && position <= 1 + 1e-10
          && shorePosition >= -1e-10 && shorePosition <= 1 + 1e-10) {
          parameters.push(Math.max(0, Math.min(1, position)));
        }
      }
    }
  }
  if (ambiguous) return false;
  parameters.sort((left, right) => left - right);
  const uniqueParameters = parameters.filter((position, index) => index === 0 || position - parameters[index - 1] > 1e-8);
  if (uniqueParameters.length === 0) return false;
  const boundaries = [0, ...uniqueParameters.filter((position) => position > 1e-10 && position < 1 - 1e-10), 1];
  const intervalStates: boolean[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    if (boundaries[index] - boundaries[index - 1] <= 1e-10) continue;
    const midpoint = interpolate(start, end, (boundaries[index - 1] + boundaries[index]) / 2);
    intervalStates.push(isPointStrictlyOnLand(pack, midpoint));
  }
  if (intervalStates.length < 2 || !intervalStates[0] || intervalStates.at(-1)) return false;
  let reachedWater = false;
  for (const land of intervalStates) {
    if (!land) reachedWater = true;
    else if (reachedWater) return false;
  }
  return reachedWater;
}

function passageIdsForGeometry(points: GeoPoint[]) {
  const ids = new Set<string>();
  for (let index = 1; index < points.length; index += 1) {
    for (const passage of ROUTE_PASSAGE_HINTS) {
      if (segmentsIntersect(points[index - 1], points[index], passage.gate[0], passage.gate[1])) ids.add(passage.id);
    }
  }
  return [...ids];
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

export function routeGeometryIsWaterOnly(
  pack: CoastlinePack,
  points: GeoPoint[],
  allowedInitialLandExitMetres = 0,
) {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (index === 1
      && allowedInitialLandExitMetres > 0
      && isPointOnLand(pack, start.longitude, start.latitude)
      && geoDistanceMetres(start, end) <= allowedInitialLandExitMetres
      && initialSegmentExitsLandOnce(pack, start, end)) continue;
    if (routeSegmentCrossesShoreline(pack, start, end)) return false;
  }
  return true;
}

function resolveWaterStartAnchor(
  pack: CoastlinePack,
  start: GeoPoint,
  toleranceMetres: number,
) {
  if (toleranceMetres <= 0) return null;
  const shore = findNearestShore(pack, start.longitude, start.latitude);
  if (!shore || shore.distance + 4 > toleranceMetres) return null;

  // The nearest shoreline point is still geometrically ambiguous. Step a few
  // metres beyond it along the outward bearing, then retain the candidate only
  // when the existing one-time land-exit validator proves the whole correction.
  for (let overrunMetres = 4; overrunMetres <= toleranceMetres - shore.distance; overrunMetres += 4) {
    const candidate = offsetFromShore(shore, shore.bearing, overrunMetres);
    if (isPointOnLand(pack, candidate.longitude, candidate.latitude)) continue;
    if (geoDistanceMetres(start, candidate) > toleranceMetres) continue;
    if (!routeGeometryIsWaterOnly(pack, [start, candidate], toleranceMetres)) continue;
    return candidate;
  }
  return null;
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
  passageIds: string[] = [],
) {
  let distanceMetres = 0;
  let estimatedSeconds = 0;
  let minimumShoreDistanceMetres = Number.POSITIVE_INFINITY;
  let restrictedDistanceMetres = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = geoDistanceMetres(start, end);
    const validationSpacing = Math.min(
      MAXIMUM_ROUTE_VALIDATION_SPACING_METRES,
      Math.max(10, options.clearanceMetres / 8),
    );
    const samples = Math.max(1, Math.ceil(distance / validationSpacing));
    const sampleSpacing = distance / samples;
    let restrictedSamples = 0;
    for (let sample = 0; sample < samples; sample += 1) {
      const samplePoint = interpolate(start, end, (sample + 0.5) / samples);
      const shore = findNearestShore(pack, samplePoint.longitude, samplePoint.latitude);
      if (!shore) continue;
      // Distance to a fixed geometry is 1-Lipschitz. Subtracting half the
      // sample interval therefore gives a conservative lower bound for every
      // point between adjacent samples instead of trusting the midpoint alone.
      const conservativeDistance = Math.max(0, shore.distance - sampleSpacing / 2);
      minimumShoreDistanceMetres = Math.min(minimumShoreDistanceMetres, conservativeDistance);
      if (conservativeDistance < options.clearanceMetres) restrictedSamples += 1;
    }
    const restrictedFraction = Math.min(1, restrictedSamples / samples);
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
    passageIds,
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
    conditionalPassagesEnabled: rawOptions.conditionalPassagesEnabled ?? true,
  };
  const preferredClearance = getPreferredRouteClearanceMetres(options.clearanceMetres);
  const insideBounds = (point: GeoPoint) => point.longitude >= pack.bounds[0] && point.longitude <= pack.bounds[2]
    && point.latitude >= pack.bounds[1] && point.latitude <= pack.bounds[3];
  if (!insideBounds(start) || !insideBounds(destination)) return { failure: "outside-region" };
  if (isPointOnLand(pack, destination.longitude, destination.latitude)) return { failure: "destination-on-land" };
  const directDistance = geoDistanceMetres(start, destination);
  if (directDistance > options.maximumDistanceMetres) return { failure: "too-far" };
  const startIsLand = isPointOnLand(pack, start.longitude, start.latitude);
  // A phone fix can land a few metres inside the charted shoreline while the
  // boat is still afloat. Permit one short, outward-only correction from that
  // start; destinations and all later route legs remain strictly water-only.
  const startSnapTolerance = getStartFixCorrectionTolerance(options.startAccuracyMetres);
  if (directDistance < 30) {
    const directPoints = [start, destination];
    if (!routeGeometryIsWaterOnly(pack, directPoints, startIsLand ? startSnapTolerance : 0)) return { failure: "no-route" };
    const passageIds = passageIdsForGeometry(directPoints);
    if (passageIds.length > 0 && !options.conditionalPassagesEnabled) return { failure: "no-route" };
    const route = buildRoute(pack, directPoints, options, "clearance", passageIds);
    route.mode = route.restrictedDistanceMetres > 0 || passageIds.length > 0 ? "restricted" : "clearance";
    return { route };
  }

  const startAnchor = startIsLand ? resolveWaterStartAnchor(pack, start, startSnapTolerance) : null;
  if (startIsLand && !startAnchor) return { failure: "no-route" };
  const routingStart = startAnchor ?? start;
  const startCorrectionDistance = startAnchor ? geoDistanceMetres(start, startAnchor) : 0;

  const centreLatitude = (start.latitude + destination.latitude) / 2;
  const metresPerLongitudeDegree = longitudeScale(centreLatitude);
  const origin = routingStart;
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

  const search = (margin: number, cellSize: number, allowRestricted: boolean): RouteSearchGeometry | null => {
    const minimumX = Math.max(packWest, Math.min(startLocal.x, destinationLocal.x) - margin);
    const maximumX = Math.min(packEast, Math.max(startLocal.x, destinationLocal.x) + margin);
    const minimumY = Math.max(packSouth, Math.min(startLocal.y, destinationLocal.y) - margin);
    const maximumY = Math.min(packNorth, Math.max(startLocal.y, destinationLocal.y) + margin);
    const width = maximumX - minimumX;
    const height = maximumY - minimumY;
    const columns = Math.max(3, Math.floor(width / cellSize) + 1);
    const rows = Math.max(3, Math.floor(height / cellSize) + 1);
    const gridNodeCount = columns * rows;
    const pointFor = (column: number, row: number) => toGeo({ x: minimumX + column * cellSize, y: minimumY + row * cellSize });
    const nearestIndex = (point: LocalPoint) => ({
      column: Math.max(0, Math.min(columns - 1, Math.round((point.x - minimumX) / cellSize))),
      row: Math.max(0, Math.min(rows - 1, Math.round((point.y - minimumY) / cellSize))),
    });
    const endpointGrace = Math.max(preferredClearance * 1.2, cellSize * 1.8);
    // The fixed 50 m margin is the desired navigational clearance. Segment
    // validation below adds its own sampling guard; inflating node clearance
    // by half a cell would incorrectly erase real but narrow channels.
    const routedClearance = preferredClearance;
    const nodeCache = new Map<number, NodeInfo>();
    const landIntervalsByRow = new Map<number, LongitudeInterval[]>();
    const minimumLongitude = toGeo({ x: minimumX - cellSize, y: 0 }).longitude;
    const maximumLongitude = toGeo({ x: maximumX + cellSize, y: 0 }).longitude;
    const activePassages = options.conditionalPassagesEnabled && allowRestricted
      ? ROUTE_PASSAGE_HINTS.filter((passage) => passage.points.every((point) => {
        const local = toLocal(point);
        return local.x >= minimumX && local.x <= maximumX && local.y >= minimumY && local.y <= maximumY;
      }) && routeGeometryIsWaterOnly(pack, passage.points))
      : [];
    const passageNodes = activePassages.flatMap((passage) => passage.points.map((point, pointIndex) => ({
      passageId: passage.id,
      pointIndex,
      point,
    })));
    const passageGateAllowed = options.conditionalPassagesEnabled && allowRestricted;
    const passageIdsCrossedBySegment = (segmentStart: GeoPoint, segmentEnd: GeoPoint) => ROUTE_PASSAGE_HINTS
      .filter((passage) => segmentsIntersect(segmentStart, segmentEnd, passage.gate[0], passage.gate[1]))
      .map((passage) => passage.id);
    const crossesBlockedPassageGate = (segmentStart: GeoPoint, segmentEnd: GeoPoint) => !passageGateAllowed
      && passageIdsCrossedBySegment(segmentStart, segmentEnd).length > 0;
    const node = (key: number) => {
      const cached = nodeCache.get(key);
      if (cached) return cached;
      if (key >= gridNodeCount) {
        const passageNode = passageNodes[key - gridNodeCount];
        if (!passageNode) throw new Error("Invalid passage node");
        const land = isPointOnLand(pack, passageNode.point.longitude, passageNode.point.latitude);
        const value = {
          point: passageNode.point,
          land,
          shoreDistance: land ? 0 : shorelineDistanceWithin(pack, passageNode.point, routedClearance * 1.8),
        };
        nodeCache.set(key, value);
        return value;
      }
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

    const endpointCandidates = (point: GeoPoint, pointLocal: LocalPoint) => {
      const centreIndex = nearestIndex(pointLocal);
      const connectionLimit = Math.max(cellSize * 3.25, 180);
      const radius = Math.max(1, Math.ceil(connectionLimit / cellSize));
      const candidates: EndpointCandidate[] = [];
      for (let row = Math.max(0, centreIndex.row - radius); row <= Math.min(rows - 1, centreIndex.row + radius); row += 1) {
        for (let column = Math.max(0, centreIndex.column - radius); column <= Math.min(columns - 1, centreIndex.column + radius); column += 1) {
          const key = row * columns + column;
          const candidate = node(key);
          if (candidate.land) continue;
          const connectionDistance = geoDistanceMetres(point, candidate.point);
          if (connectionDistance > connectionLimit) continue;
          if (routeSegmentCrossesShoreline(pack, point, candidate.point)) continue;
          if (crossesBlockedPassageGate(point, candidate.point)) continue;
          candidates.push({ key, connectionDistance });
        }
      }
      // Multi-source/multi-target anchoring prevents a narrow inlet from being
      // lost merely because the nearest grid centre happens to lie on land.
      return candidates.sort((left, right) => left.connectionDistance - right.connectionDistance).slice(0, 40);
    };

    const startCandidates = endpointCandidates(routingStart, startLocal);
    const destinationCandidates = endpointCandidates(destination, destinationLocal);
    if (startCandidates.length === 0 || destinationCandidates.length === 0) return null;
    const destinationConnections = new Map<number, number>();
    for (const candidate of destinationCandidates) {
      const current = destinationConnections.get(candidate.key);
      if (current === undefined || candidate.connectionDistance < current) destinationConnections.set(candidate.key, candidate.connectionDistance);
    }
    const nearEndpoint = (point: GeoPoint) => geoDistanceMetres(point, routingStart) <= endpointGrace || geoDistanceMetres(point, destination) <= endpointGrace;
    const passageConnections = new Map<number, number[]>();
    const addPassageConnection = (gridKey: number, passageKey: number) => {
      passageConnections.set(gridKey, [...(passageConnections.get(gridKey) ?? []), passageKey]);
      passageConnections.set(passageKey, [...(passageConnections.get(passageKey) ?? []), gridKey]);
    };
    let passageOffset = 0;
    for (const passage of activePassages) {
      for (const passageIndex of [0, passage.points.length - 1]) {
        const passageKey = gridNodeCount + passageOffset + passageIndex;
        const passagePoint = passage.points[passageIndex];
        const centreIndex = nearestIndex(toLocal(passagePoint));
        const connectionLimit = Math.max(350, cellSize * 3.25);
        const radius = Math.max(1, Math.ceil(connectionLimit / cellSize));
        for (let row = Math.max(0, centreIndex.row - radius); row <= Math.min(rows - 1, centreIndex.row + radius); row += 1) {
          for (let column = Math.max(0, centreIndex.column - radius); column <= Math.min(columns - 1, centreIndex.column + radius); column += 1) {
            const gridKey = row * columns + column;
            const candidate = node(gridKey);
            if (candidate.land || geoDistanceMetres(candidate.point, passagePoint) > connectionLimit) continue;
            if (routeSegmentCrossesShoreline(pack, candidate.point, passagePoint)) continue;
            addPassageConnection(gridKey, passageKey);
          }
        }
      }
      passageOffset += passage.points.length;
    }
    const open = new MinHeap();
    const totalNodeCount = gridNodeCount + passageNodes.length;
    const costs = new Float64Array(totalNodeCount);
    costs.fill(Number.POSITIVE_INFINITY);
    const previous = new Int32Array(totalNodeCount);
    previous.fill(-1);
    for (const candidate of startCandidates) {
      // Keep a chart-adjusted start expensive so it is used only when the live
      // fix genuinely needs the bounded one-time recovery.
      const cruiseSpeed = options.cruiseSpeedKnots * KNOTS_TO_METRES_PER_SECOND;
      const cost = (startCorrectionDistance * 6 + candidate.connectionDistance) / cruiseSpeed;
      if (cost >= costs[candidate.key]) continue;
      costs[candidate.key] = cost;
      previous[candidate.key] = -2;
      open.push({ key: candidate.key, score: cost + geoDistanceMetres(node(candidate.key).point, destination) / cruiseSpeed });
    }
    const closed = new Uint8Array(totalNodeCount);
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
      const neighbourKeys: number[] = [];
      if (currentEntry.key < gridNodeCount) {
        const currentRow = Math.floor(currentEntry.key / columns);
        const currentColumn = currentEntry.key % columns;
        for (const rowStep of directions) for (const columnStep of directions) {
          if (rowStep === 0 && columnStep === 0) continue;
          const nextRow = currentRow + rowStep;
          const nextColumn = currentColumn + columnStep;
          if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
          neighbourKeys.push(nextRow * columns + nextColumn);
        }
      } else {
        const passageNodeIndex = currentEntry.key - gridNodeCount;
        const passageNode = passageNodes[passageNodeIndex];
        const previousPassageNode = passageNodes[passageNodeIndex - 1];
        const nextPassageNode = passageNodes[passageNodeIndex + 1];
        if (previousPassageNode?.passageId === passageNode.passageId) neighbourKeys.push(currentEntry.key - 1);
        if (nextPassageNode?.passageId === passageNode.passageId) neighbourKeys.push(currentEntry.key + 1);
      }
      neighbourKeys.push(...(passageConnections.get(currentEntry.key) ?? []));

      for (const nextKey of neighbourKeys) {
        if (closed[nextKey]) continue;
        const next = node(nextKey);
        if (next.land) continue;
        const current = node(currentEntry.key);
        // Grid nodes keep an extra half-cell margin so an edge between two safe
        // nodes cannot silently shave the configured shoreline clearance.
        const restricted = Math.min(current.shoreDistance, next.shoreDistance) < routedClearance;
        if (restricted && !allowRestricted && !nearEndpoint(next.point)) continue;
        const edgeId = currentEntry.key < nextKey ? `${currentEntry.key}:${nextKey}` : `${nextKey}:${currentEntry.key}`;
        let edgeBlocked = edgeCache.get(edgeId);
        if (edgeBlocked === undefined) {
          edgeBlocked = routeSegmentCrossesShoreline(pack, current.point, next.point)
            || crossesBlockedPassageGate(current.point, next.point);
          edgeCache.set(edgeId, edgeBlocked);
        }
        if (edgeBlocked) continue;
        // Diagonal movement is valid when the sampled segment itself remains
        // in water. Requiring both neighbouring square cells to be water used
        // to reject real angled channels and Croatian island narrows.
        const stepDistance = geoDistanceMetres(current.point, next.point);
        const edgeClearance = Math.min(current.shoreDistance, next.shoreDistance);
        const preferredShortfall = Math.max(0, 1 - edgeClearance / Math.max(1, routedClearance));
        const configuredShortfall = options.clearanceMetres <= 0
          ? 0
          : Math.max(0, 1 - edgeClearance / options.clearanceMetres);
        // Passage hints represent intentionally selected narrow waterways. Do
        // not apply the generic shoreline-avoidance multiplier to their
        // validated centreline, or A* will always prefer a many-mile detour.
        // The resulting route is still measured and labelled restricted.
        const passageEdge = currentEntry.key >= gridNodeCount || nextKey >= gridNodeCount;
        // Actual travel seconds remain the base cost. The safety multiplier
        // only guides ordinary raster edges toward their widest clearance.
        const edgeSpeedKnots = options.speedWarningEnabled && edgeClearance < options.clearanceMetres
          ? options.nearShoreSpeedKnots
          : options.cruiseSpeedKnots;
        const travelSeconds = stepDistance / (edgeSpeedKnots * KNOTS_TO_METRES_PER_SECOND);
        // The actual speed limit remains the dominant cost. A bounded
        // clearance nudge centers unavoidable narrows without turning a few
        // metres of extra clearance into a multi-mile detour.
        const penalty = passageEdge
          ? 1
          : 1 + configuredShortfall * 0.75 + preferredShortfall * 0.1;
        const nextCost = costs[currentEntry.key] + travelSeconds * penalty;
        if (nextCost >= costs[nextKey]) continue;
        costs[nextKey] = nextCost;
        previous[nextKey] = currentEntry.key;
        const optimisticSeconds = geoDistanceMetres(next.point, destination)
          / (options.cruiseSpeedKnots * KNOTS_TO_METRES_PER_SECOND);
        open.push({ key: nextKey, score: nextCost + optimisticSeconds });
      }
    }

    if (reachedKey < 0) return null;
    const reversed: GeoPoint[] = [];
    const usedPassageIds = new Set<string>();
    let key = reachedKey;
    while (key >= 0) {
      reversed.push(node(key).point);
      if (key >= gridNodeCount) usedPassageIds.add(passageNodes[key - gridNodeCount].passageId);
      key = previous[key];
      if (key === -2) break;
      if (key < 0) return null;
    }
    const rawPoints = [start, ...(startAnchor ? [startAnchor] : []), ...reversed.reverse(), destination]
      .filter((point, index, routePoints) => index === 0 || geoDistanceMetres(routePoints[index - 1], point) > 0.5);
    if (!routeGeometryIsWaterOnly(pack, rawPoints, startIsLand ? startSnapTolerance : 0)) return null;
    for (const passageId of passageIdsForGeometry(rawPoints)) usedPassageIds.add(passageId);
    if (usedPassageIds.size > 0 && !passageGateAllowed) return null;

    // A* operates on a raster, so its raw result contains staircase turns.
    // Greedily remove waypoints only where the complete shortcut remains in
    // water. Conditional-passage centre lines and the one-time GPS land-exit
    // correction stay protected and therefore cannot be skipped.
    const protectedIndices = new Set<number>([0, rawPoints.length - 1]);
    if (startAnchor) protectedIndices.add(1);
    for (let index = 0; index < rawPoints.length; index += 1) {
      if (ROUTE_PASSAGE_HINTS.some((passage) => passage.points.some((point) => geoDistanceMetres(point, rawPoints[index]) < 0.5))) {
        protectedIndices.add(index);
      }
    }
    const protectedStops = [...protectedIndices].sort((left, right) => left - right);
    const simplified: GeoPoint[] = [rawPoints[0]];
    const shortcutAllowed = (fromIndex: number, toIndex: number) => {
      const from = rawPoints[fromIndex];
      const to = rawPoints[toIndex];
      if (routeSegmentCrossesShoreline(pack, from, to) || crossesBlockedPassageGate(from, to)) return false;
      const distance = geoDistanceMetres(from, to);
      const samples = Math.max(1, Math.ceil(distance / MAXIMUM_ROUTE_VALIDATION_SPACING_METRES));
      const spacing = distance / samples;
      const rawClearance = allowRestricted
        ? rawPoints.slice(fromIndex, toIndex + 1).reduce(
          (minimum, point) => Math.min(minimum, shorelineDistanceWithin(pack, point, routedClearance * 1.8)),
          routedClearance,
        )
        : routedClearance;
      for (let sample = 0; sample < samples; sample += 1) {
        const samplePoint = interpolate(from, to, (sample + 0.5) / samples);
        if (nearEndpoint(samplePoint)) continue;
        // A shortcut may never reduce the clearance already achieved by A*.
        // This keeps the centered medial-axis section of an unavoidable
        // bottleneck instead of smoothing it back toward either shoreline.
        const required = Math.max(0, rawClearance - cellSize * 0.35) + spacing / 2;
        if (shorelineDistanceWithin(pack, samplePoint, required) + 0.01 < required) return false;
      }
      return true;
    };
    for (let stopIndex = 1; stopIndex < protectedStops.length; stopIndex += 1) {
      const stop = protectedStops[stopIndex];
      let anchor = protectedStops[stopIndex - 1];
      while (anchor < stop) {
        let next = stop;
        while (next > anchor + 1 && !shortcutAllowed(anchor, next)) next -= 1;
        simplified.push(rawPoints[next]);
        anchor = next;
      }
    }
    const compact: GeoPoint[] = [simplified[0]];
    for (let index = 1; index < simplified.length - 1; index += 1) {
      const point = simplified[index];
      const protectedPoint = (startAnchor && geoDistanceMetres(startAnchor, point) < 0.5)
        || ROUTE_PASSAGE_HINTS.some((passage) => passage.points.some((passagePoint) => geoDistanceMetres(passagePoint, point) < 0.5));
      const previousPoint = compact.at(-1) as GeoPoint;
      const nextPoint = simplified[index + 1];
      const deviation = distanceToSegment(point.longitude, point.latitude, [
        previousPoint.longitude,
        previousPoint.latitude,
        nextPoint.longitude,
        nextPoint.latitude,
      ]).distance;
      if (protectedPoint || deviation > 0.5) compact.push(point);
    }
    compact.push(simplified.at(-1) as GeoPoint);
    if (!routeGeometryIsWaterOnly(pack, compact, startIsLand ? startSnapTolerance : 0)) return null;
    return { points: compact, passageIds: [...usedPassageIds] };
  };

  const searchAreas = margins.map((margin) => {
    const width = Math.min(packEast, Math.max(startLocal.x, destinationLocal.x) + margin)
      - Math.max(packWest, Math.min(startLocal.x, destinationLocal.x) - margin);
    const height = Math.min(packNorth, Math.max(startLocal.y, destinationLocal.y) + margin)
      - Math.max(packSouth, Math.min(startLocal.y, destinationLocal.y) - margin);
    return { margin, width, height, resolutions: getRouteGridResolutions(width, height, options.clearanceMetres) };
  });
  type MeasuredCandidate = { geometry: RouteSearchGeometry; route: PlannedRoute };
  const measuredCandidates: MeasuredCandidate[] = [];
  const bestMeasuredCandidate = () => measuredCandidates.reduce<MeasuredCandidate | null>(
    (best, candidate) => !best || comparePlannedRoutes(candidate.route, best.route, options.clearanceMetres) < 0
      ? candidate
      : best,
    null,
  );
  const consider = (geometry: RouteSearchGeometry | null) => {
    if (!geometry) return;
    const route = buildRoute(pack, geometry.points, options, "restricted", geometry.passageIds);
    route.mode = route.restrictedDistanceMetres > 0 || route.passageIds.length > 0 ? "restricted" : "clearance";
    measuredCandidates.push({ geometry, route });
  };

  // Compare strict and restricted A* candidates instead of returning the
  // first coarse path. This prevents a technically clear but enormous detour
  // from hiding an enabled, much shorter conditional passage.
  for (const { margin, resolutions } of searchAreas) {
    const coarse = resolutions[0];
    consider(search(margin, coarse, false));
    consider(search(margin, coarse, true));
    const best = bestMeasuredCandidate();
    if (best && best.route.distanceMetres <= directDistance * 1.3) break;
  }

  // Refine only bounded search spaces. The fine pass improves real narrows
  // without allowing a whole-archipelago raster to stall a phone.
  const coarseBest = bestMeasuredCandidate();
  if (!coarseBest
    || coarseBest.route.distanceMetres > directDistance * 2.25
    || coarseBest.route.minimumShoreDistanceMetres < preferredClearance + ROUTE_CLEARANCE_MARGIN_METRES) {
    for (const { margin, width, height, resolutions } of searchAreas) {
      const fine = resolutions.at(-1) as number;
      if (fine === resolutions[0] || width * height / (fine * fine) > 85_000) continue;
      consider(search(margin, fine, false));
      consider(search(margin, fine, true));
      const best = bestMeasuredCandidate();
      if (best && best.route.distanceMetres <= directDistance * 1.15) break;
    }
  }

  const bestCandidate = bestMeasuredCandidate();
  if (!bestCandidate) return { failure: "no-route" };
  const rawResult = bestCandidate.geometry;
  if (!routeGeometryIsWaterOnly(pack, rawResult.points, startIsLand ? startSnapTolerance : 0)) return { failure: "no-route" };
  const route = bestCandidate.route;
  // Endpoint grace helps with normal GPS drift close to shore, but the result
  // must still be labelled restricted whenever the measured route enters the
  // configured clearance zone.
  route.mode = route.restrictedDistanceMetres > 0 || route.passageIds.length > 0 ? "restricted" : "clearance";
  return { route };
}
