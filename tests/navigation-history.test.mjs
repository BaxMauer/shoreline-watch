import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NAVIGATION_HISTORY_ENTRIES,
  MAX_RESUMABLE_NAVIGATION_AGE_MS,
  addNavigationDestination,
  createActiveNavigationSession,
  createCoordinateDestination,
  createSearchDestination,
  parseActiveNavigationSession,
  parseNavigationHistory,
  touchActiveNavigationSession,
} from "../lib/navigation-history.ts";

function destination(name, selectedAt, id = name.toLowerCase()) {
  return createSearchDestination({
    id,
    name,
    detail: "Šibenik-Knin",
    kind: "place",
    source: "local",
    latitude: 43.8,
    longitude: 15.6,
  }, selectedAt);
}

test("destination history keeps the latest selection first and moves repeats to the top", () => {
  const murter = destination("Murter", 1_000, "local-murter");
  const tisno = destination("Tisno", 2_000, "local-tisno");
  const repeatedMurter = destination("Murter", 3_000, "osm-murter");
  const history = addNavigationDestination(addNavigationDestination(addNavigationDestination([], murter), tisno), repeatedMurter);

  assert.deepEqual(history.map(({ name, selectedAt }) => [name, selectedAt]), [
    ["Murter", 3_000],
    ["Tisno", 2_000],
  ]);
});

test("destination history is bounded and safely parses newest-first", () => {
  let history = [];
  for (let index = 0; index < MAX_NAVIGATION_HISTORY_ENTRIES + 4; index += 1) {
    history = addNavigationDestination(history, destination(`Place ${index}`, index));
  }
  assert.equal(history.length, MAX_NAVIGATION_HISTORY_ENTRIES);
  assert.equal(history[0]?.name, `Place ${MAX_NAVIGATION_HISTORY_ENTRIES + 3}`);

  const parsed = parseNavigationHistory(JSON.stringify([...history].reverse()));
  assert.deepEqual(parsed.map(({ name }) => name), history.map(({ name }) => name));
  assert.deepEqual(parseNavigationHistory("not-json"), []);
  assert.deepEqual(parseNavigationHistory(JSON.stringify([{ name: "Incomplete" }])), []);
});

test("coordinate destinations use stable labels and deduplicate nearby repeats", () => {
  const first = createCoordinateDestination({ latitude: 43.812345, longitude: 15.612345 }, 1_000);
  const repeated = createCoordinateDestination({ latitude: 43.812349, longitude: 15.612349 }, 2_000);
  const history = addNavigationDestination(addNavigationDestination([], first), repeated);

  assert.equal(history.length, 1);
  assert.equal(history[0]?.selectedAt, 2_000);
  assert.equal(history[0]?.kind, "coordinates");
});

test("only fresh active navigation sessions are offered after a restart", () => {
  const now = 2_000_000_000;
  const active = createActiveNavigationSession(destination("Žut", now - 5_000), now - 5_000, now - 60_000);
  assert.deepEqual(parseActiveNavigationSession(JSON.stringify(active), now), active);

  const touched = touchActiveNavigationSession(active, now - 1_000);
  assert.equal(touched.startedAt, active.startedAt);
  assert.equal(touched.updatedAt, now - 1_000);

  assert.equal(parseActiveNavigationSession(JSON.stringify({ ...active, updatedAt: now - MAX_RESUMABLE_NAVIGATION_AGE_MS - 1 }), now), null);
  assert.equal(parseActiveNavigationSession(JSON.stringify({ ...active, updatedAt: now + 60_001 }), now), null);
  assert.equal(parseActiveNavigationSession("{}", now), null);
  assert.equal(parseActiveNavigationSession("broken", now), null);
});
