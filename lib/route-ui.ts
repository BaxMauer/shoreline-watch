import { geoDistanceMetres, type GeoPoint } from "./route-planning.ts";
import type { GpsNavigationState } from "./navigation-metrics.ts";

export const MINIMUM_ROUTE_VIEW_METRES = 2_500;
export const MAXIMUM_ROUTE_VIEW_METRES = 120_000;
export const MINIMUM_CRUISE_SPEED_KNOTS = 2;
export const MAXIMUM_CRUISE_SPEED_KNOTS = 60;

export type RouteReadinessState = "waiting" | "calculating" | "check" | "ready";
export type RouteGuidanceProjection = {
  progressMetres: number;
  distanceToRouteMetres: number;
  target: GeoPoint;
};

export function canPlanRoute(gpsNavigationState: GpsNavigationState, fix: GeoPoint | null) {
  return gpsNavigationState === "reliable" && fix !== null;
}

export function getRouteReadinessState({
  gpsNavigationState,
  planning,
  hasRoute,
  routeRestricted,
  hasFailure,
}: {
  gpsNavigationState: GpsNavigationState;
  planning: boolean;
  hasRoute: boolean;
  routeRestricted: boolean;
  hasFailure: boolean;
}): RouteReadinessState {
  if (gpsNavigationState !== "reliable") {
    return gpsNavigationState === "waiting" && !hasRoute ? "waiting" : "check";
  }
  if (planning) return "calculating";
  if (hasFailure || routeRestricted) return "check";
  return hasRoute ? "ready" : "waiting";
}

export function parseRouteCoordinate(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatRouteEta(seconds: number, minuteLabel: string) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const roundedMinutes = Math.max(1, Math.round(safeSeconds / 60));
  if (roundedMinutes < 60) return `${roundedMinutes} ${minuteLabel}`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")} h`;
}

export function formatRouteClearance(distance: number) {
  const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 0);
  return safeDistance >= 1_000 ? `${(safeDistance / 1_000).toFixed(1)} km` : `${Math.round(safeDistance)} m`;
}

export function clampRouteViewRange(value: number) {
  return Math.max(MINIMUM_ROUTE_VIEW_METRES, Math.min(MAXIMUM_ROUTE_VIEW_METRES, value));
}

export function routeViewRangeForTarget(current: number, start: GeoPoint, destination: GeoPoint) {
  return clampRouteViewRange(Math.max(current, geoDistanceMetres(start, destination) * 1.15));
}

export function clampCruiseSpeed(value: number) {
  return Math.max(MINIMUM_CRUISE_SPEED_KNOTS, Math.min(MAXIMUM_CRUISE_SPEED_KNOTS, value));
}

export function routeRerouteThreshold(clearanceMetres: number) {
  return Math.max(250, Math.max(0, clearanceMetres));
}

export function shouldRerouteRoute(plannedFrom: GeoPoint | null, current: GeoPoint, clearanceMetres: number) {
  return plannedFrom !== null && geoDistanceMetres(plannedFrom, current) >= routeRerouteThreshold(clearanceMetres);
}

function routeLocalPoint(point: GeoPoint, origin: GeoPoint) {
  return {
    x: (point.longitude - origin.longitude) * mapLongitudeScale(origin.latitude),
    y: (point.latitude - origin.latitude) * 110_540,
  };
}

function routePointAtProgress(points: GeoPoint[], segmentLengths: number[], progressMetres: number) {
  let elapsed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index];
    if (progressMetres <= elapsed + length || index === segmentLengths.length - 1) {
      const position = length > 0 ? Math.max(0, Math.min(1, (progressMetres - elapsed) / length)) : 0;
      return {
        longitude: points[index].longitude + (points[index + 1].longitude - points[index].longitude) * position,
        latitude: points[index].latitude + (points[index + 1].latitude - points[index].latitude) * position,
      };
    }
    elapsed += length;
  }
  return points.at(-1) as GeoPoint;
}

/**
 * Projects the current position onto the untraversed route and returns a
 * look-ahead point. minimumProgressMetres makes progress monotonic across GPS
 * updates, so a nearby waypoint that has already been passed cannot pull the
 * displayed course backward.
 */
export function getProgressAwareRouteGuidance(
  points: GeoPoint[],
  current: GeoPoint,
  minimumProgressMetres = 0,
  lookAheadMetres = 120,
): RouteGuidanceProjection | null {
  if (points.length < 2) return null;
  const segmentLengths = points.slice(0, -1).map((point, index) => geoDistanceMetres(point, points[index + 1]));
  const totalLength = segmentLengths.reduce((total, length) => total + length, 0);
  if (!Number.isFinite(totalLength) || totalLength <= 0) return null;
  const minimumProgress = Math.max(0, Math.min(totalLength, Number.isFinite(minimumProgressMetres) ? minimumProgressMetres : 0));
  const lookAhead = Math.max(0, Number.isFinite(lookAheadMetres) ? lookAheadMetres : 0);
  let elapsed = 0;
  let bestProgress = minimumProgress;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index];
    const segmentEnd = elapsed + length;
    if (length <= 0 || segmentEnd < minimumProgress) {
      elapsed = segmentEnd;
      continue;
    }
    const start = routeLocalPoint(points[index], current);
    const end = routeLocalPoint(points[index + 1], current);
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const projected = lengthSquared > 0 ? -(start.x * deltaX + start.y * deltaY) / lengthSquared : 0;
    const minimumPosition = Math.max(0, Math.min(1, (minimumProgress - elapsed) / length));
    const position = Math.max(minimumPosition, Math.min(1, projected));
    const offsetX = start.x + deltaX * position;
    const offsetY = start.y + deltaY * position;
    const distanceSquared = offsetX * offsetX + offsetY * offsetY;
    const progress = elapsed + length * position;
    if (distanceSquared < bestDistanceSquared || (distanceSquared === bestDistanceSquared && progress > bestProgress)) {
      bestDistanceSquared = distanceSquared;
      bestProgress = progress;
    }
    elapsed = segmentEnd;
  }

  const targetProgress = Math.min(totalLength, Math.max(minimumProgress, bestProgress) + lookAhead);
  return {
    progressMetres: Math.max(minimumProgress, bestProgress),
    distanceToRouteMetres: Math.sqrt(bestDistanceSquared),
    target: routePointAtProgress(points, segmentLengths, targetProgress),
  };
}

function mapLongitudeScale(latitude: number) {
  return 111_320 * Math.cos((latitude * Math.PI) / 180);
}

export function routeMapPixelToGeo(centre: GeoPoint, rangeMetres: number, size: number, x: number, y: number): GeoPoint {
  const half = size / 2;
  const safeRange = clampRouteViewRange(rangeMetres);
  const pixelsPerMetre = half / safeRange;
  return {
    longitude: centre.longitude + (x - half) / (mapLongitudeScale(centre.latitude) * pixelsPerMetre),
    latitude: centre.latitude + (half - y) / (110_540 * pixelsPerMetre),
  };
}

export function panRouteMapCentre(centre: GeoPoint, rangeMetres: number, size: number, deltaX: number, deltaY: number): GeoPoint {
  const half = size / 2;
  const pixelsPerMetre = half / clampRouteViewRange(rangeMetres);
  return {
    longitude: centre.longitude - deltaX / (mapLongitudeScale(centre.latitude) * pixelsPerMetre),
    latitude: centre.latitude + deltaY / (110_540 * pixelsPerMetre),
  };
}

export function pinchRouteViewRange(startRangeMetres: number, startDistance: number, currentDistance: number) {
  if (!Number.isFinite(startDistance) || !Number.isFinite(currentDistance) || startDistance <= 0 || currentDistance <= 0) {
    return clampRouteViewRange(startRangeMetres);
  }
  return clampRouteViewRange(startRangeMetres * startDistance / currentDistance);
}
