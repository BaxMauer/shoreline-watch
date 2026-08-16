import { geoDistanceMetres, type GeoPoint } from "./route-planning.ts";

export type AnchorWatch = {
  point: GeoPoint;
  setAt: number;
  bayName?: string | null;
  islandName?: string | null;
};

export function createAnchorWatch(
  point: GeoPoint,
  setAt = Date.now(),
  place: { bayName?: string | null; islandName?: string | null } = {},
): AnchorWatch | null {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return {
    point: { latitude: point.latitude, longitude: point.longitude },
    setAt,
    bayName: place.bayName ?? null,
    islandName: place.islandName ?? null,
  };
}

export function getAnchorWatchSnapshot(anchor: AnchorWatch | null, current: GeoPoint | null, radiusMetres: number, accuracyMetres = 0) {
  const radius = Math.max(1, Number.isFinite(radiusMetres) ? radiusMetres : 30);
  if (!anchor || !current) return { distanceMetres: null, radiusMetres: radius, breached: false };
  const distanceMetres = geoDistanceMetres(anchor.point, current);
  const allowance = Math.max(0, Number.isFinite(accuracyMetres) ? accuracyMetres : 0);
  return { distanceMetres, radiusMetres: radius, breached: distanceMetres > radius + allowance };
}

export function shouldSoundAnchorDriftAlarm(
  breached: boolean,
  previousBreached: boolean,
  now: number,
  lastAlarmAt: number | null,
  reminderMs = 30_000,
) {
  if (!breached) return false;
  if (!previousBreached || lastAlarmAt === null) return true;
  return now - lastAlarmAt >= Math.max(5_000, reminderMs);
}
