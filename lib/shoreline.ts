export type CoastlinePack = {
  schemaVersion: number;
  region: string;
  generatedAt: string;
  source: string;
  sourceUrl: string;
  attribution: string;
  cellSize: number;
  simplifyToleranceMeters: number;
  bounds: [number, number, number, number];
  segmentCount: number;
  cells: Record<string, number[]>;
};

export type NearestShore = {
  distance: number;
  longitude: number;
  latitude: number;
  bearing: number;
};

export type ShorelineSegment = readonly [number, number, number, number];

export type CourseToShore = {
  distance: number;
  longitude: number;
  latitude: number;
};

const METRES_PER_LATITUDE_DEGREE = 110_540;

export function distanceToSegment(
  longitude: number,
  latitude: number,
  segment: readonly [number, number, number, number],
) {
  const metresPerLongitudeDegree = 111_320 * Math.cos((latitude * Math.PI) / 180);
  const [lon1, lat1, lon2, lat2] = segment;
  const x1 = (lon1 - longitude) * metresPerLongitudeDegree;
  const y1 = (lat1 - latitude) * METRES_PER_LATITUDE_DEGREE;
  const x2 = (lon2 - longitude) * metresPerLongitudeDegree;
  const y2 = (lat2 - latitude) * METRES_PER_LATITUDE_DEGREE;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / denominator));
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  const distance = Math.hypot(nearestX, nearestY);
  const nearestLongitude = longitude + nearestX / metresPerLongitudeDegree;
  const nearestLatitude = latitude + nearestY / METRES_PER_LATITUDE_DEGREE;
  const bearing = (Math.atan2(nearestX, nearestY) * 180) / Math.PI;

  return {
    distance,
    longitude: nearestLongitude,
    latitude: nearestLatitude,
    bearing: (bearing + 360) % 360,
  };
}

export function findNearestShore(pack: CoastlinePack, longitude: number, latitude: number): NearestShore | null {
  const [west, south, east, north] = pack.bounds;
  if (longitude < west - 0.5 || longitude > east + 0.5 || latitude < south - 0.5 || latitude > north + 0.5) {
    return null;
  }

  const cellX = Math.floor(longitude / pack.cellSize);
  const cellY = Math.floor(latitude / pack.cellSize);
  let nearest: NearestShore | null = null;
  const minimumCellSpan = pack.cellSize * 65_000;

  for (let ring = 0; ring <= 24; ring += 1) {
    for (let x = cellX - ring; x <= cellX + ring; x += 1) {
      for (let y = cellY - ring; y <= cellY + ring; y += 1) {
        if (ring > 0 && x !== cellX - ring && x !== cellX + ring && y !== cellY - ring && y !== cellY + ring) continue;
        const values = pack.cells[`${x}:${y}`];
        if (!values) continue;

        for (let index = 0; index < values.length; index += 4) {
          const candidate = distanceToSegment(longitude, latitude, [
            values[index],
            values[index + 1],
            values[index + 2],
            values[index + 3],
          ]);
          if (!nearest || candidate.distance < nearest.distance) nearest = candidate;
        }
      }
    }

    if (nearest && ring >= 2 && nearest.distance < (ring - 1) * minimumCellSpan) break;
  }

  return nearest;
}

export function getNearbyShorelineSegments(
  pack: CoastlinePack,
  longitude: number,
  latitude: number,
  radiusMetres: number,
  maximumSegments = 2_000,
): ShorelineSegment[] {
  const metresPerLongitudeDegree = 111_320 * Math.cos((latitude * Math.PI) / 180);
  const longitudeRadius = radiusMetres / metresPerLongitudeDegree;
  const latitudeRadius = radiusMetres / METRES_PER_LATITUDE_DEGREE;
  const minimumX = Math.floor((longitude - longitudeRadius) / pack.cellSize);
  const maximumX = Math.floor((longitude + longitudeRadius) / pack.cellSize);
  const minimumY = Math.floor((latitude - latitudeRadius) / pack.cellSize);
  const maximumY = Math.floor((latitude + latitudeRadius) / pack.cellSize);
  const unique = new Map<string, ShorelineSegment>();

  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      const values = pack.cells[`${x}:${y}`];
      if (!values) continue;

      for (let index = 0; index < values.length; index += 4) {
        const segment: ShorelineSegment = [
          values[index],
          values[index + 1],
          values[index + 2],
          values[index + 3],
        ];
        const key = segment.join(":");
        if (!unique.has(key)) unique.set(key, segment);
      }
    }
  }

  const segments = Array.from(unique.values()).filter(
    (segment) => distanceToSegment(longitude, latitude, segment).distance <= radiusMetres * 1.35,
  );
  if (segments.length <= maximumSegments) return segments;
  const step = segments.length / maximumSegments;
  return Array.from({ length: maximumSegments }, (_, index) => segments[Math.floor(index * step)]);
}

export function findCourseToShore(
  segments: ShorelineSegment[],
  longitude: number,
  latitude: number,
  heading: number,
): CourseToShore | null {
  const metresPerLongitudeDegree = 111_320 * Math.cos((latitude * Math.PI) / 180);
  const headingRadians = (heading * Math.PI) / 180;
  const directionX = Math.sin(headingRadians);
  const directionY = Math.cos(headingRadians);
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [longitude1, latitude1, longitude2, latitude2] of segments) {
    const startX = (longitude1 - longitude) * metresPerLongitudeDegree;
    const startY = (latitude1 - latitude) * METRES_PER_LATITUDE_DEGREE;
    const segmentX = (longitude2 - longitude1) * metresPerLongitudeDegree;
    const segmentY = (latitude2 - latitude1) * METRES_PER_LATITUDE_DEGREE;
    const denominator = directionX * segmentY - directionY * segmentX;
    if (Math.abs(denominator) < 0.000001) continue;

    const distanceAlongCourse = (startX * segmentY - startY * segmentX) / denominator;
    const positionOnSegment = (startX * directionY - startY * directionX) / denominator;
    if (distanceAlongCourse < 0 || positionOnSegment < 0 || positionOnSegment > 1) continue;
    if (distanceAlongCourse < nearestDistance) nearestDistance = distanceAlongCourse;
  }

  if (!Number.isFinite(nearestDistance)) return null;
  const east = directionX * nearestDistance;
  const north = directionY * nearestDistance;
  return {
    distance: nearestDistance,
    longitude: longitude + east / metresPerLongitudeDegree,
    latitude: latitude + north / METRES_PER_LATITUDE_DEGREE,
  };
}

export function offsetFromShore(shore: NearestShore, bearingFromShore: number, distance: number) {
  const radians = (bearingFromShore * Math.PI) / 180;
  const north = Math.cos(radians) * distance;
  const east = Math.sin(radians) * distance;
  const metresPerLongitudeDegree = 111_320 * Math.cos((shore.latitude * Math.PI) / 180);
  return {
    longitude: shore.longitude + east / metresPerLongitudeDegree,
    latitude: shore.latitude + north / METRES_PER_LATITUDE_DEGREE,
  };
}
