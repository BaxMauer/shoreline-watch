import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("manifest exposes a scoped standalone PWA with PNG icons", async () => {
  const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));

  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })),
    [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  );
});

test("PWA and Apple touch icons are real PNG assets", async () => {
  for (const path of [
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "public/icons/apple-touch-icon.png",
  ]) {
    const icon = await readFile(path);
    assert.ok(icon.subarray(0, 8).equals(PNG_SIGNATURE), `${path} is not a PNG`);
  }
});

test("service worker precaches the complete install shell", async () => {
  const serviceWorker = await readFile("public/sw.js", "utf8");

  for (const asset of [
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/apple-touch-icon.png",
    "/data/croatia-coastline.json",
    "/audio/shoreline-alarm.wav",
  ]) {
    assert.match(serviceWorker, new RegExp(asset.replaceAll("/", "\\/")));
  }
});
