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
import type { WarningConfig } from "../lib/warning-config";

type Language = "de" | "en";
type Fix = GeoPoint & { speed: number | null };

const COPY = {
  de: {
    title: "Routenplanung",
    subtitle: "Ziel auf der Karte antippen",
    calculating: "Sichere Wasserroute wird berechnet …",
    noPosition: "Warte auf eine Position, um die Route zu starten.",
    distance: "Strecke",
    eta: "Fahrzeit",
    clearance: "Kleinster Abstand",
    bearing: "Nächster Kurs",
    ready: "ROUTE BEREIT",
    check: "ROUTE PRÜFEN",
    waiting: "ZIEL WÄHLEN",
    safeDetail: (distance: number) => `${distance} m Küstenabstand werden bevorzugt eingehalten.`,
    restrictedDetail: (distance: number) => `Die Route unterschreitet stellenweise ${distance} m – besonders Start und Ziel prüfen.`,
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
      "outside-region": "Ziel liegt außerhalb der verfügbaren Kroatien-Karte.",
      "destination-on-land": "Das gewählte Ziel liegt an Land. Bitte ins Wasser tippen.",
      "too-far": "Das Ziel ist für eine einzelne Offline-Route zu weit entfernt.",
      "no-route": "Keine durchgehende Wasserroute gefunden. Ziel oder Zoom ändern.",
    },
    mapLabel: "Offline-Karte zur Auswahl des Routenziels",
    zoomIn: "Karte vergrößern",
    zoomOut: "Karte verkleinern",
    current: "Boot",
    target: "Ziel",
  },
  en: {
    title: "Route planning",
    subtitle: "Tap a destination on the map",
    calculating: "Calculating a safe water route …",
    noPosition: "Waiting for a position to start routing.",
    distance: "Distance",
    eta: "Travel time",
    clearance: "Minimum clearance",
    bearing: "Next course",
    ready: "ROUTE READY",
    check: "CHECK ROUTE",
    waiting: "CHOOSE TARGET",
    safeDetail: (distance: number) => `The preferred ${distance} m shoreline clearance is maintained.`,
    restrictedDetail: (distance: number) => `Parts of the route are inside ${distance} m – check start and destination carefully.`,
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
      "outside-region": "The destination is outside the available Croatia chart.",
      "destination-on-land": "The selected destination is on land. Tap in the water.",
      "too-far": "The destination is too far for one offline route.",
      "no-route": "No continuous water route found. Change the target or zoom.",
    },
    mapLabel: "Offline map for choosing a route destination",
    zoomIn: "Zoom map in",
    zoomOut: "Zoom map out",
    current: "Boat",
    target: "Target",
  },
} as const;

function formatEta(seconds: number, language: Language) {
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} ${COPY[language].minutes}`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.round((seconds % 3_600) / 60);
  return `${hours}:${minutes.toString().padStart(2, "0")} h`;
}

function formatClearance(distance: number) {
  return distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${Math.round(distance)} m`;
}

export default function RoutePlanner({
  pack,
  fix,
  warningConfig,
  language,
  gpsFresh,
}: {
  pack: CoastlinePack | null;
  fix: Fix | null;
  warningConfig: WarningConfig;
  language: Language;
  gpsFresh: boolean;
}) {
  const copy = COPY[language];
  const [target, setTarget] = useState<GeoPoint | null>(null);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [failure, setFailure] = useState<RoutePlanningFailure | null>(null);
  const [planning, setPlanning] = useState(false);
  const [viewRangeMetres, setViewRangeMetres] = useState(20_000);
  const [cruiseSpeedKnots, setCruiseSpeedKnots] = useState(16);
  const [coordinateLatitude, setCoordinateLatitude] = useState("");
  const [coordinateLongitude, setCoordinateLongitude] = useState("");
  const plannedFrom = useRef<GeoPoint | null>(null);
  const calculationSequence = useRef(0);

  const calculate = useCallback((destination: GeoPoint, startOverride?: GeoPoint) => {
    const start = startOverride ?? fix;
    if (!pack || !start) return;
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
      });
      if (sequence !== calculationSequence.current) return;
      setRoute(result.route ?? null);
      setFailure(result.failure ?? null);
      plannedFrom.current = start;
      setPlanning(false);
    }, 30);
  }, [cruiseSpeedKnots, fix, pack, warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled]);

  const selectTarget = useCallback((destination: GeoPoint) => {
    setTarget(destination);
    setCoordinateLatitude(destination.latitude.toFixed(6));
    setCoordinateLongitude(destination.longitude.toFixed(6));
    if (fix) setViewRangeMetres((current) => Math.min(120_000, Math.max(current, geoDistanceMetres(fix, destination) * 1.15)));
    calculate(destination);
  }, [calculate, fix]);

  useEffect(() => {
    if (!target || !fix || !plannedFrom.current || planning) return;
    if (geoDistanceMetres(plannedFrom.current, fix) < Math.max(250, warningConfig.distanceMetres)) return;
    const timer = window.setTimeout(() => calculate(target, fix), 500);
    return () => window.clearTimeout(timer);
  }, [calculate, fix, planning, target, warningConfig.distanceMetres]);

  useEffect(() => {
    if (!target || !fix) return;
    const timer = window.setTimeout(() => calculate(target, fix), 0);
    return () => window.clearTimeout(timer);
  // Reroute when a planning preference changes; live position changes are handled by the distance threshold above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cruiseSpeedKnots, warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled]);

  const size = 360;
  const centre = size / 2;
  const mapCentre = fix ?? target ?? { longitude: 15.55, latitude: 43.8 };
  const metresPerLongitudeDegree = 111_320 * Math.cos((mapCentre.latitude * Math.PI) / 180);
  const pixelsPerMetre = centre / viewRangeMetres;
  const point = useCallback((value: GeoPoint) => ({
    x: centre + (value.longitude - mapCentre.longitude) * metresPerLongitudeDegree * pixelsPerMetre,
    y: centre - (value.latitude - mapCentre.latitude) * 110_540 * pixelsPerMetre,
  }), [centre, mapCentre.latitude, mapCentre.longitude, metresPerLongitudeDegree, pixelsPerMetre]);
  const segments = useMemo(() => pack && fix
    ? getNearbyShorelineSegments(pack, mapCentre.longitude, mapCentre.latitude, viewRangeMetres * 1.45, 5_000)
    : [], [fix, mapCentre.latitude, mapCentre.longitude, pack, viewRangeMetres]);
  const hatchPath = useMemo(() => {
    if (!pack || !fix) return "";
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
  }, [centre, fix, mapCentre.latitude, mapCentre.longitude, metresPerLongitudeDegree, pack, pixelsPerMetre, viewRangeMetres]);
  const routePoints = route?.points.map(point).map(({ x, y }) => `${x},${y}`).join(" ") ?? "";
  const boatPoint = fix ? point(fix) : null;
  const targetPoint = target ? point(target) : null;
  const nextRoutePoint = route && fix
    ? route.points.find((candidate, index) => index > 0 && geoDistanceMetres(fix, candidate) > 120) ?? target
    : null;
  const nextBearing = fix && nextRoutePoint ? geoBearing(fix, nextRoutePoint) : null;

  const handleMapPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!fix || planning) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * size;
    const y = (event.clientY - bounds.top) / bounds.height * size;
    selectTarget({
      longitude: mapCentre.longitude + (x - centre) / (metresPerLongitudeDegree * pixelsPerMetre),
      latitude: mapCentre.latitude + (centre - y) / (110_540 * pixelsPerMetre),
    });
  };

  const useCoordinates = () => {
    const latitude = Number.parseFloat(coordinateLatitude.replace(",", "."));
    const longitude = Number.parseFloat(coordinateLongitude.replace(",", "."));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
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

  return (
    <section className="route-planner" aria-label={copy.title}>
      <div className="route-map-wrap">
        <button className="route-map" type="button" onPointerUp={handleMapPointer} aria-label={copy.mapLabel} disabled={!fix || planning}>
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
        </button>
        <div className="route-map-heading">
          <span><strong>{copy.title}</strong><small>{copy.subtitle}</small></span>
          <span className={`route-state ${route?.mode === "restricted" || failure ? "check" : route ? "ready" : ""}`}>{planning ? "…" : failure || route?.mode === "restricted" ? copy.check : route ? copy.ready : copy.waiting}</span>
        </div>
        <div className="route-zoom" aria-label="Zoom">
          <button type="button" aria-label={copy.zoomIn} onClick={() => setViewRangeMetres((value) => Math.max(2_500, value / 1.7))}>+</button>
          <span>{viewRangeMetres >= 1_000 ? `${Math.round(viewRangeMetres / 1_000)} km` : `${Math.round(viewRangeMetres)} m`}</span>
          <button type="button" aria-label={copy.zoomOut} onClick={() => setViewRangeMetres((value) => Math.min(120_000, value * 1.7))}>−</button>
        </div>
      </div>

      <div className="route-summary" aria-live="polite">
        {planning ? <p className="route-message">{copy.calculating}</p> : failure ? <p className="route-message error">{copy.failures[failure]}</p> : route ? (
          <>
            <div className="route-metrics">
              <span><small>{copy.distance}</small><strong>{formatRouteDistance(route.distanceMetres).toFixed(route.distanceMetres < 18_520 ? 1 : 0)} {copy.nauticalMiles}</strong></span>
              <span><small>{copy.eta}</small><strong>{formatEta(route.estimatedSeconds, language)}</strong></span>
              <span><small>{copy.clearance}</small><strong>{formatClearance(route.minimumShoreDistanceMetres)}</strong></span>
              <span><small>{copy.bearing}</small><strong>{nextBearing === null ? "—" : `${Math.round(nextBearing).toString().padStart(3, "0")}°`}</strong></span>
            </div>
            <p className={`route-detail ${route.mode}`}>{route.mode === "clearance" ? copy.safeDetail(warningConfig.distanceMetres) : copy.restrictedDetail(warningConfig.distanceMetres)}</p>
          </>
        ) : <p className="route-message">{fix && gpsFresh ? copy.subtitle : copy.noPosition}</p>}
      </div>

      <div className="route-controls">
        <label className="route-speed"><span><strong>{copy.cruiseSpeed}</strong><small>{copy.cruiseSpeedHint}</small></span><span><input type="number" min="2" max="60" step="1" value={cruiseSpeedKnots} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setCruiseSpeedKnots(Math.max(2, Math.min(60, event.target.valueAsNumber)))} /> kn</span></label>
        <div className="route-rule">{copy.rule(warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled)}</div>
        <details className="route-coordinates">
          <summary>{copy.coordinates}</summary>
          <div><label>{copy.latitude}<input inputMode="decimal" value={coordinateLatitude} onChange={(event) => setCoordinateLatitude(event.target.value)} /></label><label>{copy.longitude}<input inputMode="decimal" value={coordinateLongitude} onChange={(event) => setCoordinateLongitude(event.target.value)} /></label><button type="button" onClick={useCoordinates}>{copy.useCoordinates}</button></div>
        </details>
        {target && <button className="route-reset" type="button" onClick={reset}>{copy.reset}</button>}
      </div>
    </section>
  );
}
