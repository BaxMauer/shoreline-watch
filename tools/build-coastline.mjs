import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const counties = ["DNZ", "SDZ", "SKZ", "ZZ", "LSZ", "PGZ", "IZ"];
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public/data/croatia-coastline.json");
const cellSize = 0.025;
const simplifyToleranceMeters = 3;

function sqSegmentDistance(point, start, end, lat0) {
  const metresPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const metresPerLat = 110540;
  const px = point[0] * metresPerLon;
  const py = point[1] * metresPerLat;
  let x = start[0] * metresPerLon;
  let y = start[1] * metresPerLat;
  let dx = (end[0] - start[0]) * metresPerLon;
  let dy = (end[1] - start[1]) * metresPerLat;

  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0] * metresPerLon;
      y = end[1] * metresPerLat;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function simplifyStep(points, first, last, toleranceSq, lat0, keep) {
  let maxDistance = toleranceSq;
  let index = 0;

  for (let cursor = first + 1; cursor < last; cursor += 1) {
    const distance = sqSegmentDistance(points[cursor], points[first], points[last], lat0);
    if (distance > maxDistance) {
      index = cursor;
      maxDistance = distance;
    }
  }

  if (maxDistance > toleranceSq) {
    if (index - first > 1) simplifyStep(points, first, index, toleranceSq, lat0, keep);
    keep.push(points[index]);
    if (last - index > 1) simplifyStep(points, index, last, toleranceSq, lat0, keep);
  }
}

function simplify(points) {
  if (points.length <= 2) return points;
  const lat0 = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const keep = [points[0]];
  simplifyStep(points, 0, points.length - 1, simplifyToleranceMeters ** 2, lat0, keep);
  keep.push(points.at(-1));
  return keep;
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function addSegment(cells, segment) {
  const [lon1, lat1, lon2, lat2] = segment;
  const minX = Math.floor(Math.min(lon1, lon2) / cellSize);
  const maxX = Math.floor(Math.max(lon1, lon2) / cellSize);
  const minY = Math.floor(Math.min(lat1, lat2) / cellSize);
  const maxY = Math.floor(Math.max(lat1, lat2) / cellSize);

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const key = `${x}:${y}`;
      const values = cells[key] ?? [];
      values.push(lon1, lat1, lon2, lat2);
      cells[key] = values;
    }
  }
}

async function fetchCounty(code) {
  if (code === "LSZ") {
    const viewUrl = new URL("https://services8.arcgis.com/tDYJmhP975urQUZt/ArcGIS/rest/services/Obalna_crta_LSZ_view/FeatureServer/0/query");
    viewUrl.search = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
    }).toString();
    const viewResponse = await fetch(viewUrl, { signal: AbortSignal.timeout(120_000) });
    if (!viewResponse.ok) throw new Error(`${code} coastline request failed with ${viewResponse.status}`);
    return viewResponse.json();
  }

  const service = `Obalna_crta_${code}_WFS`;
  const url = new URL(`https://dservices8.arcgis.com/tDYJmhP975urQUZt/arcgis/services/${service}/WFSServer`);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `${service}:Obalna_crta_${code}`,
    outputFormat: "GEOJSON",
  }).toString();

  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${code} coastline request failed with ${response.status}`);
  return response.json();
}

const cells = {};
const bounds = [Infinity, Infinity, -Infinity, -Infinity];
let rawPointCount = 0;
let simplifiedPointCount = 0;
let segmentCount = 0;

for (const code of counties) {
  process.stdout.write(`Fetching ${code} coastline... `);
  const collection = await fetchCounty(code);

  for (const feature of collection.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const lines = geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates];

    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      rawPointCount += line.length;
      const simplified = simplify(line);
      simplifiedPointCount += simplified.length;

      for (let index = 1; index < simplified.length; index += 1) {
        const start = simplified[index - 1];
        const end = simplified[index];
        const segment = [round(start[0]), round(start[1]), round(end[0]), round(end[1])];
        bounds[0] = Math.min(bounds[0], segment[0], segment[2]);
        bounds[1] = Math.min(bounds[1], segment[1], segment[3]);
        bounds[2] = Math.max(bounds[2], segment[0], segment[2]);
        bounds[3] = Math.max(bounds[3], segment[1], segment[3]);
        addSegment(cells, segment);
        segmentCount += 1;
      }
    }
  }

  console.log("done");
}

const pack = {
  schemaVersion: 1,
  region: "Croatia",
  generatedAt: new Date().toISOString(),
  source: "Hydrographic Institute of the Republic of Croatia (HHI)",
  sourceUrl: "https://www.hhi.hr/en/news/javna-objava-obalne-crte-u-izdanju-hrvatskog-hidrografskog-instituta",
  attribution: "Coastline © Hydrographic Institute of the Republic of Croatia (HHI)",
  cellSize,
  simplifyToleranceMeters,
  bounds: bounds.map(round),
  segmentCount,
  cells,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(pack));

console.log(`Wrote ${output}`);
console.log(`${rawPointCount.toLocaleString()} points → ${simplifiedPointCount.toLocaleString()} points`);
console.log(`${segmentCount.toLocaleString()} segments across ${Object.keys(cells).length.toLocaleString()} cells`);
