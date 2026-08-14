import type { GeoPoint } from "./route-planning.ts";

export const EMODNET_DEPTH_SAMPLE_ORIGIN = "https://ows.emodnet-bathymetry.eu";
export const EMODNET_DEPTH_REST_ORIGIN = "https://rest.emodnet-bathymetry.eu";
export const EMODNET_DEPTH_GRID_RESOLUTION_METRES = 115;

export type CurrentDepthState = "idle" | "loading" | "ready" | "unavailable" | "error";

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseEmodnetWaterDepth(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const sample = payload as Record<string, unknown>;
  const features = Array.isArray(sample.features) ? sample.features : [];
  const firstFeature = features[0] && typeof features[0] === "object" ? features[0] as Record<string, unknown> : null;
  const properties = firstFeature?.properties && typeof firstFeature.properties === "object"
    ? firstFeature.properties as Record<string, unknown>
    : null;
  const elevation = finiteNumber(properties?.Depth) ?? finiteNumber(sample.avg) ?? finiteNumber(sample.smoothed);
  if (elevation === null || elevation >= 0) return null;
  return Math.abs(elevation);
}

export function depthSampleCellKey(point: GeoPoint) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return `${point.latitude.toFixed(3)}:${point.longitude.toFixed(3)}`;
}

export function buildCurrentDepthRequestUrl(point: GeoPoint) {
  const halfCellDegrees = 0.0005;
  const parameters = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: "emodnet:mean",
    QUERY_LAYERS: "emodnet:mean",
    STYLES: "",
    BBOX: [
      point.longitude - halfCellDegrees,
      point.latitude - halfCellDegrees,
      point.longitude + halfCellDegrees,
      point.latitude + halfCellDegrees,
    ].map((value) => value.toFixed(6)).join(","),
    WIDTH: "101",
    HEIGHT: "101",
    SRS: "EPSG:4326",
    X: "50",
    Y: "50",
    INFO_FORMAT: "application/json",
    FEATURE_COUNT: "1",
  });
  return `${EMODNET_DEPTH_SAMPLE_ORIGIN}/wms?${parameters.toString()}`;
}

export function buildEmodnetDepthSampleUrl(point: GeoPoint) {
  const parameters = new URLSearchParams({
    geom: `POINT(${point.longitude} ${point.latitude})`,
  });
  return `${EMODNET_DEPTH_REST_ORIGIN}/depth_sample?${parameters.toString()}`;
}

export function buildCurrentDepthProxyUrl(point: GeoPoint) {
  const parameters = new URLSearchParams({
    latitude: point.latitude.toString(),
    longitude: point.longitude.toString(),
  });
  return `/api/depth?${parameters.toString()}`;
}

export function parseCurrentDepthProxyPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const depthMetres = finiteNumber((payload as Record<string, unknown>).depthMetres);
  return depthMetres !== null && depthMetres >= 0 ? depthMetres : null;
}

export async function fetchEmodnetWaterDepth(
  point: GeoPoint,
  fetcher: typeof fetch = fetch,
) {
  let upstreamFailure: unknown = null;
  for (const url of [buildEmodnetDepthSampleUrl(point), buildCurrentDepthRequestUrl(point)]) {
    try {
      const response = await fetcher(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Depth request returned ${response.status}`);
      const depth = parseEmodnetWaterDepth(await response.json());
      if (depth !== null) return depth;
    } catch (error) {
      upstreamFailure = error;
    }
  }
  if (upstreamFailure) throw upstreamFailure;
  return null;
}

export async function fetchCurrentWaterDepth(
  point: GeoPoint,
  fetcher: typeof fetch = fetch,
) {
  const readDepth = async (url: string, parse: (payload: unknown) => number | null) => {
    const response = await fetcher(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Depth request returned ${response.status}`);
    const depth = parse(await response.json());
    if (depth === null) throw new Error("No water depth in this grid cell");
    return depth;
  };
  return Promise.any([
    readDepth(buildCurrentDepthProxyUrl(point), parseCurrentDepthProxyPayload),
    readDepth(buildCurrentDepthRequestUrl(point), parseEmodnetWaterDepth),
  ]);
}

export function formatCurrentDepth(depthMetres: number | null, language: "de" | "en") {
  if (depthMetres === null || !Number.isFinite(depthMetres) || depthMetres < 0) return "—";
  return new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
    maximumFractionDigits: depthMetres < 100 ? 1 : 0,
    minimumFractionDigits: depthMetres < 10 ? 1 : 0,
  }).format(depthMetres);
}
