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
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })),
    [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  );
});

test("manifest describes a German portrait navigation utility with matching colours", async () => {
  const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.name, "Shoreline Watch");
  assert.equal(manifest.short_name, "Shoreline");
  assert.equal(manifest.lang, "de");
  assert.equal(manifest.orientation, "portrait");
  assert.deepEqual(manifest.categories, ["navigation", "utilities"]);
  assert.equal(manifest.background_color, manifest.theme_color);
  assert.ok(manifest.description.toLowerCase().includes("offline"));
});

test("layout version-pins the manifest so Android cannot reuse a stale install definition", async () => {
  const layout = await readFile("app/layout.tsx", "utf8");
  assert.match(layout, /manifest:\s*["']\/manifest\.webmanifest\?v=17["']/);
});

test("PWA and Apple touch icons are real PNG assets", async () => {
  for (const [path, expectedSize] of [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/apple-touch-icon.png", 180],
  ]) {
    const icon = await readFile(path);
    assert.ok(icon.subarray(0, 8).equals(PNG_SIGNATURE), `${path} is not a PNG`);
    assert.equal(icon.readUInt32BE(16), expectedSize, `${path} width`);
    assert.equal(icon.readUInt32BE(20), expectedSize, `${path} height`);
  }
});

test("service worker precaches the complete install shell", async () => {
  const serviceWorker = await readFile("public/sw.js", "utf8");

  for (const asset of [
    "/manifest.webmanifest",
    "/manifest.webmanifest?v=17",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/apple-touch-icon.png",
    "/data/croatia-coastline.json",
    "/data/croatia-map-features.json",
    "/audio/shoreline-alarm.wav",
  ]) {
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(serviceWorker, new RegExp(escapedAsset));
  }
});

test("service worker rotates caches and provides offline navigation fallback", async () => {
  const serviceWorker = await readFile("public/sw.js", "utf8");
  assert.match(serviceWorker, /CACHE_NAME\s*=\s*"shoreline-watch-v34"/);
  assert.match(serviceWorker, /OFFLINE_CACHE_PREFIX\s*=\s*"shoreline-watch-offline-"/);
  assert.match(serviceWorker, /key !== CACHE_NAME && !key\.startsWith\(OFFLINE_CACHE_PREFIX\)/);
  assert.match(serviceWorker, /event\.request\.mode === "navigate"/);
  assert.match(serviceWorker, /cached \|\| caches\.match\("\/"\)/);
  assert.match(serviceWorker, /event\.request\.method !== "GET"/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
  assert.match(serviceWorker, /requestUrl\.pathname\.startsWith\("\/api\/"\)[\s\S]*event\.respondWith\(fetch\(event\.request\)\)/);
});

test("every local precache asset exists and core entries are unique", async () => {
  const serviceWorker = await readFile("public/sw.js", "utf8");
  const coreBlock = serviceWorker.match(/const CORE = \[([\s\S]*?)\];/)?.[1] ?? "";
  const assets = Array.from(coreBlock.matchAll(/"([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(assets).size, assets.length);
  for (const asset of assets) {
    if (asset === "/") continue;
    const path = `public/${asset.slice(1).split("?")[0]}`;
    assert.ok((await readFile(path)).length > 0, path);
  }
});

test("layout exposes install, Apple, safe-area, and German metadata", async () => {
  const layout = await readFile("app/layout.tsx", "utf8");
  assert.match(layout, /<html lang="de"/);
  assert.match(layout, /appleWebApp:\s*\{[\s\S]*capable:\s*true/);
  assert.match(layout, /statusBarStyle:\s*"black-translucent"/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /themeColor:\s*"#06151b"/);
});
