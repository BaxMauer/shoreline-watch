import assert from "node:assert/strict";
import test from "node:test";
import {
  EMODNET_DEPTH_GRID_RESOLUTION_METRES,
  buildCurrentDepthProxyUrl,
  buildCurrentDepthRequestUrl,
  buildEmodnetDepthSampleUrl,
  depthSampleCellKey,
  fetchCurrentWaterDepth,
  fetchEmodnetWaterDepth,
  formatCurrentDepth,
  parseCurrentDepthProxyPayload,
  parseEmodnetWaterDepth,
} from "../lib/bathymetry.ts";

test("EMODnet WMS elevations and official positive REST samples become water depths", () => {
  assert.equal(parseEmodnetWaterDepth({ features: [{ properties: { Depth: -82.60656 } }] }), 82.60656);
  assert.equal(parseEmodnetWaterDepth({ features: [{ properties: { Depth: 2.75 } }] }), null);
  assert.equal(parseEmodnetWaterDepth({ avg: 31.25, smoothed: 30.95 }), 31.25);
  assert.equal(parseEmodnetWaterDepth({ avg: -7.376, smoothed: -6.76 }), 7.376);
  assert.equal(parseEmodnetWaterDepth({ smoothed: -31.25 }), 31.25);
  assert.equal(parseEmodnetWaterDepth({ avg: 0 }), 0);
  assert.equal(parseEmodnetWaterDepth({ avg: "-5" }), null);
  assert.equal(parseEmodnetWaterDepth(null), null);
});

test("depth requests use the official CORS-enabled EMODnet WMS point query", () => {
  const point = { longitude: 15.607251, latitude: 43.829022 };
  const url = new URL(buildCurrentDepthRequestUrl(point));
  assert.equal(url.origin, "https://ows.emodnet-bathymetry.eu");
  assert.equal(url.pathname, "/wms");
  assert.equal(url.searchParams.get("REQUEST"), "GetFeatureInfo");
  assert.equal(url.searchParams.get("LAYERS"), "emodnet:mean");
  assert.equal(url.searchParams.get("INFO_FORMAT"), "application/json");
  assert.equal(url.searchParams.get("BBOX"), "15.606751,43.828522,15.607751,43.829522");
  assert.equal(EMODNET_DEPTH_GRID_RESOLUTION_METRES, 115);
});

test("GPS fixes are sampled once per approximate EMODnet grid cell", () => {
  assert.equal(depthSampleCellKey({ latitude: 43.829022, longitude: 15.607251 }), "43.829:15.607");
  assert.equal(depthSampleCellKey({ latitude: 43.82904, longitude: 15.60729 }), "43.829:15.607");
  assert.equal(depthSampleCellKey({ latitude: Number.NaN, longitude: 15.6 }), null);
});

test("current depth uses a same-origin proxy while the server queries EMODnet REST", () => {
  const point = { longitude: 15.8074, latitude: 43.6946 };
  const proxy = new URL(buildCurrentDepthProxyUrl(point), "https://boot.example");
  assert.equal(proxy.origin, "https://boot.example");
  assert.equal(proxy.pathname, "/api/depth");
  assert.equal(proxy.searchParams.get("latitude"), "43.6946");
  assert.equal(proxy.searchParams.get("longitude"), "15.8074");

  const upstream = new URL(buildEmodnetDepthSampleUrl(point));
  assert.equal(upstream.origin, "https://rest.emodnet-bathymetry.eu");
  assert.equal(upstream.pathname, "/depth_sample");
  assert.equal(upstream.searchParams.get("geom"), "POINT(15.8074 43.6946)");
});

test("depth proxy payloads accept only finite non-negative metre values", () => {
  assert.equal(parseCurrentDepthProxyPayload({ depthMetres: 56.355 }), 56.355);
  assert.equal(parseCurrentDepthProxyPayload({ depthMetres: null }), null);
  assert.equal(parseCurrentDepthProxyPayload({ depthMetres: "56.355" }), null);
  assert.equal(parseCurrentDepthProxyPayload({ depthMetres: -2 }), null);
  assert.equal(parseCurrentDepthProxyPayload(null), null);
});

test("server-side depth lookup prefers REST and falls back to WMS", async () => {
  const point = { longitude: 15.8074, latitude: 43.6946 };
  const directCalls = [];
  const direct = await fetchEmodnetWaterDepth(point, async (url) => {
    directCalls.push(String(url));
    return Response.json({ avg: 56.355, smoothed: 55.9 });
  });
  assert.equal(direct, 56.355);
  assert.equal(directCalls.length, 1);
  assert.match(directCalls[0], /rest\.emodnet-bathymetry\.eu/);

  const fallbackCalls = [];
  const fallback = await fetchEmodnetWaterDepth(point, async (url) => {
    fallbackCalls.push(String(url));
    if (fallbackCalls.length === 1) return new Response("unavailable", { status: 503 });
    return Response.json({ features: [{ properties: { Depth: -12.4 } }] });
  });
  assert.equal(fallback, 12.4);
  assert.equal(fallbackCalls.length, 2);
  assert.match(fallbackCalls[1], /ows\.emodnet-bathymetry\.eu/);
});

test("browser depth lookup races the same-origin proxy with the CORS WMS fallback", async () => {
  const point = { longitude: 15.8074, latitude: 43.6946 };
  const calls = [];
  const depth = await fetchCurrentWaterDepth(point, async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("/api/depth")) return new Response("proxy unavailable", { status: 502 });
    return Response.json({ features: [{ properties: { Depth: -56.355 } }] });
  });
  assert.equal(depth, 56.355);
  assert.equal(calls.length, 2);
});

test("current chart depth is formatted compactly for both languages", () => {
  assert.equal(formatCurrentDepth(7.376, "de"), "7,4");
  assert.equal(formatCurrentDepth(7.376, "en"), "7.4");
  assert.equal(formatCurrentDepth(123.6, "de"), "124");
  assert.equal(formatCurrentDepth(null, "de"), "—");
});
