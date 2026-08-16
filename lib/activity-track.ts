import { geoDistanceMetres, type GeoPoint } from "./route-planning.ts";

const DATABASE_NAME = "shoreline-activity-tracks-v1";
const DATABASE_VERSION = 1;
const POINT_STORE = "track-points";

export type TripTrackPoint = GeoPoint & {
  tripId: string;
  sequence: number;
  timestamp: number;
  accuracy: number;
  speedKnots: number | null;
  heading: number | null;
  shoreDistanceMetres: number | null;
  depthMetres: number | null;
};

type StoredTripTrackPoint = TripTrackPoint & { key: string };

function publicTrackPoint(point: StoredTripTrackPoint): TripTrackPoint {
  return {
    tripId: point.tripId,
    sequence: point.sequence,
    latitude: point.latitude,
    longitude: point.longitude,
    timestamp: point.timestamp,
    accuracy: point.accuracy,
    speedKnots: point.speedKnots,
    heading: point.heading,
    shoreDistanceMetres: point.shoreDistanceMetres,
    depthMetres: point.depthMetres,
  };
}

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value);
}

function headingDelta(left: number | null, right: number | null) {
  if (!finite(left) || !finite(right)) return 0;
  const delta = Math.abs((right as number) - (left as number)) % 360;
  return Math.min(delta, 360 - delta);
}

export function shouldStoreTrackPoint(previous: TripTrackPoint | null, next: TripTrackPoint) {
  if (![next.latitude, next.longitude, next.timestamp, next.accuracy].every(Number.isFinite)) return false;
  if (next.accuracy < 0 || next.accuracy > 100) return false;
  if (!previous) return true;
  const elapsedMs = next.timestamp - previous.timestamp;
  if (elapsedMs <= 0) return false;
  if (elapsedMs >= 30_000) return true;
  if (elapsedMs < 2_000) return false;
  const distanceMetres = geoDistanceMetres(previous, next);
  if (distanceMetres >= Math.max(6, Math.min(20, next.accuracy * 0.7))) return true;
  if (elapsedMs >= 5_000 && distanceMetres >= 3 && headingDelta(previous.heading, next.heading) >= 12) return true;
  const speedDelta = finite(previous.speedKnots) && finite(next.speedKnots)
    ? Math.abs((next.speedKnots as number) - (previous.speedKnots as number))
    : 0;
  return elapsedMs >= 5_000 && speedDelta >= 1;
}

function openTrackDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(POINT_STORE)) return;
      const store = database.createObjectStore(POINT_STORE, { keyPath: "key" });
      store.createIndex("tripId", "tripId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveTripTrackPoint(point: TripTrackPoint) {
  if (!("indexedDB" in window)) return false;
  const database = await openTrackDatabase();
  try {
    const transaction = database.transaction(POINT_STORE, "readwrite");
    const stored: StoredTripTrackPoint = { ...point, key: `${point.tripId}:${String(point.sequence).padStart(7, "0")}` };
    transaction.objectStore(POINT_STORE).put(stored);
    await transactionDone(transaction);
    return true;
  } finally {
    database.close();
  }
}

export async function getTripTrack(tripId: string): Promise<TripTrackPoint[]> {
  if (!("indexedDB" in window)) return [];
  const database = await openTrackDatabase();
  try {
    const transaction = database.transaction(POINT_STORE, "readonly");
    const request = transaction.objectStore(POINT_STORE).index("tripId").getAll(IDBKeyRange.only(tripId));
    const points = await new Promise<StoredTripTrackPoint[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return points.sort((left, right) => left.sequence - right.sequence).map(publicTrackPoint);
  } finally {
    database.close();
  }
}

export async function clearTripTracks() {
  if (!("indexedDB" in window)) return;
  const database = await openTrackDatabase();
  try {
    const transaction = database.transaction(POINT_STORE, "readwrite");
    transaction.objectStore(POINT_STORE).clear();
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteTripTrack(tripId: string) {
  if (!("indexedDB" in window)) return;
  const database = await openTrackDatabase();
  try {
    const transaction = database.transaction(POINT_STORE, "readwrite");
    const store = transaction.objectStore(POINT_STORE);
    const request = store.index("tripId").openKeyCursor(IDBKeyRange.only(tripId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function pruneTripTracks(validTripIds: string[]) {
  if (!("indexedDB" in window)) return;
  const valid = new Set(validTripIds);
  const database = await openTrackDatabase();
  try {
    const transaction = database.transaction(POINT_STORE, "readwrite");
    const store = transaction.objectStore(POINT_STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const point = cursor.value as StoredTripTrackPoint;
      if (!valid.has(point.tripId)) cursor.delete();
      cursor.continue();
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function buildTripGpx(name: string, points: TripTrackPoint[]) {
  const trackPoints = points.map((point) => {
    const extensions = [
      finite(point.speedKnots) ? `<shoreline:speedKnots>${(point.speedKnots as number).toFixed(2)}</shoreline:speedKnots>` : "",
      finite(point.accuracy) ? `<shoreline:accuracy>${point.accuracy.toFixed(1)}</shoreline:accuracy>` : "",
      finite(point.depthMetres) ? `<shoreline:chartDepth>${(point.depthMetres as number).toFixed(1)}</shoreline:chartDepth>` : "",
    ].filter(Boolean).join("");
    return `<trkpt lat="${point.latitude.toFixed(7)}" lon="${point.longitude.toFixed(7)}"><time>${new Date(point.timestamp).toISOString()}</time>${extensions ? `<extensions>${extensions}</extensions>` : ""}</trkpt>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Shoreline Watch" xmlns="http://www.topografix.com/GPX/1/1" xmlns:shoreline="https://boot.maxi-bauer.de/gpx/1"><trk><name>${xml(name)}</name><trkseg>${trackPoints}</trkseg></trk></gpx>`;
}
