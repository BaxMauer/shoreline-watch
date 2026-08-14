export const ROUTE_MAP_LONG_PRESS_MS = 650;
export const ROUTE_MAP_MOVE_TOLERANCE_PX = 7;

export function shouldCommitRouteMapLongPress({
  elapsedMs,
  moved,
  pointerCount,
  planning,
}: {
  elapsedMs: number;
  moved: boolean;
  pointerCount: number;
  planning: boolean;
}) {
  return planning
    && Number.isFinite(elapsedMs)
    && elapsedMs >= ROUTE_MAP_LONG_PRESS_MS
    && !moved
    && pointerCount === 1;
}
