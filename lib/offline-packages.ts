import {
  EMODNET_BATHYMETRY_LAYER,
  EMODNET_BATHYMETRY_VERSION,
  type BathymetryTile,
} from "./route-ui.ts";

export const OFFLINE_BATHYMETRY_CACHE = "shoreline-watch-offline-bathymetry-v2";
export const OFFLINE_PACKAGE_STORAGE_KEY = "shoreline-offline-packages-v2";

export type OfflinePackage = {
  id: string;
  nameDe: string;
  nameEn: string;
  detailDe: string;
  detailEn: string;
  bounds: { north: number; east: number; south: number; west: number };
};

export const OFFLINE_PACKAGES: OfflinePackage[] = [
  { id: "sibenik", nameDe: "Šibenik-Küste", nameEn: "Šibenik coast", detailDe: "Prvić, Zlarin und Kanal", detailEn: "Prvić, Zlarin and the channel", bounds: { north: 43.84, east: 15.99, south: 43.59, west: 15.67 } },
  { id: "murter", nameDe: "Murter & Pakoštane", nameEn: "Murter & Pakoštane", detailDe: "Tisno bis Vrgada", detailEn: "Tisno to Vrgada", bounds: { north: 43.98, east: 15.72, south: 43.68, west: 15.36 } },
  { id: "kornati", nameDe: "Kornaten", nameEn: "Kornati", detailDe: "Dugi Otok bis Žirje", detailEn: "Dugi Otok to Žirje", bounds: { north: 43.99, east: 15.61, south: 43.58, west: 15.05 } },
  { id: "zadar", nameDe: "Zadar-Inseln", nameEn: "Zadar islands", detailDe: "Ugljan, Pašman und Iž", detailEn: "Ugljan, Pašman and Iž", bounds: { north: 44.25, east: 15.45, south: 43.82, west: 14.93 } },
];

const MAXIMUM_MERCATOR_LATITUDE = 85.05112878;

function longitudeToTileX(longitude: number, zoom: number) {
  return Math.floor((longitude + 180) / 360 * 2 ** zoom);
}

function latitudeToTileY(latitude: number, zoom: number) {
  const bounded = Math.max(-MAXIMUM_MERCATOR_LATITUDE, Math.min(MAXIMUM_MERCATOR_LATITUDE, latitude));
  const radians = bounded * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom);
}

export function buildOfflinePackageTiles(pack: OfflinePackage, minimumZoom = 8, maximumZoom = 14): BathymetryTile[] {
  const tiles: BathymetryTile[] = [];
  for (let zoom = Math.max(0, minimumZoom); zoom <= Math.min(15, maximumZoom); zoom += 1) {
    const minColumn = longitudeToTileX(pack.bounds.west, zoom);
    const maxColumn = longitudeToTileX(pack.bounds.east, zoom);
    const minRow = latitudeToTileY(pack.bounds.north, zoom);
    const maxRow = latitudeToTileY(pack.bounds.south, zoom);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const key = `${zoom}/${column}/${row}`;
        tiles.push({
          key,
          url: `https://tiles.emodnet-bathymetry.eu/${EMODNET_BATHYMETRY_VERSION}/${EMODNET_BATHYMETRY_LAYER}/web_mercator/${key}.png`,
          north: 0,
          east: 0,
          south: 0,
          west: 0,
        });
      }
    }
  }
  return tiles;
}

export function parseInstalledOfflinePackages(value: string | null) {
  if (!value) return [];
  try {
    const ids = JSON.parse(value);
    if (!Array.isArray(ids)) return [];
    const known = new Set(OFFLINE_PACKAGES.map((pack) => pack.id));
    return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id))));
  } catch {
    return [];
  }
}

export function packageContainsPoint(pack: OfflinePackage, point: { latitude: number; longitude: number }) {
  return point.latitude <= pack.bounds.north && point.latitude >= pack.bounds.south
    && point.longitude <= pack.bounds.east && point.longitude >= pack.bounds.west;
}

export async function downloadOfflinePackage(pack: OfflinePackage, onProgress: (completed: number, total: number) => void) {
  if (!("caches" in globalThis)) throw new Error("Cache API unavailable");
  const urls = buildOfflinePackageTiles(pack).map((tile) => tile.url);
  const cache = await caches.open(OFFLINE_BATHYMETRY_CACHE);
  let completed = 0;
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, async () => {
    while (nextIndex < urls.length) {
      const url = urls[nextIndex];
      nextIndex += 1;
      const request = new Request(url, { mode: "no-cors", cache: "reload" });
      const response = await fetch(request);
      await cache.put(request, response);
      completed += 1;
      onProgress(completed, urls.length);
    }
  }));
  return urls.length;
}

export async function removeOfflinePackage(pack: OfflinePackage, installedIds: string[]) {
  if (!("caches" in globalThis)) return;
  const cache = await caches.open(OFFLINE_BATHYMETRY_CACHE);
  const retainedUrls = new Set(OFFLINE_PACKAGES
    .filter((candidate) => candidate.id !== pack.id && installedIds.includes(candidate.id))
    .flatMap((candidate) => buildOfflinePackageTiles(candidate).map((tile) => tile.url)));
  await Promise.all(buildOfflinePackageTiles(pack)
    .map((tile) => tile.url)
    .filter((url) => !retainedUrls.has(url))
    .map((url) => cache.delete(url)));
}
