import { geoDistanceMetres, type GeoPoint } from "./route-planning.ts";

export type AnchorWatch = {
  point: GeoPoint;
  setAt: number;
};

export function createAnchorWatch(point: GeoPoint, setAt = Date.now()): AnchorWatch | null {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return { point: { latitude: point.latitude, longitude: point.longitude }, setAt };
}

export function getAnchorWatchSnapshot(anchor: AnchorWatch | null, current: GeoPoint | null, radiusMetres: number, accuracyMetres = 0) {
  const radius = Math.max(1, Number.isFinite(radiusMetres) ? radiusMetres : 30);
  if (!anchor || !current) return { distanceMetres: null, radiusMetres: radius, breached: false };
  const distanceMetres = geoDistanceMetres(anchor.point, current);
  const allowance = Math.max(0, Number.isFinite(accuracyMetres) ? accuracyMetres : 0);
  return { distanceMetres, radiusMetres: radius, breached: distanceMetres > radius + allowance };
}
