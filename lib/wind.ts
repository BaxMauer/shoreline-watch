import type { GeoPoint } from "./route-planning.ts";

export type WindSample = {
  speedKnots: number;
  directionDegrees: number;
  gustKnots: number;
  observedAt: string;
  fetchedAt: number;
  cellKey?: string;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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

export function buildWindProxyRequestUrl(point: GeoPoint) {
  const parameters = new URLSearchParams({
    latitude: point.latitude.toFixed(5),
    longitude: point.longitude.toFixed(5),
  });
  return `/api/wind?${parameters}`;
}

export function parseWindSample(payload: unknown, fetchedAt = Date.now()): WindSample | null {
  if (!payload || typeof payload !== "object") return null;
  const current = (payload as { current?: unknown }).current;
  if (!current || typeof current !== "object") return null;
  const values = current as Record<string, unknown>;
  const speedKnots = finiteNumber(values.wind_speed_10m);
  const directionDegrees = finiteNumber(values.wind_direction_10m);
  const gustKnots = finiteNumber(values.wind_gusts_10m);
  const observedAt = values.time;
  if (speedKnots === null || directionDegrees === null || gustKnots === null || typeof observedAt !== "string") return null;
  return {
    speedKnots: Math.max(0, speedKnots),
    directionDegrees: ((directionDegrees % 360) + 360) % 360,
    gustKnots: Math.max(0, gustKnots),
    observedAt,
    fetchedAt,
  };
}

export function parseWindProxyResponse(payload: unknown): WindSample | null {
  if (!payload || typeof payload !== "object") return null;
  const sample = (payload as { sample?: unknown }).sample;
  if (!sample || typeof sample !== "object") return null;
  const values = sample as Record<string, unknown>;
  const speedKnots = finiteNumber(values.speedKnots);
  const directionDegrees = finiteNumber(values.directionDegrees);
  const gustKnots = finiteNumber(values.gustKnots);
  const fetchedAt = finiteNumber(values.fetchedAt);
  if (speedKnots === null || directionDegrees === null || gustKnots === null || fetchedAt === null || typeof values.observedAt !== "string") return null;
  return {
    speedKnots: Math.max(0, speedKnots),
    directionDegrees: ((directionDegrees % 360) + 360) % 360,
    gustKnots: Math.max(0, gustKnots),
    observedAt: values.observedAt,
    fetchedAt,
  };
}

export async function fetchMapWindSample(
  point: GeoPoint,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  signal?: AbortSignal,
) {
  try {
    const response = await fetcher(buildWindProxyRequestUrl(point), { signal, cache: "no-store" });
    if (response.ok) {
      const sample = parseWindProxyResponse(await response.json());
      if (sample) return sample;
    }
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }

  const response = await fetcher(buildWindRequestUrl(point), { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Wind unavailable");
  const sample = parseWindSample(await response.json());
  if (!sample) throw new Error("Wind unavailable");
  return sample;
}

export function windCellKey(point: GeoPoint) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return `${(Math.round(point.latitude * 20) / 20).toFixed(2)}:${(Math.round(point.longitude * 20) / 20).toFixed(2)}`;
}

export function windSampleCanBeReused(sample: WindSample, now = Date.now(), cellKey?: string | null) {
  return Number.isFinite(sample.fetchedAt)
    && (!cellKey || sample.cellKey === cellKey)
    && now >= sample.fetchedAt
    && now - sample.fetchedAt <= 3 * 60 * 60 * 1_000;
}

export function windFlowAngleRadians(directionDegrees: number) {
  return ((directionDegrees + 90) % 360) * Math.PI / 180;
}

export function windFlowSpeedPixelsPerSecond(speedKnots: number, gustKnots = speedKnots) {
  const sustained = Math.max(0, speedKnots);
  const gustLift = Math.max(0, gustKnots - sustained) * .45;
  if (sustained < 1) return 0;
  return Math.min(105, 16 + sustained * 2.6 + gustLift);
}

export function windCompassLabel(directionDegrees: number, language: "de" | "en") {
  const labels = language === "de"
    ? ["N", "NO", "O", "SO", "S", "SW", "W", "NW"]
    : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(((directionDegrees % 360) + 360) % 360 / 45) % 8];
}
