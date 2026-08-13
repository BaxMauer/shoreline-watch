export type GoNoGoState = "go" | "no-go" | "unknown";
export type PowerSaveReason = "far-shore" | "stationary" | null;
export type StationaryPosition = {
  longitude: number;
  latitude: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
};
export type StationaryState = {
  reference: StationaryPosition | null;
  lastMovementAt: number;
};
export type PlotPoint = { x: number; y: number };

const MOVING_SPEED_METRES_PER_SECOND = 0.5;

export function getLandHatchPolygon(
  start: PlotPoint,
  end: PlotPoint,
  boat: PlotPoint,
  depth = 520,
  overlap = 2,
): [PlotPoint, PlotPoint, PlotPoint, PlotPoint] | null {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(length) || length < 0.0001) return null;

  const tangentX = deltaX / length;
  const tangentY = deltaY / length;
  let normalX = -tangentY;
  let normalY = tangentX;
  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;

  // A boat using this view is assumed to be on the water. The land side of a
  // visible coastline segment is therefore the normal facing away from it.
  if (normalX * (midpointX - boat.x) + normalY * (midpointY - boat.y) < 0) {
    normalX *= -1;
    normalY *= -1;
  }

  const safeDepth = Math.max(0, Number.isFinite(depth) ? depth : 0);
  const safeOverlap = Math.max(0, Number.isFinite(overlap) ? overlap : 0);
  const coastStart = {
    x: start.x - tangentX * safeOverlap,
    y: start.y - tangentY * safeOverlap,
  };
  const coastEnd = {
    x: end.x + tangentX * safeOverlap,
    y: end.y + tangentY * safeOverlap,
  };

  const polygon: [PlotPoint, PlotPoint, PlotPoint, PlotPoint] = [
    coastStart,
    coastEnd,
    { x: coastEnd.x + normalX * safeDepth, y: coastEnd.y + normalY * safeDepth },
    { x: coastStart.x + normalX * safeDepth, y: coastStart.y + normalY * safeDepth },
  ];
  const signedArea = polygon.reduce((area, current, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + current.x * next.y - next.x * current.y;
  }, 0);
  return signedArea < 0
    ? [polygon[0], polygon[3], polygon[2], polygon[1]]
    : polygon;
}

function distanceBetweenMetres(left: StationaryPosition, right: StationaryPosition) {
  const earthRadiusMetres = 6_371_000;
  const latitudeDelta = ((right.latitude - left.latitude) * Math.PI) / 180;
  const longitudeDelta = ((right.longitude - left.longitude) * Math.PI) / 180;
  const leftLatitude = (left.latitude * Math.PI) / 180;
  const rightLatitude = (right.latitude * Math.PI) / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMetres * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function updateStationaryState(
  state: StationaryState,
  position: StationaryPosition,
  anchorRadiusMetres: number,
): StationaryState {
  if (!state.reference) return { reference: position, lastMovementAt: position.timestamp };
  if (position.timestamp <= state.reference.timestamp) return state;

  const accuracyAllowance = Math.max(0, state.reference.accuracy, position.accuracy);
  const outsideAnchorCircle = distanceBetweenMetres(state.reference, position)
    > Math.max(0, anchorRadiusMetres) + accuracyAllowance;
  const movingBySpeed = position.speed !== null && position.speed >= MOVING_SPEED_METRES_PER_SECOND;

  return outsideAnchorCircle || movingBySpeed
    ? { reference: position, lastMovementAt: position.timestamp }
    : state;
}

export function getGoNoGoState(
  conservativeDistanceMetres: number | null,
  warningDistanceMetres: number,
  gpsIsFresh: boolean,
): GoNoGoState {
  if (!gpsIsFresh || conservativeDistanceMetres === null) return "unknown";
  return conservativeDistanceMetres < warningDistanceMetres ? "no-go" : "go";
}

export function getPlotRangeMetres(nearestDistanceMetres: number | null, warningDistanceMetres: number) {
  const warningRange = Math.max(1, warningDistanceMetres) * 1.35;
  if (nearestDistanceMetres === null || !Number.isFinite(nearestDistanceMetres)) return warningRange;
  return Math.max(warningRange, Math.max(0, nearestDistanceMetres) * 1.18 + 50);
}

export function getPowerSaveReason({
  enabled,
  tracking,
  gpsIsFresh,
  distanceMetres,
  farDistanceMetres,
  lastMovementAt,
  stationaryAfterMinutes,
  alertActive,
  wakeUntil,
  now,
}: {
  enabled: boolean;
  tracking: boolean;
  gpsIsFresh: boolean;
  distanceMetres: number | null;
  farDistanceMetres: number;
  lastMovementAt: number;
  stationaryAfterMinutes: number;
  alertActive: boolean;
  wakeUntil: number;
  now: number;
}): PowerSaveReason {
  if (!enabled || !tracking || !gpsIsFresh || distanceMetres === null || alertActive || wakeUntil > now) return null;
  if (distanceMetres >= farDistanceMetres) return "far-shore";
  const stationaryLongEnough = now - lastMovementAt >= stationaryAfterMinutes * 60_000;
  return stationaryLongEnough ? "stationary" : null;
}
