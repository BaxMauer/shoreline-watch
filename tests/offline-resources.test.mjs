import assert from "node:assert/strict";
import test from "node:test";
import { OFFLINE_DATA_CACHE, loadPersistentJson } from "../lib/offline-resources.ts";

function installCacheStorage(context, cacheStorage) {
  Object.defineProperty(globalThis, "caches", { configurable: true, value: cacheStorage });
  context.after(() => { delete globalThis.caches; });
}

test("persistent JSON resources are read from Cache Storage without a network request", async (context) => {
  let networkRequests = 0;
  const cache = {
    match: async (url) => url === "/data/test.json"
      ? new Response(JSON.stringify({ source: "cache" }), { headers: { "content-type": "application/json" } })
      : undefined,
    put: async () => undefined,
  };
  installCacheStorage(context, { open: async (name) => {
    assert.equal(name, OFFLINE_DATA_CACHE);
    return cache;
  } });

  const value = await loadPersistentJson("/data/test.json", async () => {
    networkRequests += 1;
    return new Response("{}");
  });

  assert.deepEqual(value, { source: "cache" });
  assert.equal(networkRequests, 0);
});

test("persistent JSON resources are stored after the first successful download", async (context) => {
  const stored = [];
  const cache = {
    match: async () => undefined,
    put: async (url, response) => stored.push([url, await response.json()]),
  };
  installCacheStorage(context, { open: async () => cache });

  const value = await loadPersistentJson("/data/test.json", async () => new Response(
    JSON.stringify({ source: "network" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));

  assert.deepEqual(value, { source: "network" });
  assert.deepEqual(stored, [["/data/test.json", { source: "network" }]]);
});
