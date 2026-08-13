"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLandIntervalsAtLatitude, getNearbyShorelineSegments, type CoastlinePack } from "../lib/shoreline";
import {
  formatRouteDistance,
  geoBearing,
  geoDistanceMetres,
  planWaterRoute,
  type GeoPoint,
  type PlannedRoute,
  type RoutePlanningFailure,
} from "../lib/route-planning";
import {
  canPlanRoute,
  clampCruiseSpeed,
  clampRouteViewRange,
  formatRouteClearance,
  formatRouteEta,
  getRouteReadinessState,
  parseRouteCoordinate,
  panRouteMapCentre,
  pinchRouteViewRange,
  routeMapPixelToGeo,
  routeViewRangeForTarget,
  shouldRerouteRoute,
} from "../lib/route-ui";
import {
  MAXIMUM_NAVIGATION_ACCURACY_METRES,
  type GpsNavigationState,
} from "../lib/navigation-metrics";
import type { WarningConfig } from "../lib/warning-config";

type Language = "de" | "en";
type Fix = GeoPoint & { speed: number | null; accuracy?: number };

const COPY = {
  de: {
    title: "Routenplanung",
    subtitle: "Ziel auf der Karte antippen",
    calculating: "Route nach Küstengeometrie wird berechnet …",
    noPosition: "Warte auf eine Position, um die Route zu starten.",
    gpsInaccurate: (accuracy: string, maximum: number) => `GPS ±${accuracy} m ist zu ungenau. Für Routen sind höchstens ±${maximum} m erforderlich.`,
    gpsStale: "GPS-Position ist veraltet. Route erst nach einem neuen Fix fortsetzen.",
    gpsLost: "GPS-Signal verloren. Route erst nach einem neuen Fix fortsetzen.",
    distance: "Strecke",
    eta: "Fahrzeit",
    clearance: "Kleinster Abstand",
    bearing: "Nächster Kurs",
    ready: "ROUTE BEREIT",
    check: "ROUTE PRÜFEN",
    waiting: "ZIEL WÄHLEN",
    clearanceDetail: (distance: number) => `Die berechnete Küstenlinien-Geometrie hält den bevorzugten Abstand von ${distance} m ein.`,
    restrictedDetail: (distance: number) => `Die berechnete Küstenlinien-Geometrie unterschreitet stellenweise ${distance} m – besonders Start und Ziel prüfen.`,
    navigationScope: "Nur Küstengeometrie & Abstand. Keine Prüfung von Tiefe, Felsen, Verkehr, Bojen, Fahrwasser, Wetter oder Vorschriften.",
    rule: (distance: number, speed: number, enabled: boolean) => enabled
      ? `${distance} m Abstand · ${speed} kn küstennah`
      : `${distance} m Abstand · Tempolimit aus`,
    reset: "Ziel löschen",
    coordinates: "Zielkoordinaten",
    latitude: "Breite",
    longitude: "Länge",
    useCoordinates: "Route berechnen",
    cruiseSpeed: "Planungstempo",
    cruiseSpeedHint: "Außerhalb des Warnbereichs",
    nauticalMiles: "sm",
    minutes: "Min.",
    failures: {
      "outside-region": "Ziel liegt außerhalb des verfügbaren Kroatien-Küstendatensatzes.",
      "destination-on-land": "Das gewählte Ziel liegt laut Küstengeometrie an Land. Bitte ins Wasser tippen.",
      "too-far": "Das Ziel ist für eine einzelne Offline-Route zu weit entfernt.",
      "no-route": "Keine durchgehende Wasserroute gefunden. Bitte Zielpunkt oder Küstenabstand ändern.",
    },
    mapLabel: "Offline-Karte zur Auswahl des Routenziels",
    mapHint: "Ziehen zum Verschieben · zwei Finger zum Zoomen · tippen setzt das Ziel",
    zoomIn: "Karte vergrößern",
    zoomOut: "Karte verkleinern",
    recenter: "Boot zentrieren",
    current: "Boot",
    target: "Ziel",
  },
  en: {
    title: "Route planning",
    subtitle: "Tap a destination on the map",
    calculating: "Calculating a shoreline-geometry route …",
    noPosition: "Waiting for a position to start routing.",
    gpsInaccurate: (accuracy: string, maximum: number) => `GPS ±${accuracy} m is too inaccurate. Routing requires ±${maximum} m or better.`,
    gpsStale: "GPS position is stale. Continue routing after a new fix.",
    gpsLost: "GPS signal lost. Continue routing after a new fix.",
    distance: "Distance",
    eta: "Travel time",
    clearance: "Minimum clearance",
    bearing: "Next course",
    ready: "ROUTE READY",
    check: "CHECK ROUTE",
    waiting: "CHOOSE TARGET",
    clearanceDetail: (distance: number) => `The calculated shoreline geometry maintains the preferred ${distance} m clearance.`,
    restrictedDetail: (distance: number) => `The calculated shoreline geometry is inside ${distance} m in places – check start and destination carefully.`,
    navigationScope: "Shoreline geometry & clearance only. No depth, rock, traffic, buoy, channel, weather, or legal checks.",
    rule: (distance: number, speed: number, enabled: boolean) => enabled
      ? `${distance} m clearance · ${speed} kn near shore`
      : `${distance} m clearance · speed rule off`,
    reset: "Clear target",
    coordinates: "Destination coordinates",
    latitude: "Latitude",
    longitude: "Longitude",
    useCoordinates: "Calculate route",
    cruiseSpeed: "Planning speed",
    cruiseSpeedHint: "Outside the warning area",
    nauticalMiles: "nm",
    minutes: "min",
    failures: {
      "outside-region": "The destination is outside the available Croatia shoreline dataset.",
      "destination-on-land": "The selected destination is on land according to the shoreline geometry. Tap in the water.",
      "too-far": "The destination is too far for one offline route.",
      "no-route": "No continuous water route found. Change the target or shoreline clearance.",
    },
    mapLabel: "Offline map for choosing a route destination",
    mapHint: "Drag to pan · pinch to zoom · tap to set target",
    zoomIn: "Zoom map in",
    zoomOut: "Zoom map out",
    recenter: "Centre on boat",
    current: "Boat",
    target: "Target",
  },
} as const;

export default function RoutePlanner({
  pack,
  fix,
  warningConfig,
  language,
  gpsNavigationState,
}: {
  pack: CoastlinePack | null;
  fix: Fix | null;
  warningConfig: WarningConfig;
  language: Language;
  gpsNavigationState: GpsNavigationState;
}) {
  const copy = COPY[language];
  const gpsReliable = canPlanRoute(gpsNavigationState, fix);
  const [target, setTarget] = useState<GeoPoint | null>(null);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [failure, setFailure] = useState<RoutePlanningFailure | null>(null);
  const [planning, setPlanning] = useState(false);
  const [viewRangeMetres, setViewRangeMetres] = useState(20_000);
  const [viewCentre, setViewCentre] = useState<GeoPoint | null>(null);
  const [cruiseSpeedKnots, setCruiseSpeedKnots] = useState(16);
  const [coordinateLatitude, setCoordinateLatitude] = useState("");
  const [coordinateLongitude, setCoordinateLongitude] = useState("");
  const plannedFrom = useRef<GeoPoint | null>(null);
  const calculationSequence = useRef(0);
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const mapGesture = useRef<{
    centre: GeoPoint;
    range: number;
    centroid: { x: number; y: number };
    distance: number;
    moved: boolean;
  } | null>(null);

  const calculate = useCallback((destination: GeoPoint, startOverride?: Fix) => {
    const start = startOverride ?? fix;
    if (!pack || !start || !canPlanRoute(gpsNavigationState, start)) return;
    const sequence = ++calculationSequence.current;
    setPlanning(true);
    setFailure(null);
    window.setTimeout(() => {
      if (sequence !== calculationSequence.current) return;
      const result = planWaterRoute(pack, start, destination, {
        clearanceMetres: warningConfig.distanceMetres,
        cruiseSpeedKnots,
        speedWarningEnabled: warningConfig.speedWarningEnabled,
        nearShoreSpeedKnots: warningConfig.maxSpeedKnots,
        startAccuracyMetres: start.accuracy,
      });
      if (sequence !== calculationSequence.current) return;
      setRoute(result.route ?? null);
      setFailure(result.failure ?? null);
      plannedFrom.current = start;
      setPlanning(false);
    }, 30);
  }, [cruiseSpeedKnots, fix, gpsNavigationState, pack, warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled]);

  useEffect(() => {
    if (gpsReliable) return;
    calculationSequence.current += 1;
  }, [gpsReliable]);

  const selectTarget = useCallback((destination: GeoPoint) => {
    setTarget(destination);
    setCoordinateLatitude(destination.latitude.toFixed(6));
    setCoordinateLongitude(destination.longitude.toFixed(6));
    if (fix) setViewRangeMetres((current) => routeViewRangeForTarget(current, fix, destination));
    calculate(destination);
  }, [calculate, fix]);

  useEffect(() => {
    if (!target || !fix || !gpsReliable || !plannedFrom.current || planning) return;
    if (!shouldRerouteRoute(plannedFrom.current, fix, warningConfig.distanceMetres)) return;
    const timer = window.setTimeout(() => calculate(target, fix), 500);
    return () => window.clearTimeout(timer);
  }, [calculate, fix, gpsReliable, planning, target, warningConfig.distanceMetres]);

  useEffect(() => {
    if (!target || !fix || !gpsReliable) return;
    const timer = window.setTimeout(() => calculate(target, fix), 0);
    return () => window.clearTimeout(timer);
  // Reroute when a planning preference changes; live position changes are handled by the distance threshold above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cruiseSpeedKnots, gpsReliable, warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled]);

  const size = 360;
  const centre = size / 2;
  const mapCentre = viewCentre ?? fix ?? target ?? { longitude: 15.55, latitude: 43.8 };
  const metresPerLongitudeDegree = 111_320 * Math.cos((mapCentre.latitude * Math.PI) / 180);
  const pixelsPerMetre = centre / viewRangeMetres;
  const point = useCallback((value: GeoPoint) => ({
    x: centre + (value.longitude - mapCentre.longitude) * metresPerLongitudeDegree * pixelsPerMetre,
    y: centre - (value.latitude - mapCentre.latitude) * 110_540 * pixelsPerMetre,
  }), [centre, mapCentre.latitude, mapCentre.longitude, metresPerLongitudeDegree, pixelsPerMetre]);
  const segments = useMemo(() => pack
    ? getNearbyShorelineSegments(pack, mapCentre.longitude, mapCentre.latitude, viewRangeMetres * 1.45, 5_000)
    : [], [mapCentre.latitude, mapCentre.longitude, pack, viewRangeMetres]);
  const hatchPath = useMemo(() => {
    if (!pack) return "";
    const bandHeight = 6;
    const minimumLongitude = mapCentre.longitude - viewRangeMetres / metresPerLongitudeDegree;
    const maximumLongitude = mapCentre.longitude + viewRangeMetres / metresPerLongitudeDegree;
    let path = "";
    for (let y = 0; y < size; y += bandHeight) {
      const latitude = mapCentre.latitude + (centre - y - bandHeight / 2) / (110_540 * pixelsPerMetre);
      const intervals = getLandIntervalsAtLatitude(pack, latitude, minimumLongitude, maximumLongitude);
      for (const [west, east] of intervals) {
        const left = Math.max(0, centre + (west - mapCentre.longitude) * metresPerLongitudeDegree * pixelsPerMetre);
        const right = Math.min(size, centre + (east - mapCentre.longitude) * metresPerLongitudeDegree * pixelsPerMetre);
        if (right > left) path += `M${left} ${y}H${right}V${Math.min(size, y + bandHeight + .5)}H${left}Z`;
      }
    }
    return path;
  }, [centre, mapCentre.latitude, mapCentre.longitude, metresPerLongitudeDegree, pack, pixelsPerMetre, viewRangeMetres]);
  const routePoints = route?.points.map(point).map(({ x, y }) => `${x},${y}`).join(" ") ?? "";
  const boatPoint = fix ? point(fix) : null;
  const targetPoint = target ? point(target) : null;
  const nextRoutePoint = route && fix
    ? route.points.find((candidate, index) => index > 0 && geoDistanceMetres(fix, candidate) > 120) ?? target
    : null;
  const nextBearing = gpsReliable && fix && nextRoutePoint ? geoBearing(fix, nextRoutePoint) : null;
  const routeReadiness = getRouteReadinessState({
    gpsNavigationState,
    planning,
    hasRoute: route !== null,
    routeRestricted: route?.mode === "restricted",
    hasFailure: failure !== null,
  });
  const routeStateClass = routeReadiness === "ready" ? "ready" : routeReadiness === "check" ? "check" : "";
  const routeStateLabel = routeReadiness === "calculating"
    ? "…"
    : routeReadiness === "ready"
      ? copy.ready
      : routeReadiness === "check"
        ? copy.check
        : copy.waiting;
  const gpsAccuracyLabel = fix && Number.isFinite(fix.accuracy)
    ? Math.round(fix.accuracy ?? 0).toString()
    : "—";
  const gpsIssueMessage = gpsNavigationState === "inaccurate"
    ? copy.gpsInaccurate(gpsAccuracyLabel, MAXIMUM_NAVIGATION_ACCURACY_METRES)
    : gpsNavigationState === "stale"
      ? copy.gpsStale
      : gpsNavigationState === "lost"
        ? copy.gpsLost
        : copy.noPosition;

  const pointerMetrics = (element: HTMLDivElement) => {
    const bounds = element.getBoundingClientRect();
    const points = Array.from(activePointers.current.values()).map((value) => ({
      x: (value.x - bounds.left) / bounds.width * size,
      y: (value.y - bounds.top) / bounds.height * size,
    }));
    const centroid = points.reduce((total, value) => ({ x: total.x + value.x / points.length, y: total.y + value.y / points.length }), { x: 0, y: 0 });
    const distance = points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    return { centroid, distance };
  };

  const beginGesture = (element: HTMLDivElement) => {
    const metrics = pointerMetrics(element);
    mapGesture.current = { centre: mapCentre, range: viewRangeMetres, ...metrics, moved: false };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture(event.currentTarget);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointers.current.has(event.pointerId) || !mapGesture.current) return;
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const metrics = pointerMetrics(event.currentTarget);
    const gesture = mapGesture.current;
    const deltaX = metrics.centroid.x - gesture.centroid.x;
    const deltaY = metrics.centroid.y - gesture.centroid.y;
    if (Math.hypot(deltaX, deltaY) > 4 || Math.abs(metrics.distance - gesture.distance) > 4) gesture.moved = true;
    setViewCentre(panRouteMapCentre(gesture.centre, gesture.range, size, deltaX, deltaY));
    if (activePointers.current.size >= 2) setViewRangeMetres(pinchRouteViewRange(gesture.range, gesture.distance, metrics.distance));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = mapGesture.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * size;
    const y = (event.clientY - bounds.top) / bounds.height * size;
    const wasSinglePointer = activePointers.current.size === 1;
    activePointers.current.delete(event.pointerId);
    if (wasSinglePointer && !gesture?.moved && gpsReliable && !planning) selectTarget(routeMapPixelToGeo(mapCentre, viewRangeMetres, size, x, y));
    if (activePointers.current.size > 0) beginGesture(event.currentTarget);
    else mapGesture.current = null;
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size > 0) beginGesture(event.currentTarget);
    else mapGesture.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setViewRangeMetres((value) => clampRouteViewRange(value * (event.deltaY > 0 ? 1.18 : 1 / 1.18)));
  };

  const handleMapKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") setViewRangeMetres((value) => clampRouteViewRange(value / 1.7));
    else if (event.key === "-") setViewRangeMetres((value) => clampRouteViewRange(value * 1.7));
    else if ((event.key === "Enter" || event.key === " ") && gpsReliable && !planning) selectTarget(mapCentre);
    else return;
    event.preventDefault();
  };

  const useCoordinates = () => {
    const latitude = parseRouteCoordinate(coordinateLatitude);
    const longitude = parseRouteCoordinate(coordinateLongitude);
    if (latitude === null || longitude === null) return;
    selectTarget({ latitude, longitude });
  };

  const reset = () => {
    calculationSequence.current += 1;
    setTarget(null);
    setRoute(null);
    setFailure(null);
    setPlanning(false);
    setCoordinateLatitude("");
    setCoordinateLongitude("");
    plannedFrom.current = null;
  };

  const recenterMap = () => {
    setViewCentre(null);
    if (fix && target) setViewRangeMetres(routeViewRangeForTarget(20_000, fix, target));
  };

  return (
    <section className="route-planner" aria-label={copy.title}>
      <div className="route-map-wrap">
        <div className="route-map" role="application" tabIndex={0} aria-label={copy.mapLabel} aria-disabled={!gpsReliable} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onWheel={handleWheel} onKeyDown={handleMapKey}>
          <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-hidden="true">
            <defs>
              <pattern id="routeLandHatch" width="10" height="10" patternUnits="userSpaceOnUse">
                <path className="route-land-hatch-mark" d="M-2 10 10-2M6 14 14 6" />
              </pattern>
              <filter id="routeBoatGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <rect className="route-water" width={size} height={size} />
            {hatchPath && <path className="route-land-area" d={hatchPath} />}
            <g className="route-coast-layer">{segments.map((segment, index) => {
              const start = point({ longitude: segment[0], latitude: segment[1] });
              const end = point({ longitude: segment[2], latitude: segment[3] });
              return <line key={`${segment.join(":")}:${index}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
            })}</g>
            {routePoints && <polyline className={`planned-route ${route?.mode ?? ""}`} points={routePoints} />}
            {targetPoint && <g className="route-target" transform={`translate(${targetPoint.x} ${targetPoint.y})`}><circle r="10" /><path d="M0-14 8 0 0 14-8 0Z" /><circle r="3" /></g>}
            {boatPoint && <g className="route-boat" transform={`translate(${boatPoint.x} ${boatPoint.y})`} filter="url(#routeBoatGlow)"><circle r="13" /><path d="M0-11 7 8 0 5-7 8Z" /></g>}
          </svg>
        </div>
        <div className="route-map-heading">
          <span><strong>{copy.title}</strong><small>{copy.mapHint}</small></span>
          <span className={`route-state ${routeStateClass}`}>{routeStateLabel}</span>
        </div>
        <div className="route-zoom" aria-label="Zoom">
          <button type="button" aria-label={copy.zoomIn} onClick={() => setViewRangeMetres((value) => clampRouteViewRange(value / 1.7))}>+</button>
          <span>{viewRangeMetres >= 1_000 ? `${Math.round(viewRangeMetres / 1_000)} km` : `${Math.round(viewRangeMetres)} m`}</span>
          <button type="button" aria-label={copy.zoomOut} onClick={() => setViewRangeMetres((value) => clampRouteViewRange(value * 1.7))}>−</button>
          <button className="route-recenter" type="button" aria-label={copy.recenter} onClick={recenterMap}>◎</button>
        </div>
      </div>

      <div className="route-summary" aria-live="polite">
        {!gpsReliable ? <p className={`route-message ${gpsNavigationState === "waiting" ? "" : "error"}`}>{gpsIssueMessage}</p> : planning ? <p className="route-message">{copy.calculating}</p> : failure ? <p className="route-message error">{copy.failures[failure]}</p> : route ? (
          <>
            <div className="route-metrics">
              <span><small>{copy.distance}</small><strong>{formatRouteDistance(route.distanceMetres).toFixed(route.distanceMetres < 18_520 ? 1 : 0)} {copy.nauticalMiles}</strong></span>
              <span><small>{copy.eta}</small><strong>{formatRouteEta(route.estimatedSeconds, copy.minutes)}</strong></span>
              <span><small>{copy.clearance}</small><strong>{formatRouteClearance(route.minimumShoreDistanceMetres)}</strong></span>
              <span><small>{copy.bearing}</small><strong>{nextBearing === null ? "—" : `${Math.round(nextBearing).toString().padStart(3, "0")}°`}</strong></span>
            </div>
            <p className={`route-detail ${route.mode}`}>{route.mode === "clearance" ? copy.clearanceDetail(warningConfig.distanceMetres) : copy.restrictedDetail(warningConfig.distanceMetres)}</p>
          </>
        ) : <p className="route-message">{copy.subtitle}</p>}
        <p className="navigation-scope route-scope">{copy.navigationScope}</p>
      </div>

      <div className="route-controls">
        <label className="route-speed"><span><strong>{copy.cruiseSpeed}</strong><small>{copy.cruiseSpeedHint}</small></span><span><input type="number" min="2" max="60" step="1" value={cruiseSpeedKnots} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setCruiseSpeedKnots(clampCruiseSpeed(event.target.valueAsNumber))} /> kn</span></label>
        <div className="route-rule">{copy.rule(warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled)}</div>
        <details className="route-coordinates">
          <summary>{copy.coordinates}</summary>
          <div><label>{copy.latitude}<input inputMode="decimal" value={coordinateLatitude} onChange={(event) => setCoordinateLatitude(event.target.value)} /></label><label>{copy.longitude}<input inputMode="decimal" value={coordinateLongitude} onChange={(event) => setCoordinateLongitude(event.target.value)} /></label><button type="button" disabled={!gpsReliable} onClick={useCoordinates}>{copy.useCoordinates}</button></div>
        </details>
        {target && <button className="route-reset" type="button" onClick={reset}>{copy.reset}</button>}
      </div>
    </section>
  );
}
