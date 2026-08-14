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
  lastFixTimestamp: number;
  movingCandidateSince: number | null;
};

export type AnchorTimerBlocker = "disabled" | "not-live" | "gps" | "alert" | "wake-window" | null;

const MOVING_SPEED_METRES_PER_SECOND = 0.8;
const MOVING_CONFIRMATION_MS = 3_000;

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

export function createStationaryState(now = 0): StationaryState {
  return { reference: null, lastMovementAt: now, lastFixTimestamp: 0, movingCandidateSince: null };
}

export function distanceFromStationaryReference(state: StationaryState, position: StationaryPosition) {
  return state.reference ? distanceBetweenMetres(state.reference, position) : null;
}

export function updateStationaryState(
  state: StationaryState,
  position: StationaryPosition,
  anchorRadiusMetres: number,
  observedAt = position.timestamp,
): StationaryState {
  if (position.timestamp <= state.lastFixTimestamp) return state;
  if (!state.reference) return {
    reference: position,
    lastMovementAt: observedAt,
    lastFixTimestamp: position.timestamp,
    movingCandidateSince: null,
  };

  const accuracyAllowance = Math.max(0, state.reference.accuracy) + Math.max(0, position.accuracy);
  const outsideAnchorCircle = distanceBetweenMetres(state.reference, position)
    > Math.max(0, anchorRadiusMetres) + accuracyAllowance;
  const movingBySpeed = position.speed !== null && position.speed >= MOVING_SPEED_METRES_PER_SECOND;
  const movingCandidateSince = movingBySpeed
    ? state.movingCandidateSince ?? observedAt
    : null;
  const sustainedMovement = movingCandidateSince !== null
    && observedAt - movingCandidateSince >= MOVING_CONFIRMATION_MS;

  return outsideAnchorCircle || sustainedMovement
    ? {
        reference: position,
        lastMovementAt: observedAt,
        lastFixTimestamp: position.timestamp,
        movingCandidateSince: null,
      }
    : { ...state, lastFixTimestamp: position.timestamp, movingCandidateSince };
}

export function getAnchorTimerSnapshot({
  enabled,
  tracking,
  gpsIsReliable,
  lastMovementAt,
  stationaryAfterMinutes,
  alertActive,
  wakeUntil,
  now,
}: {
  enabled: boolean;
  tracking: boolean;
  gpsIsReliable: boolean;
  lastMovementAt: number;
  stationaryAfterMinutes: number;
  alertActive: boolean;
  wakeUntil: number;
  now: number;
}) {
  const thresholdMs = Math.max(0, stationaryAfterMinutes) * 60_000;
  const elapsedMs = Math.max(0, now - lastMovementAt);
  const remainingMs = Math.max(0, thresholdMs - elapsedMs);
  const blocker: AnchorTimerBlocker = !enabled
    ? "disabled"
    : !tracking
      ? "not-live"
      : !gpsIsReliable
        ? "gps"
        : alertActive
          ? "alert"
          : wakeUntil > now
            ? "wake-window"
            : null;
  return {
    thresholdMs,
    elapsedMs,
    remainingMs,
    blocker,
    eligible: blocker === null,
    active: blocker === null && remainingMs === 0,
  };
}

export function getGoNoGoState(
  conservativeDistanceMetres: number | null,
  warningDistanceMetres: number,
  gpsIsReliable: boolean,
  warningZoneInside: boolean | null = null,
): GoNoGoState {
  if (!gpsIsReliable || conservativeDistanceMetres === null) return "unknown";
  const inside = warningZoneInside ?? conservativeDistanceMetres < warningDistanceMetres;
  return inside ? "no-go" : "go";
}

export function getPlotRangeMetres(nearestDistanceMetres: number | null, warningDistanceMetres: number) {
  const warningRange = Math.max(1, warningDistanceMetres) * 1.35;
  if (nearestDistanceMetres === null || !Number.isFinite(nearestDistanceMetres)) return warningRange;
  return Math.max(warningRange, Math.max(0, nearestDistanceMetres) * 1.18 + 50);
}

export function getPowerSaveReason({
  enabled,
  tracking,
  gpsIsReliable,
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
  gpsIsReliable: boolean;
  distanceMetres: number | null;
  farDistanceMetres: number;
  lastMovementAt: number;
  stationaryAfterMinutes: number;
  alertActive: boolean;
  wakeUntil: number;
  now: number;
}): PowerSaveReason {
  if (distanceMetres === null) return null;
  const anchorTimer = getAnchorTimerSnapshot({
    enabled,
    tracking,
    gpsIsReliable,
    lastMovementAt,
    stationaryAfterMinutes,
    alertActive,
    wakeUntil,
    now,
  });
  if (!anchorTimer.eligible) return null;
  if (distanceMetres >= farDistanceMetres) return "far-shore";
  return anchorTimer.active ? "stationary" : null;
}
