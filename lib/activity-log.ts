import { geoDistanceMetres, type GeoPoint } from "./route-planning.ts";

export const ACTIVITY_LOG_STORAGE_KEY = "shoreline-activity-log-v1";
export const MAX_ACTIVITY_RECORDS = 200;

export type ActivityPoint = GeoPoint & { timestamp: number; accuracy: number; speedKnots: number | null };

export type TripDraft = {
  id: string;
  startedAt: number;
  firstPoint: GeoPoint | null;
  lastPoint: ActivityPoint | null;
  distanceMetres: number;
  movingDurationMs: number;
  speedTotalKnots: number;
  speedSamples: number;
  maxSpeedKnots: number;
  minShoreDistanceMetres: number | null;
  minDepthMetres: number | null;
  warningCount: number;
};

export type TripActivity = {
  id: string;
  kind: "trip";
  startedAt: number;
  endedAt: number;
  durationMs: number;
  distanceMetres: number;
  movingDurationMs: number;
  averageSpeedKnots: number;
  maxSpeedKnots: number;
  minShoreDistanceMetres: number | null;
  minDepthMetres: number | null;
  warningCount: number;
};

export type AnchorActivity = {
  id: string;
  kind: "anchor";
  startedAt: number;
  endedAt: number;
  durationMs: number;
  bayName: string | null;
  islandName: string | null;
  maxDriftMetres: number;
  radiusMetres: number;
  driftAlarmCount: number;
};

export type ActivityRecord = TripActivity | AnchorActivity;

export function createTripDraft(startedAt = Date.now()): TripDraft {
  return {
    id: `trip-${startedAt}`,
    startedAt,
    firstPoint: null,
    lastPoint: null,
    distanceMetres: 0,
    movingDurationMs: 0,
    speedTotalKnots: 0,
    speedSamples: 0,
    maxSpeedKnots: 0,
    minShoreDistanceMetres: null,
    minDepthMetres: null,
    warningCount: 0,
  };
}

function minimum(current: number | null, value: number | null) {
  if (value === null || !Number.isFinite(value)) return current;
  return current === null ? value : Math.min(current, value);
}

export function updateTripDraft(
  draft: TripDraft,
  point: ActivityPoint,
  metrics: { shoreDistanceMetres?: number | null; depthMetres?: number | null } = {},
): TripDraft {
  const speedKnots = point.speedKnots !== null && Number.isFinite(point.speedKnots) ? Math.max(0, point.speedKnots) : null;
  const elapsedMs = draft.lastPoint ? point.timestamp - draft.lastPoint.timestamp : 0;
  const segmentMetres = draft.lastPoint ? geoDistanceMetres(draft.lastPoint, point) : 0;
  const plausibleSegment = elapsedMs > 0
    && elapsedMs <= 120_000
    && point.accuracy <= 100
    && draft.lastPoint!.accuracy <= 100
    && segmentMetres / (elapsedMs / 1_000) <= 45;
  return {
    ...draft,
    firstPoint: draft.firstPoint ?? { latitude: point.latitude, longitude: point.longitude },
    lastPoint: point,
    distanceMetres: draft.distanceMetres + (plausibleSegment ? segmentMetres : 0),
    movingDurationMs: draft.movingDurationMs + (plausibleSegment && (speedKnots ?? 0) >= 0.5 ? elapsedMs : 0),
    speedTotalKnots: draft.speedTotalKnots + (speedKnots ?? 0),
    speedSamples: draft.speedSamples + (speedKnots === null ? 0 : 1),
    maxSpeedKnots: Math.max(draft.maxSpeedKnots, speedKnots ?? 0),
    minShoreDistanceMetres: minimum(draft.minShoreDistanceMetres, metrics.shoreDistanceMetres ?? null),
    minDepthMetres: minimum(draft.minDepthMetres, metrics.depthMetres ?? null),
  };
}

export function finishTripDraft(draft: TripDraft, endedAt = Date.now()): TripActivity | null {
  if (!draft.firstPoint && endedAt - draft.startedAt < 10_000) return null;
  return {
    id: draft.id,
    kind: "trip",
    startedAt: draft.startedAt,
    endedAt: Math.max(draft.startedAt, endedAt),
    durationMs: Math.max(0, endedAt - draft.startedAt),
    distanceMetres: Math.round(draft.distanceMetres),
    movingDurationMs: draft.movingDurationMs,
    averageSpeedKnots: draft.speedSamples ? draft.speedTotalKnots / draft.speedSamples : 0,
    maxSpeedKnots: draft.maxSpeedKnots,
    minShoreDistanceMetres: draft.minShoreDistanceMetres,
    minDepthMetres: draft.minDepthMetres,
    warningCount: draft.warningCount,
  };
}

export function addActivityRecord(records: ActivityRecord[], record: ActivityRecord) {
  return [record, ...records.filter((item) => item.id !== record.id)]
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, MAX_ACTIVITY_RECORDS);
}

export function parseActivityLog(raw: string | null): ActivityRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is ActivityRecord => Boolean(record)
      && typeof record.id === "string"
      && (record.kind === "trip" || record.kind === "anchor")
      && Number.isFinite(record.startedAt)
      && Number.isFinite(record.endedAt))
      .slice(0, MAX_ACTIVITY_RECORDS);
  } catch {
    return [];
  }
}

export function activityTotals(records: ActivityRecord[]) {
  const trips = records.filter((record): record is TripActivity => record.kind === "trip");
  const anchors = records.filter((record): record is AnchorActivity => record.kind === "anchor");
  return {
    trips: trips.length,
    distanceMetres: trips.reduce((sum, record) => sum + record.distanceMetres, 0),
    durationMs: records.reduce((sum, record) => sum + record.durationMs, 0),
    maxSpeedKnots: trips.reduce((maximum, record) => Math.max(maximum, record.maxSpeedKnots), 0),
    anchorDurationMs: anchors.reduce((sum, record) => sum + record.durationMs, 0),
    driftAlarms: anchors.reduce((sum, record) => sum + record.driftAlarmCount, 0),
  };
}
