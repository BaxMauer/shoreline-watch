import { geoDistanceMetres, type GeoPoint } from "./route-planning.ts";
import type { GpsNavigationState } from "./navigation-metrics.ts";

export const MINIMUM_ROUTE_VIEW_METRES = 2_500;
export const MAXIMUM_ROUTE_VIEW_METRES = 120_000;
export const MINIMUM_CRUISE_SPEED_KNOTS = 2;
export const MAXIMUM_CRUISE_SPEED_KNOTS = 60;

export type RouteReadinessState = "waiting" | "calculating" | "check" | "ready";

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
