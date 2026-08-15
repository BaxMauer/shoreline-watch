import type { GeoPoint } from "./route-planning.ts";

export type WindSample = {
  speedKnots: number;
  directionDegrees: number;
  gustKnots: number;
  observedAt: string;
  fetchedAt: number;
};

export function buildWindRequestUrl(point: GeoPoint) {
  const parameters = new URLSearchParams({
    latitude: point.latitude.toFixed(5),
    longitude: point.longitude.toFixed(5),
    current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    wind_speed_unit: "kn",
    timezone: "UTC",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${parameters}`;
}

export function parseWindSample(payload: unknown, fetchedAt = Date.now()): WindSample | null {
  if (!payload || typeof payload !== "object") return null;
  const current = (payload as { current?: unknown }).current;
  if (!current || typeof current !== "object") return null;
  const values = current as Record<string, unknown>;
  const speedKnots = Number(values.wind_speed_10m);
  const directionDegrees = Number(values.wind_direction_10m);
  const gustKnots = Number(values.wind_gusts_10m);
  const observedAt = values.time;
  if (![speedKnots, directionDegrees, gustKnots].every(Number.isFinite) || typeof observedAt !== "string") return null;
  return {
    speedKnots: Math.max(0, speedKnots),
    directionDegrees: ((directionDegrees % 360) + 360) % 360,
    gustKnots: Math.max(0, gustKnots),
    observedAt,
    fetchedAt,
  };
}

export function windCellKey(point: GeoPoint) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return `${(Math.round(point.latitude * 20) / 20).toFixed(2)}:${(Math.round(point.longitude * 20) / 20).toFixed(2)}`;
}

export function windSampleCanBeReused(sample: WindSample, now = Date.now()) {
  return Number.isFinite(sample.fetchedAt) && now >= sample.fetchedAt && now - sample.fetchedAt <= 3 * 60 * 60 * 1_000;
}

export function windFlowAngleRadians(directionDegrees: number) {
  return ((directionDegrees + 90) % 360) * Math.PI / 180;
}

export function windCompassLabel(directionDegrees: number, language: "de" | "en") {
  const labels = language === "de"
    ? ["N", "NO", "O", "SO", "S", "SW", "W", "NW"]
    : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(((directionDegrees % 360) + 360) % 360 / 45) % 8];
}
