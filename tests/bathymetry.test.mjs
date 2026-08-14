import assert from "node:assert/strict";
import test from "node:test";
import {
  EMODNET_DEPTH_GRID_RESOLUTION_METRES,
  buildCurrentDepthRequestUrl,
  depthSampleCellKey,
  formatCurrentDepth,
  parseEmodnetWaterDepth,
} from "../lib/bathymetry.ts";

test("EMODnet elevation samples become positive water depths only below LAT", () => {
  assert.equal(parseEmodnetWaterDepth({ features: [{ properties: { Depth: -82.60656 } }] }), 82.60656);
  assert.equal(parseEmodnetWaterDepth({ avg: -7.376, smoothed: -6.76 }), 7.376);
  assert.equal(parseEmodnetWaterDepth({ smoothed: -31.25 }), 31.25);
  assert.equal(parseEmodnetWaterDepth({ avg: 2.75 }), null);
  assert.equal(parseEmodnetWaterDepth({ avg: 0 }), null);
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

test("current chart depth is formatted compactly for both languages", () => {
  assert.equal(formatCurrentDepth(7.376, "de"), "7,4");
  assert.equal(formatCurrentDepth(7.376, "en"), "7.4");
  assert.equal(formatCurrentDepth(123.6, "de"), "124");
  assert.equal(formatCurrentDepth(null, "de"), "—");
});
