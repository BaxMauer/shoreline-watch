import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

function distanceToSegment(longitude, latitude, segment) {
  const metresPerLongitudeDegree = 111320 * Math.cos((latitude * Math.PI) / 180);
  const metresPerLatitudeDegree = 110540;
  const [lon1, lat1, lon2, lat2] = segment;
  const x1 = (lon1 - longitude) * metresPerLongitudeDegree;
  const y1 = (lat1 - latitude) * metresPerLatitudeDegree;
  const x2 = (lon2 - longitude) * metresPerLongitudeDegree;
  const y2 = (lat2 - latitude) * metresPerLatitudeDegree;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / denominator));
  return Math.hypot(x1 + t * dx, y1 + t * dy);
}

test("point-to-segment distance is measured in metres", () => {
  const distance = distanceToSegment(15, 44.001, [14.99, 44, 15.01, 44]);
  assert.ok(distance > 109 && distance < 112);
});

test("Croatian coastline pack contains every coastal region", async () => {
  const pack = JSON.parse(await readFile(new URL("../public/data/croatia-coastline.json", import.meta.url), "utf8"));
  assert.equal(pack.schemaVersion, 1);
  assert.equal(pack.region, "Croatia");
  assert.ok(pack.segmentCount > 250_000);
  assert.ok(Object.keys(pack.cells).length > 1_500);
  assert.ok(pack.bounds[0] < 13.6);
  assert.ok(pack.bounds[2] > 18.5);
  assert.ok(pack.bounds[1] < 42.4);
  assert.ok(pack.bounds[3] > 45.4);
});
