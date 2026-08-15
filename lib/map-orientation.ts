export type MapPoint = { x: number; y: number };

export function normalizeMapHeading(heading: number | null | undefined) {
  if (typeof heading !== "number" || !Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

export function getMapOrientation(heading: number | null | undefined, headingUp: boolean) {
  const normalizedHeading = normalizeMapHeading(heading);
  return {
    mapRotationDegrees: headingUp ? -normalizedHeading : 0,
    boatRotationDegrees: headingUp ? 0 : normalizedHeading,
  };
}

export function rotateMapPoint(point: MapPoint, pivot: MapPoint, degrees: number): MapPoint {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const offsetX = point.x - pivot.x;
  const offsetY = point.y - pivot.y;
  return {
    x: pivot.x + offsetX * cosine - offsetY * sine,
    y: pivot.y + offsetX * sine + offsetY * cosine,
  };
}

export function rotateMapDelta(delta: MapPoint, degrees: number): MapPoint {
  return rotateMapPoint(delta, { x: 0, y: 0 }, degrees);
}
