export const ROUTE_MAP_LONG_PRESS_MS = 650;
export const ROUTE_MAP_MOVE_TOLERANCE_PX = 7;
export const MINIMUM_DISTANCE_MAP_RANGE_METRES = 150;
export const MAXIMUM_DISTANCE_MAP_RANGE_METRES = 50_000;

export type DistanceMapPoint = {
  longitude: number;
  latitude: number;
};

export function clampDistanceMapRange(value: number, fallback = 500) {
  const range = Number.isFinite(value) ? value : fallback;
  return Math.max(MINIMUM_DISTANCE_MAP_RANGE_METRES, Math.min(MAXIMUM_DISTANCE_MAP_RANGE_METRES, range));
}

export function panDistanceMapCentre(
  centre: DistanceMapPoint,
  rangeMetres: number,
  size: number,
  deltaX: number,
  deltaY: number,
): DistanceMapPoint {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 360;
  const pixelsPerMetre = safeSize / 2 / clampDistanceMapRange(rangeMetres);
  const longitudeScale = Math.max(1, 111_320 * Math.cos((centre.latitude * Math.PI) / 180));
  return {
    longitude: centre.longitude - deltaX / (longitudeScale * pixelsPerMetre),
    latitude: centre.latitude + deltaY / (110_540 * pixelsPerMetre),
  };
}

export function pinchDistanceMapRange(startRangeMetres: number, startDistance: number, currentDistance: number) {
  if (!Number.isFinite(startDistance) || !Number.isFinite(currentDistance) || startDistance <= 0 || currentDistance <= 0) {
    return clampDistanceMapRange(startRangeMetres);
  }
  return clampDistanceMapRange(startRangeMetres * startDistance / currentDistance);
}

export function shouldCommitRouteMapLongPress({
  elapsedMs,
  moved,
  pointerCount,
  planning,
}: {
  elapsedMs: number;
  moved: boolean;
  pointerCount: number;
  planning: boolean;
}) {
  return planning
    && Number.isFinite(elapsedMs)
    && elapsedMs >= ROUTE_MAP_LONG_PRESS_MS
    && !moved
    && pointerCount === 1;
}
