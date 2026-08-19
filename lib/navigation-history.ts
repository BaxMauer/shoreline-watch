import type { GeoPoint } from "./route-planning.ts";
import type { PlaceKind, PlaceSearchResult } from "./place-search.ts";

export const NAVIGATION_HISTORY_STORAGE_KEY = "shoreline-navigation-history-v1";
export const ACTIVE_NAVIGATION_STORAGE_KEY = "shoreline-active-navigation-v1";
export const MAX_NAVIGATION_HISTORY_ENTRIES = 8;
export const MAX_RESUMABLE_NAVIGATION_AGE_MS = 24 * 60 * 60 * 1_000;

export type NavigationDestination = {
  id: string;
  name: string;
  detail: string;
  kind: PlaceKind | "coordinates";
  point: GeoPoint;
  selectedAt: number;
};

export type ActiveNavigationSession = {
  schemaVersion: 1;
  destination: NavigationDestination;
  startedAt: number;
  updatedAt: number;
};

function finitePoint(value: unknown): value is GeoPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<GeoPoint>;
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && Math.abs(point.latitude ?? 91) <= 90
    && Math.abs(point.longitude ?? 181) <= 180;
}

function validDestination(value: unknown): value is NavigationDestination {
  if (!value || typeof value !== "object") return false;
  const destination = value as Partial<NavigationDestination>;
  return typeof destination.id === "string"
    && destination.id.length > 0
    && typeof destination.name === "string"
    && destination.name.length > 0
    && typeof destination.detail === "string"
    && (destination.kind === "place" || destination.kind === "bay" || destination.kind === "island" || destination.kind === "coordinates")
    && finitePoint(destination.point)
    && Number.isFinite(destination.selectedAt);
}

function destinationKey(destination: NavigationDestination) {
  if (destination.kind !== "coordinates") return `${destination.kind}:${destination.name.trim().toLocaleLowerCase()}`;
  return `${destination.kind}:${destination.point.latitude.toFixed(4)}:${destination.point.longitude.toFixed(4)}`;
}

export function createSearchDestination(result: PlaceSearchResult, selectedAt = Date.now()): NavigationDestination {
  return {
    id: result.id,
    name: result.name,
    detail: result.detail,
    kind: result.kind,
    point: { latitude: result.latitude, longitude: result.longitude },
    selectedAt,
  };
}

export function createCoordinateDestination(point: GeoPoint, selectedAt = Date.now()): NavigationDestination {
  const latitude = point.latitude.toFixed(5);
  const longitude = point.longitude.toFixed(5);
  return {
    id: `coordinates-${latitude}-${longitude}`,
    name: `${latitude}, ${longitude}`,
    detail: "",
    kind: "coordinates",
    point: { latitude: point.latitude, longitude: point.longitude },
    selectedAt,
  };
}

export function addNavigationDestination(
  history: NavigationDestination[],
  destination: NavigationDestination,
): NavigationDestination[] {
  if (!validDestination(destination)) return history.slice(0, MAX_NAVIGATION_HISTORY_ENTRIES);
  const key = destinationKey(destination);
  return [destination, ...history.filter((entry) => validDestination(entry) && destinationKey(entry) !== key)]
    .slice(0, MAX_NAVIGATION_HISTORY_ENTRIES);
}

export function parseNavigationHistory(raw: string | null): NavigationDestination[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validDestination)
      .sort((left, right) => right.selectedAt - left.selectedAt)
      .slice(0, MAX_NAVIGATION_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function createActiveNavigationSession(
  destination: NavigationDestination,
  now = Date.now(),
  startedAt = now,
): ActiveNavigationSession {
  return { schemaVersion: 1, destination, startedAt, updatedAt: now };
}

export function touchActiveNavigationSession(session: ActiveNavigationSession, now = Date.now()): ActiveNavigationSession {
  return { ...session, updatedAt: now };
}

export function parseActiveNavigationSession(raw: string | null, now = Date.now()): ActiveNavigationSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveNavigationSession>;
    if (parsed.schemaVersion !== 1
      || !validDestination(parsed.destination)
      || !Number.isFinite(parsed.startedAt)
      || !Number.isFinite(parsed.updatedAt)
      || (parsed.updatedAt ?? 0) > now + 60_000
      || now - (parsed.updatedAt ?? 0) > MAX_RESUMABLE_NAVIGATION_AGE_MS) return null;
    return parsed as ActiveNavigationSession;
  } catch {
    return null;
  }
}
