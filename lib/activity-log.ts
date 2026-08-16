import { geoDistanceMetres, type GeoPoint } from "./route-planning.ts";

export const ACTIVITY_LOG_STORAGE_KEY = "shoreline-activity-log-v1";
export const MAX_ACTIVITY_RECORDS = 200;
export const AUTOMATIC_TRIP_RULES = {
  minimumDurationMs: 90_000,
  minimumDistanceMetres: 150,
  minimumMovingDurationMs: 45_000,
  minimumConfirmedMovementMs: 30_000,
  minimumUnderwaySpeedKnots: 1.5,
  minimumDisplacementMetres: 75,
  minimumLoopDistanceMetres: 350,
  minimumTrackPointCount: 5,
} as const;

export type ActivityPoint = GeoPoint & { timestamp: number; accuracy: number; speedKnots: number | null };

export type TripDraft = {
  id: string;
  startedAt: number;
  firstPoint: GeoPoint | null;
  lastPoint: ActivityPoint | null;
  distanceMetres: number;
  movingDurationMs: number;
  confirmedMovementMs: number;
  speedTotalKnots: number;
  speedSamples: number;
  maxSpeedKnots: number;
  minShoreDistanceMetres: number | null;
  minDepthMetres: number | null;
  warningCount: number;
  trackPointCount: number;
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
  trackPointCount: number;
  startPoint: GeoPoint | null;
  endPoint: GeoPoint | null;
  startLabel: string | null;
  endLabel: string | null;
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
    confirmedMovementMs: 0,
    speedTotalKnots: 0,
    speedSamples: 0,
    maxSpeedKnots: 0,
    minShoreDistanceMetres: null,
    minDepthMetres: null,
    warningCount: 0,
    trackPointCount: 0,
  };
}

export function noteStoredTrackPoint(draft: TripDraft) {
  return { ...draft, trackPointCount: draft.trackPointCount + 1 };
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
  const confirmedMovementMs = Number.isFinite(draft.confirmedMovementMs) ? draft.confirmedMovementMs : 0;
  return {
    ...draft,
    firstPoint: draft.firstPoint ?? { latitude: point.latitude, longitude: point.longitude },
    lastPoint: point,
    distanceMetres: draft.distanceMetres + (plausibleSegment ? segmentMetres : 0),
    movingDurationMs: draft.movingDurationMs + (plausibleSegment && (speedKnots ?? 0) >= 0.5 ? elapsedMs : 0),
    confirmedMovementMs: confirmedMovementMs + (plausibleSegment && (speedKnots ?? 0) >= AUTOMATIC_TRIP_RULES.minimumUnderwaySpeedKnots
      ? Math.min(elapsedMs, 15_000)
      : 0),
    speedTotalKnots: draft.speedTotalKnots + (speedKnots ?? 0),
    speedSamples: draft.speedSamples + (speedKnots === null ? 0 : 1),
    maxSpeedKnots: Math.max(draft.maxSpeedKnots, speedKnots ?? 0),
    minShoreDistanceMetres: minimum(draft.minShoreDistanceMetres, metrics.shoreDistanceMetres ?? null),
    minDepthMetres: minimum(draft.minDepthMetres, metrics.depthMetres ?? null),
  };
}

export function isMeaningfulTripDraft(draft: TripDraft, endedAt = Date.now()) {
  if (!draft.firstPoint || !draft.lastPoint) return false;
  const durationMs = Math.max(0, endedAt - draft.startedAt);
  const displacementMetres = geoDistanceMetres(draft.firstPoint, draft.lastPoint);
  const averageSpeedKnots = draft.speedSamples > 0 ? draft.speedTotalKnots / draft.speedSamples : 0;
  const confirmedMovementMs = Number.isFinite(draft.confirmedMovementMs)
    ? draft.confirmedMovementMs
    : (averageSpeedKnots >= AUTOMATIC_TRIP_RULES.minimumUnderwaySpeedKnots ? draft.movingDurationMs : 0);
  const hasCoordinateOnlyMotion = draft.speedSamples === 0
    && draft.distanceMetres >= 250
    && displacementMetres >= 150;
  const hasMovementDuration = draft.movingDurationMs >= AUTOMATIC_TRIP_RULES.minimumMovingDurationMs
    || (draft.speedSamples === 0 && durationMs >= 120_000);
  const hasMeaningfulRoute = displacementMetres >= AUTOMATIC_TRIP_RULES.minimumDisplacementMetres
    || draft.distanceMetres >= AUTOMATIC_TRIP_RULES.minimumLoopDistanceMetres;

  return durationMs >= AUTOMATIC_TRIP_RULES.minimumDurationMs
    && draft.distanceMetres >= AUTOMATIC_TRIP_RULES.minimumDistanceMetres
    && draft.trackPointCount >= AUTOMATIC_TRIP_RULES.minimumTrackPointCount
    && hasMovementDuration
    && hasMeaningfulRoute
    && (confirmedMovementMs >= AUTOMATIC_TRIP_RULES.minimumConfirmedMovementMs || hasCoordinateOnlyMotion);
}

export function finishTripDraft(
  draft: TripDraft,
  endedAt = Date.now(),
  labels: { startLabel?: string | null; endLabel?: string | null } = {},
): TripActivity | null {
  if (!isMeaningfulTripDraft(draft, endedAt)) return null;
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
    trackPointCount: Number.isFinite(draft.trackPointCount) ? draft.trackPointCount : 0,
    startPoint: draft.firstPoint,
    endPoint: draft.lastPoint ? { latitude: draft.lastPoint.latitude, longitude: draft.lastPoint.longitude } : null,
    startLabel: labels.startLabel ?? null,
    endLabel: labels.endLabel ?? null,
  };
}

export function addActivityRecord(records: ActivityRecord[], record: ActivityRecord) {
  return [record, ...records.filter((item) => item.id !== record.id)]
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, MAX_ACTIVITY_RECORDS);
}

export function removeActivityRecord(records: ActivityRecord[], id: string) {
  return records.filter((record) => record.id !== id);
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
