export type GoNoGoState = "go" | "no-go" | "unknown";
export type PowerSaveReason = "far-shore" | "stationary" | null;

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
  speedMetresPerSecond,
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
  speedMetresPerSecond: number | null;
  lastMovementAt: number;
  stationaryAfterMinutes: number;
  alertActive: boolean;
  wakeUntil: number;
  now: number;
}): PowerSaveReason {
  if (!enabled || !tracking || !gpsIsFresh || distanceMetres === null || alertActive || wakeUntil > now) return null;
  if (distanceMetres >= farDistanceMetres) return "far-shore";
  const stationaryLongEnough = speedMetresPerSecond !== null
    && speedMetresPerSecond < 0.5
    && now - lastMovementAt >= stationaryAfterMinutes * 60_000;
  return stationaryLongEnough ? "stationary" : null;
}
