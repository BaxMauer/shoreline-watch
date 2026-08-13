export type GpsSignalState = "fresh" | "waiting" | "stale" | "lost";
export type ClosingTrend = "approaching" | "receding" | "steady" | "unknown";

export type DistanceSample = {
  timestamp: number;
  distanceMetres: number;
};

export const GPS_STALE_AFTER_SECONDS = 10;
export const GPS_LOST_AFTER_SECONDS = 30;
export const GPS_INITIAL_FIX_TIMEOUT_SECONDS = 20;
export const MAXIMUM_NAVIGATION_ACCURACY_METRES = 50;

export type GpsNavigationState = "reliable" | "waiting" | "stale" | "lost" | "inaccurate";

export function isGpsAccuracyReliable(accuracyMetres: number | null | undefined) {
  return accuracyMetres !== null
    && accuracyMetres !== undefined
    && Number.isFinite(accuracyMetres)
    && accuracyMetres >= 0
    && accuracyMetres <= MAXIMUM_NAVIGATION_ACCURACY_METRES;
}

export function getGpsNavigationState(
  signalState: GpsSignalState,
  accuracyMetres: number | null | undefined,
): GpsNavigationState {
  if (signalState !== "fresh") return signalState;
  if (accuracyMetres === null || accuracyMetres === undefined) return "waiting";
  return isGpsAccuracyReliable(accuracyMetres) ? "reliable" : "inaccurate";
}

export function getGpsSignalState(
  live: boolean,
  fixTimestamp: number | null,
  trackingStartedAt: number | null,
  now: number,
): GpsSignalState {
  if (!live) return "fresh";
  if (fixTimestamp === null) {
    if (trackingStartedAt !== null && now - trackingStartedAt >= GPS_INITIAL_FIX_TIMEOUT_SECONDS * 1_000) return "lost";
    return "waiting";
  }
  const ageSeconds = Math.max(0, (now - fixTimestamp) / 1_000);
  if (ageSeconds >= GPS_LOST_AFTER_SECONDS) return "lost";
  if (ageSeconds >= GPS_STALE_AFTER_SECONDS) return "stale";
  return "fresh";
}

export function calculateClosingRate(samples: DistanceSample[]): number | null {
  const valid = samples.filter((sample) => Number.isFinite(sample.timestamp) && Number.isFinite(sample.distanceMetres));
  if (valid.length < 3) return null;
  const firstTimestamp = valid[0].timestamp;
  const elapsedSeconds = (valid.at(-1)!.timestamp - firstTimestamp) / 1_000;
  if (elapsedSeconds < 4) return null;

  const points = valid.map((sample) => ({
    x: (sample.timestamp - firstTimestamp) / 1_000,
    y: sample.distanceMetres,
  }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (denominator === 0) return null;

  const closingMetresPerSecond = -(numerator / denominator);
  return Math.abs(closingMetresPerSecond) <= 30 ? closingMetresPerSecond : null;
}

export function classifyClosingRate(rateMetresPerSecond: number | null): ClosingTrend {
  if (rateMetresPerSecond === null) return "unknown";
  if (rateMetresPerSecond >= 0.25) return "approaching";
  if (rateMetresPerSecond <= -0.25) return "receding";
  return "steady";
}

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function degrees(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function solarElevationDegrees(timestamp: number, latitude: number, longitude: number) {
  const daysSinceJ2000 = (timestamp - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  const meanLongitude = normalizeDegrees(280.46 + 0.9856474 * daysSinceJ2000);
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * daysSinceJ2000);
  const eclipticLongitude = normalizeDegrees(meanLongitude + 1.915 * Math.sin(radians(meanAnomaly)) + 0.02 * Math.sin(radians(2 * meanAnomaly)));
  const obliquity = 23.439 - 0.0000004 * daysSinceJ2000;
  const rightAscension = normalizeDegrees(degrees(Math.atan2(Math.cos(radians(obliquity)) * Math.sin(radians(eclipticLongitude)), Math.cos(radians(eclipticLongitude)))));
  const declination = Math.asin(Math.sin(radians(obliquity)) * Math.sin(radians(eclipticLongitude)));
  const siderealDegrees = normalizeDegrees((18.697374558 + 24.06570982441908 * daysSinceJ2000) * 15 + longitude);
  const hourAngle = radians(((siderealDegrees - rightAscension + 540) % 360) - 180);
  const latitudeRadians = radians(latitude);
  return degrees(Math.asin(
    Math.sin(latitudeRadians) * Math.sin(declination)
      + Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle),
  ));
}

export function shouldUseSunlightMode(enabled: boolean, timestamp: number, latitude: number | null, longitude: number | null) {
  if (!enabled || latitude === null || longitude === null) return false;
  return solarElevationDegrees(timestamp, latitude, longitude) >= 8;
}
