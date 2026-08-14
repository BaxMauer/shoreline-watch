import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/depth/route.ts";

test("depth API gives each upstream fallback a fresh timeout signal", async () => {
  const originalFetch = globalThis.fetch;
  const signals = [];
  let call = 0;
  globalThis.fetch = async (_input, init) => {
    signals.push(init.signal);
    call += 1;
    if (call === 1) return new Response("REST timeout", { status: 504 });
    return Response.json({ features: [{ properties: { Depth: -7.376 } }] });
  };
  try {
    const response = await GET(new Request("https://boot.example/api/depth?latitude=43.829022&longitude=15.607251"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { depthMetres: 7.376, state: "ready" });
    assert.equal(signals.length, 2);
    assert.notEqual(signals[0], signals[1]);
    assert.match(response.headers.get("cache-control"), /public/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unavailable depth cells are never cached", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ features: [] });
  try {
    const response = await GET(new Request("https://boot.example/api/depth?latitude=43.829022&longitude=15.607251"));
    assert.deepEqual(await response.json(), { depthMetres: null, state: "unavailable" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
