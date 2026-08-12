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
