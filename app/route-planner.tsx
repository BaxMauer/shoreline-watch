"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { findNearestShore, getLandIntervalsAtLatitude, getNearbyShorelineSegments, type CoastlinePack } from "../lib/shoreline";
import {
  formatRouteDistance,
  geoBearing,
  type GeoPoint,
  type PlannedRoute,
  type RoutePlanningFailure,
} from "../lib/route-planning";
import {
  RoutePlanningWorkerController,
  type RoutePlanningWorker,
} from "../lib/route-planning-worker";
import {
  EMODNET_BATHYMETRY_ATTRIBUTION,
  buildEmodnetBathymetryTiles,
  canPlanRoute,
  clampActiveRouteViewRange,
  clampCruiseSpeed,
  clampRouteViewRange,
  formatRouteClearance,
  formatRouteEta,
  getActiveRouteViewRange,
  getProgressAwareRouteGuidance,
  getRouteMapPreviewTransform,
  getRouteMapRenderingDetail,
  getRouteReadinessState,
  hasReachedRouteTarget,
  parseRouteCoordinate,
  panRouteMapCentre,
  pinchRouteViewRange,
  routeCoordinateIsValid,
  routeMapPixelToGeo,
  routeProgressPercent,
  routeRemainingDistance,
  routeViewRangeForTarget,
  shouldRerouteRoute,
} from "../lib/route-ui";
import { formatCurrentDepth, type CurrentDepthState } from "../lib/bathymetry";
import {
  ROUTE_MAP_LONG_PRESS_MS,
  ROUTE_MAP_MOVE_TOLERANCE_PX,
  shouldCommitRouteMapLongPress,
} from "../lib/map-gesture";
import {
  mergePlaceSearchResults,
  formatPlaceSearchDetail,
  normalizePlaceSearchText,
  resolvePlaceSearchTarget,
  searchLocalCroatianPlaces,
  type PlaceSearchResult,
} from "../lib/place-search";
import {
  getMapFeaturesInView,
  placeMapFeatureLabels,
  searchCroatianMapFeatures,
  type MapFeaturePack,
} from "../lib/map-features";
import {
  MAXIMUM_NAVIGATION_ACCURACY_METRES,
  type GpsNavigationState,
} from "../lib/navigation-metrics";
import type { WarningConfig } from "../lib/warning-config";
import type { GoNoGoState } from "../lib/navigation-display";
import WindOverlay from "./wind-overlay";
import { windCompassLabel, type WindSample } from "../lib/wind";
import MapOrientationControl from "./map-orientation-control";
import { getMapOrientation, rotateMapDelta, rotateMapPoint } from "../lib/map-orientation";

type Language = "de" | "en";
type Fix = GeoPoint & { speed: number | null; accuracy?: number; heading?: number | null };
type RoutePlannerFailure = RoutePlanningFailure | "calculation-failed";
type StartMode = "gps" | "manual";
type MapEditMode = "start" | "target";
type JourneyState = "planning" | "active" | "arrived";

const COPY = {
  de: {
    title: "Routenplanung",
    navigation: "Navigation",
    subtitle: "Start und Ziel eingeben oder auf der Karte setzen",
    calculating: "Wasserroute wird berechnet …",
    noPosition: "Für die aktive Reise wird ein aktueller GPS-Fix benötigt.",
    gpsInaccurate: (accuracy: string, maximum: number) => `GPS ±${accuracy} m ist zu ungenau. Für die Reise sind höchstens ±${maximum} m erforderlich.`,
    gpsStale: "GPS-Position ist veraltet. Reise erst nach einem neuen Fix starten oder fortsetzen.",
    gpsLost: "GPS-Signal verloren. Reise erst nach einem neuen Fix starten oder fortsetzen.",
    distance: "Strecke",
    remaining: "Verbleibend",
    eta: "Fahrzeit",
    remainingEta: "Restzeit",
    clearance: "Kleinster Abstand",
    bearing: "Nächster Kurs",
    shore: "Küste",
    nearestShore: "Nächste Küste",
    currentSpeed: "Geschwindigkeit",
    go: "GO",
    noGo: "NO GO",
    goUnknown: "PRÜFEN",
    metres: "Meter",
    kilometres: "Kilometer",
    chartDepth: "Kartentiefe",
    ready: "ROUTE BEREIT",
    check: "ROUTE PRÜFEN",
    waiting: "PUNKTE SETZEN",
    navigating: "REISE AKTIV",
    following: "Bootszentrierte Live-Ansicht",
    arrived: "ZIEL ERREICHT",
    clearanceDetail: (distance: number) => `Die berechnete Küstenlinien-Geometrie hält den bevorzugten Abstand von ${distance} m ein.`,
    restrictedDetail: (distance: number) => `Die berechnete Küstenlinien-Geometrie unterschreitet stellenweise ${distance} m – besonders Start und Ziel prüfen.`,
    tisnoPassage: "Tisno-Klappbrücke: Nur bei geöffneter Brücke nutzen. Öffnung, Tiefe, Durchfahrtshöhe, Strömung, Verkehr und lokale Signale vor der Fahrt prüfen.",
    rule: (distance: number, speed: number, enabled: boolean) => enabled
      ? `${distance} m Abstand · ${speed} kn küstennah`
      : `${distance} m Abstand · Tempolimit aus`,
    reset: "Planung löschen",
    start: "Start",
    target: "Ziel",
    currentGps: "Aktuelles GPS",
    manualPoint: "Manueller Punkt",
    latitude: "Breite",
    longitude: "Länge",
    useGps: "GPS verwenden",
    setStartOnMap: "Start auf Karte setzen",
    setTargetOnMap: "Ziel auf Karte setzen",
    tapSetsStart: "Tippen setzt den Start",
    tapSetsTarget: "Tippen setzt das Ziel",
    holdSetsStart: "Für Start gedrückt halten",
    holdSetsTarget: "Für Ziel gedrückt halten",
    holdingPoint: "Weiter gedrückt halten …",
    placeSearch: "Ort, Bucht oder Insel suchen",
    search: "Suchen",
    searchLoading: "Suche in kroatischen Küstenorten …",
    searchEmpty: "Kein passender Ort gefunden.",
    searchOffline: "Online-Suche nicht erreichbar – lokale Treffer werden angezeigt.",
    searchHint: (name: string) => `${name} · Ziel automatisch im Wasser gesetzt`,
    swap: "Start und Ziel tauschen",
    calculateRoute: "Route berechnen",
    invalidCoordinates: "Bitte gültige Breiten- und Längengrade eingeben.",
    cruiseSpeed: "Planungstempo",
    cruiseSpeedHint: "Außerhalb des Warnbereichs",
    nauticalMiles: "sm",
    minutes: "Min.",
    depthLayer: "Tiefenkarte",
    depthLoading: "Tiefen werden geladen",
    depthUnavailable: "Tiefenebene momentan nicht verfügbar",
    depthSource: "EMODnet 2024 · Übersicht",
    shallow: "SEICHT",
    wind: "Wind",
    windUnavailable: "Wind nicht verfügbar · erneut versuchen",
    gust: "Böen",
    pointsPanel: "Start & Ziel",
    optionsPanel: "Routenoptionen",
    edit: "Bearbeiten",
    routeNotes: "Routenhinweise",
    routeNoteCount: (count: number) => `${count} ${count === 1 ? "Hinweis" : "Hinweise"}`,
    conditionalPassages: "Bedingte Durchfahrten",
    conditionalPassagesHint: "z. B. Tisno-Klappbrücke",
    startJourney: "Reise starten",
    startingJourney: "Route ab GPS wird aktualisiert …",
    endJourney: "Reise beenden",
    finishJourney: "Ankunft abschließen",
    liveGpsNeeded: "Zum Starten der Reise ist ein zuverlässiger Live-GPS-Fix nötig.",
    progress: "Fortschritt",
    failures: {
      "outside-region": "Start oder Ziel liegt außerhalb des verfügbaren Kroatien-Küstendatensatzes.",
      "destination-on-land": "Das gewählte Ziel liegt laut Küstengeometrie an Land. Bitte ins Wasser tippen.",
      "too-far": "Das Ziel ist für eine einzelne Offline-Route zu weit entfernt.",
      "no-route": "Keine durchgehende Wasserroute gefunden. Bitte Start, Ziel oder Küstenabstand ändern.",
      "calculation-failed": "Die Routenberechnung ist fehlgeschlagen. Bitte erneut versuchen.",
    },
    mapLabel: "Karte zur Auswahl von Start und Ziel",
    zoomIn: "Karte vergrößern",
    zoomOut: "Karte verkleinern",
    recenter: "Boot zentrieren",
    fitRoute: "Ganze Route anzeigen",
  },
  en: {
    title: "Route planning",
    navigation: "Navigation",
    subtitle: "Enter a start and destination or place them on the map",
    calculating: "Calculating water route …",
    noPosition: "A current GPS fix is required for active travel.",
    gpsInaccurate: (accuracy: string, maximum: number) => `GPS ±${accuracy} m is too inaccurate. Travel requires ±${maximum} m or better.`,
    gpsStale: "GPS position is stale. Start or continue after a new fix.",
    gpsLost: "GPS signal lost. Start or continue after a new fix.",
    distance: "Distance",
    remaining: "Remaining",
    eta: "Travel time",
    remainingEta: "Time left",
    clearance: "Minimum clearance",
    bearing: "Next course",
    shore: "Shore",
    nearestShore: "Nearest shore",
    currentSpeed: "Speed",
    go: "GO",
    noGo: "NO GO",
    goUnknown: "CHECK",
    metres: "metres",
    kilometres: "kilometres",
    chartDepth: "Chart depth",
    ready: "ROUTE READY",
    check: "CHECK ROUTE",
    waiting: "SET POINTS",
    navigating: "TRIP ACTIVE",
    following: "Boat-centred live view",
    arrived: "DESTINATION REACHED",
    clearanceDetail: (distance: number) => `The calculated shoreline geometry maintains the preferred ${distance} m clearance.`,
    restrictedDetail: (distance: number) => `The calculated shoreline geometry is inside ${distance} m in places – check start and destination carefully.`,
    tisnoPassage: "Tisno lift bridge: use only while raised. Verify opening, depth, air draft, current, traffic, and local signals before departure.",
    rule: (distance: number, speed: number, enabled: boolean) => enabled
      ? `${distance} m clearance · ${speed} kn near shore`
      : `${distance} m clearance · speed rule off`,
    reset: "Clear plan",
    start: "Start",
    target: "Destination",
    currentGps: "Current GPS",
    manualPoint: "Manual point",
    latitude: "Latitude",
    longitude: "Longitude",
    useGps: "Use GPS",
    setStartOnMap: "Place start on map",
    setTargetOnMap: "Place destination on map",
    tapSetsStart: "Tap places the start",
    tapSetsTarget: "Tap places the destination",
    holdSetsStart: "Press and hold to place the start",
    holdSetsTarget: "Press and hold to place the destination",
    holdingPoint: "Keep holding …",
    placeSearch: "Search town, bay, or island",
    search: "Search",
    searchLoading: "Searching Croatian coastal places …",
    searchEmpty: "No matching place found.",
    searchOffline: "Online search unavailable — showing local matches.",
    searchHint: (name: string) => `${name} · destination placed in the water automatically`,
    swap: "Swap start and destination",
    calculateRoute: "Calculate route",
    invalidCoordinates: "Enter valid latitude and longitude values.",
    cruiseSpeed: "Planning speed",
    cruiseSpeedHint: "Outside the warning area",
    nauticalMiles: "nm",
    minutes: "min",
    depthLayer: "Depth map",
    depthLoading: "Loading depths",
    depthUnavailable: "Depth layer is currently unavailable",
    depthSource: "EMODnet 2024 · overview",
    shallow: "SHALLOW",
    wind: "Wind",
    windUnavailable: "Wind unavailable · retry",
    gust: "Gusts",
    pointsPanel: "Start & destination",
    optionsPanel: "Route options",
    edit: "Edit",
    routeNotes: "Route notes",
    routeNoteCount: (count: number) => `${count} ${count === 1 ? "note" : "notes"}`,
    conditionalPassages: "Conditional passages",
    conditionalPassagesHint: "e.g. Tisno lift bridge",
    startJourney: "Start trip",
    startingJourney: "Updating route from GPS …",
    endJourney: "End trip",
    finishJourney: "Finish arrival",
    liveGpsNeeded: "A reliable live GPS fix is required to start the trip.",
    progress: "Progress",
    failures: {
      "outside-region": "The start or destination is outside the available Croatia shoreline dataset.",
      "destination-on-land": "The selected destination is on land according to the shoreline geometry. Tap in the water.",
      "too-far": "The destination is too far for one offline route.",
      "no-route": "No continuous water route found. Change the start, destination, or shoreline clearance.",
      "calculation-failed": "Route calculation failed. Please try again.",
    },
    mapLabel: "Map for choosing a route start and destination",
    zoomIn: "Zoom map in",
    zoomOut: "Zoom map out",
    recenter: "Centre on boat",
    fitRoute: "Show full route",
  },
} as const;

function coordinateText(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : "";
}

export default function RoutePlanner({
  pack,
  fix,
  warningConfig,
  language,
  gpsNavigationState,
  shoreDistanceMetres,
  proximityRangeMetres,
  currentDepthMetres,
  currentDepthState,
  mapFeaturePack,
  goNoGoState,
  windSample,
  windState,
  showWind,
  onToggleWind,
  headingUp,
  onToggleHeadingUp,
}: {
  pack: CoastlinePack | null;
  fix: Fix | null;
  warningConfig: WarningConfig;
  language: Language;
  gpsNavigationState: GpsNavigationState;
  shoreDistanceMetres: number | null;
  proximityRangeMetres: number;
  currentDepthMetres: number | null;
  currentDepthState: CurrentDepthState;
  mapFeaturePack: MapFeaturePack | null;
  goNoGoState: GoNoGoState;
  windSample: WindSample | null;
  windState: "idle" | "loading" | "ready" | "offline" | "error";
  showWind: boolean;
  onToggleWind: () => void;
  headingUp: boolean;
  onToggleHeadingUp: () => void;
}) {
  const copy = COPY[language];
  const gpsReliable = canPlanRoute(gpsNavigationState, fix);
  const [startMode, setStartMode] = useState<StartMode>("gps");
  const [manualStart, setManualStart] = useState<GeoPoint | null>(null);
  const [target, setTarget] = useState<GeoPoint | null>(null);
  const [mapEditMode, setMapEditMode] = useState<MapEditMode>("target");
  const [journeyState, setJourneyState] = useState<JourneyState>("planning");
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [failure, setFailure] = useState<RoutePlannerFailure | null>(null);
  const [planning, setPlanning] = useState(false);
  const [startingJourney, setStartingJourney] = useState(false);
  const [viewRangeMetres, setViewRangeMetres] = useState(20_000);
  const [viewCentre, setViewCentre] = useState<GeoPoint | null>(null);
  const [cruiseSpeedKnots, setCruiseSpeedKnots] = useState(16);
  const [conditionalPassagesEnabled, setConditionalPassagesEnabled] = useState(true);
  const [showDepths, setShowDepths] = useState(true);
  const [depthStatus, setDepthStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [startLatitude, setStartLatitude] = useState("");
  const [startLongitude, setStartLongitude] = useState("");
  const [targetLatitude, setTargetLatitude] = useState("");
  const [targetLongitude, setTargetLongitude] = useState("");
  const [inputError, setInputError] = useState(false);
  const [longPressActive, setLongPressActive] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [placeSearchState, setPlaceSearchState] = useState<"idle" | "loading" | "ready" | "offline">("idle");
  const [placeSearchOpen, setPlaceSearchOpen] = useState(false);
  const [activePlaceIndex, setActivePlaceIndex] = useState(-1);
  const [focusedPlace, setFocusedPlace] = useState<PlaceSearchResult | null>(null);
  const plannedFrom = useRef<GeoPoint | null>(null);
  const [journeyProgressMetres, setJourneyProgressMetres] = useState(0);
  const rerouteTimer = useRef<number | null>(null);
  const latestRerouteFix = useRef<Fix | null>(fix);
  const routeWorker = useRef<RoutePlanningWorkerController | null>(null);
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const mapGesture = useRef<{ centre: GeoPoint; range: number; centroid: { x: number; y: number }; distance: number; moved: boolean } | null>(null);
  const mapViewFrame = useRef<number | null>(null);
  const pendingMapView = useRef<{ centre: GeoPoint; range: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressCandidate = useRef<{ pointerId: number; startedAt: number; point: GeoPoint } | null>(null);
  const placeSearchController = useRef<AbortController | null>(null);
  const pendingPlaceTarget = useRef<PlaceSearchResult | null>(null);
  const depthLoadState = useRef({ key: "", loaded: 0, failed: 0 });
  const routeEditor = useRef<HTMLDetailsElement | null>(null);
  const routePlanner = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (journeyState === "active") routePlanner.current?.scrollTo({ top: 0 });
  }, [journeyState]);

  const effectiveStart = startMode === "manual" ? manualStart : fix;
  const parsedManualStart = startMode === "manual" ? {
    latitude: parseRouteCoordinate(startLatitude),
    longitude: parseRouteCoordinate(startLongitude),
  } : null;
  const planningStartAvailable = startMode === "manual"
    ? manualStart !== null || (parsedManualStart?.latitude !== null && parsedManualStart?.longitude !== null)
    : gpsReliable;
  const localPlaceResults = useMemo(() => searchLocalCroatianPlaces(placeQuery), [placeQuery]);
  const catalogPlaceResults = useMemo(() => searchCroatianMapFeatures(mapFeaturePack, placeQuery), [mapFeaturePack, placeQuery]);
  const visiblePlaceResults = useMemo(
    () => mergePlaceSearchResults(placeQuery, localPlaceResults, catalogPlaceResults, placeResults),
    [catalogPlaceResults, localPlaceResults, placeQuery, placeResults],
  );

  const clearPendingReroute = useCallback(() => {
    if (rerouteTimer.current === null) return;
    window.clearTimeout(rerouteTimer.current);
    rerouteTimer.current = null;
  }, []);

  useEffect(() => {
    const controller = new RoutePlanningWorkerController(() => new Worker(
      new URL("../workers/route-planning.worker.ts", import.meta.url),
      { type: "module", name: "shoreline-route-planning" },
    ) as RoutePlanningWorker);
    routeWorker.current = controller;
    return () => {
      controller.dispose();
      if (routeWorker.current === controller) routeWorker.current = null;
    };
  }, []);

  useEffect(() => () => clearPendingReroute(), [clearPendingReroute]);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (mapViewFrame.current !== null) window.cancelAnimationFrame(mapViewFrame.current);
    placeSearchController.current?.abort();
  }, []);

  useEffect(() => {
    if ((journeyState !== "active" && startMode !== "gps") || gpsReliable) return;
    clearPendingReroute();
    routeWorker.current?.cancel();
    const timer = window.setTimeout(() => {
      setPlanning(false);
      setStartingJourney(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clearPendingReroute, gpsReliable, journeyState, startMode]);

  const calculate = useCallback((destination: GeoPoint, startOverride?: GeoPoint, activateJourney = false) => {
    const requestedStart = startOverride ?? effectiveStart;
    const controller = routeWorker.current;
    if (!controller || !pack || !requestedStart || !routeCoordinateIsValid(requestedStart) || !routeCoordinateIsValid(destination)) return;
    const gpsStart = requestedStart === fix;
    if (gpsStart && !gpsReliable) return;
    const routingStart = resolvePlaceSearchTarget(pack, requestedStart, undefined, destination);
    const wasActiveJourney = journeyState === "active";
    setPlanning(true);
    setFailure(null);
    controller.calculate({
      pack,
      start: routingStart,
      destination,
      options: {
        clearanceMetres: warningConfig.distanceMetres,
        cruiseSpeedKnots,
        speedWarningEnabled: warningConfig.speedWarningEnabled,
        nearShoreSpeedKnots: warningConfig.maxSpeedKnots,
        startAccuracyMetres: gpsStart ? fix?.accuracy : undefined,
        conditionalPassagesEnabled,
      },
    }, {
      onResult: (result) => {
        setRoute(result.route ?? null);
        setFailure(result.failure ?? null);
        plannedFrom.current = requestedStart;
        setJourneyProgressMetres(0);
        setPlanning(false);
        setStartingJourney(false);
        if (activateJourney && result.route) {
          setJourneyState("active");
          setStartMode("gps");
          if (!wasActiveJourney) {
            setViewCentre(null);
            setViewRangeMetres(getActiveRouteViewRange(proximityRangeMetres, warningConfig.distanceMetres));
          }
        }
      },
      onError: () => {
        setRoute(null);
        setFailure("calculation-failed");
        setPlanning(false);
        setStartingJourney(false);
      },
    });
  }, [conditionalPassagesEnabled, cruiseSpeedKnots, effectiveStart, fix, gpsReliable, journeyState, pack, proximityRangeMetres, warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled]);

  const fitRoute = useCallback((start = effectiveStart, destination = target) => {
    if (!start || !destination) return;
    setViewCentre({ longitude: (start.longitude + destination.longitude) / 2, latitude: (start.latitude + destination.latitude) / 2 });
    setViewRangeMetres(clampRouteViewRange(routeViewRangeForTarget(2_500, start, destination) * .62));
  }, [effectiveStart, target]);

  const selectTarget = useCallback((destination: GeoPoint, start = effectiveStart) => {
    const navigableDestination = resolvePlaceSearchTarget(pack, destination, undefined, start);
    setTarget(navigableDestination);
    setTargetLatitude(coordinateText(navigableDestination.latitude));
    setTargetLongitude(coordinateText(navigableDestination.longitude));
    setInputError(false);
    if (start) {
      fitRoute(start, navigableDestination);
      calculate(navigableDestination, start);
    }
  }, [calculate, effectiveStart, fitRoute, pack]);

  const selectStart = useCallback((start: GeoPoint) => {
    const navigableStart = resolvePlaceSearchTarget(pack, start, undefined, target);
    setStartMode("manual");
    setManualStart(navigableStart);
    setStartLatitude(coordinateText(navigableStart.latitude));
    setStartLongitude(coordinateText(navigableStart.longitude));
    setInputError(false);
    setMapEditMode("target");
    if (target) {
      fitRoute(navigableStart, target);
      calculate(target, navigableStart);
    }
  }, [calculate, fitRoute, pack, target]);

  const focusPlaceResult = (result: PlaceSearchResult) => {
    const destination = resolvePlaceSearchTarget(pack, result, undefined, effectiveStart);
    pendingPlaceTarget.current = pack ? null : result;
    setFocusedPlace({ ...result, ...destination });
    setPlaceQuery(result.name);
    setPlaceSearchOpen(false);
    setActivePlaceIndex(-1);
    selectTarget(destination);
    if (!effectiveStart) {
      setViewCentre(destination);
      setViewRangeMetres(clampRouteViewRange(result.kind === "place" ? 3_000 : 5_000));
    }
  };

  const handlePlaceSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setPlaceSearchOpen(false);
      setActivePlaceIndex(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!visiblePlaceResults.length) return;
      event.preventDefault();
      setPlaceSearchOpen(true);
      setActivePlaceIndex((current) => event.key === "ArrowDown"
        ? (current + 1 + visiblePlaceResults.length) % visiblePlaceResults.length
        : (current - 1 + visiblePlaceResults.length) % visiblePlaceResults.length);
      return;
    }
    if (event.key === "Enter" && placeSearchOpen && activePlaceIndex >= 0) {
      const result = visiblePlaceResults[activePlaceIndex];
      if (!result) return;
      event.preventDefault();
      focusPlaceResult(result);
    }
  };

  useEffect(() => {
    const result = pendingPlaceTarget.current;
    if (!pack || !result) return;
    pendingPlaceTarget.current = null;
    const destination = resolvePlaceSearchTarget(pack, result, undefined, effectiveStart);
    setFocusedPlace((current) => current ? { ...current, ...destination } : current);
    selectTarget(destination);
  }, [effectiveStart, pack, selectTarget]);

  const runPlaceSearch = async () => {
    const query = placeQuery.trim();
    const localResults = searchLocalCroatianPlaces(query);
    const catalogResults = searchCroatianMapFeatures(mapFeaturePack, query);
    if (normalizePlaceSearchText(query).length < 2) {
      setPlaceResults([]);
      setPlaceSearchOpen(true);
      return;
    }
    placeSearchController.current?.abort();
    const controller = new AbortController();
    placeSearchController.current = controller;
    setPlaceSearchState("loading");
    setPlaceSearchOpen(true);
    try {
      const response = await fetch(`/api/places?q=${encodeURIComponent(query)}&lang=${language}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Place search returned ${response.status}`);
      const payload = await response.json() as { results?: PlaceSearchResult[] };
      if (controller.signal.aborted) return;
      const remoteResults = Array.isArray(payload.results) ? payload.results : [];
      setPlaceResults(mergePlaceSearchResults(query, localResults, catalogResults, remoteResults));
      setPlaceSearchState("ready");
    } catch {
      if (controller.signal.aborted) return;
      setPlaceResults(mergePlaceSearchResults(query, localResults, catalogResults));
      setPlaceSearchState("offline");
    }
  };

  useEffect(() => {
    latestRerouteFix.current = fix;
    if (journeyState !== "active" || !target || !gpsReliable || planning) {
      clearPendingReroute();
      return;
    }
    if (!fix || !plannedFrom.current || !shouldRerouteRoute(plannedFrom.current, fix, warningConfig.distanceMetres) || rerouteTimer.current !== null) return;
    rerouteTimer.current = window.setTimeout(() => {
      rerouteTimer.current = null;
      const rerouteFix = latestRerouteFix.current;
      if (!rerouteFix || !plannedFrom.current || !shouldRerouteRoute(plannedFrom.current, rerouteFix, warningConfig.distanceMetres)) return;
      calculate(target, rerouteFix, true);
    }, 500);
  }, [calculate, clearPendingReroute, fix, gpsReliable, journeyState, planning, target, warningConfig.distanceMetres]);

  useEffect(() => {
    if (journeyState === "active" || !target || !planningStartAvailable || !effectiveStart) return;
    const timer = window.setTimeout(() => calculate(target, effectiveStart), 0);
    return () => window.clearTimeout(timer);
  // Re-plan when preferences change; point changes calculate directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionalPassagesEnabled, cruiseSpeedKnots, warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled]);

  const size = 360;
  const centre = size / 2;
  const mapCentre = useMemo(() => viewCentre ?? fix ?? manualStart ?? target ?? { longitude: 15.55, latitude: 43.8 }, [fix, manualStart, target, viewCentre]);
  const metresPerLongitudeDegree = 111_320 * Math.cos((mapCentre.latitude * Math.PI) / 180);
  const pixelsPerMetre = centre / viewRangeMetres;
  const [renderedMapView, setRenderedMapView] = useState(() => ({ centre: mapCentre, rangeMetres: viewRangeMetres }));
  const renderedMapTimer = useRef<number | null>(null);
  const point = useCallback((value: GeoPoint) => ({
    x: centre + (value.longitude - mapCentre.longitude) * metresPerLongitudeDegree * pixelsPerMetre,
    y: centre - (value.latitude - mapCentre.latitude) * 110_540 * pixelsPerMetre,
  }), [centre, mapCentre.latitude, mapCentre.longitude, metresPerLongitudeDegree, pixelsPerMetre]);

  useEffect(() => {
    if (renderedMapTimer.current !== null) window.clearTimeout(renderedMapTimer.current);
    renderedMapTimer.current = window.setTimeout(() => {
      renderedMapTimer.current = null;
      setRenderedMapView({ centre: mapCentre, rangeMetres: viewRangeMetres });
    }, 100);
    return () => {
      if (renderedMapTimer.current !== null) window.clearTimeout(renderedMapTimer.current);
    };
  }, [mapCentre, viewRangeMetres]);

  const renderedCentre = renderedMapView.centre;
  const renderedRangeMetres = renderedMapView.rangeMetres;
  const renderedMetresPerLongitudeDegree = 111_320 * Math.cos((renderedCentre.latitude * Math.PI) / 180);
  const renderedPixelsPerMetre = centre / renderedRangeMetres;
  const mapDataRangeMetres = renderedRangeMetres * Math.SQRT2;
  const renderingDetail = getRouteMapRenderingDetail(renderedRangeMetres);
  const renderedPoint = useCallback((value: GeoPoint) => ({
    x: centre + (value.longitude - renderedCentre.longitude) * renderedMetresPerLongitudeDegree * renderedPixelsPerMetre,
    y: centre - (value.latitude - renderedCentre.latitude) * 110_540 * renderedPixelsPerMetre,
  }), [centre, renderedCentre.latitude, renderedCentre.longitude, renderedMetresPerLongitudeDegree, renderedPixelsPerMetre]);
  const previewTransform = getRouteMapPreviewTransform(renderedCentre, renderedRangeMetres, mapCentre, viewRangeMetres, size);
  const staticMapTransform = `translate(${previewTransform.translateX} ${previewTransform.translateY}) translate(${centre} ${centre}) scale(${previewTransform.scale}) translate(${-centre} ${-centre})`;
  const segments = useMemo(() => pack ? getNearbyShorelineSegments(pack, renderedCentre.longitude, renderedCentre.latitude, mapDataRangeMetres * 1.1, renderingDetail.maximumShorelineSegments) : [], [mapDataRangeMetres, pack, renderedCentre.latitude, renderedCentre.longitude, renderingDetail.maximumShorelineSegments]);
  const bathymetryTiles = useMemo(() => showDepths ? buildEmodnetBathymetryTiles(renderedCentre, mapDataRangeMetres, 720) : [], [mapDataRangeMetres, renderedCentre, showDepths]);
  const bathymetryKey = bathymetryTiles.map((tile) => tile.key).join("|");
  const hatchBands = useMemo(() => {
    if (!pack) return [];
    const bandHeight = renderingDetail.hatchBandHeight;
    const extent = centre * Math.SQRT2;
    const minimumLongitude = renderedCentre.longitude - mapDataRangeMetres / renderedMetresPerLongitudeDegree;
    const maximumLongitude = renderedCentre.longitude + mapDataRangeMetres / renderedMetresPerLongitudeDegree;
    const bands: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let y = centre - extent; y < centre + extent; y += bandHeight) {
      const latitude = renderedCentre.latitude + (centre - y - bandHeight / 2) / (110_540 * renderedPixelsPerMetre);
      const intervals = getLandIntervalsAtLatitude(pack, latitude, minimumLongitude, maximumLongitude);
      for (const [west, east] of intervals) {
        const left = Math.max(centre - extent, centre + (west - renderedCentre.longitude) * renderedMetresPerLongitudeDegree * renderedPixelsPerMetre);
        const right = Math.min(centre + extent, centre + (east - renderedCentre.longitude) * renderedMetresPerLongitudeDegree * renderedPixelsPerMetre);
        if (right > left) bands.push({ x: left, y, width: right - left, height: bandHeight + .5 });
      }
    }
    return bands;
  }, [centre, mapDataRangeMetres, pack, renderedCentre.latitude, renderedCentre.longitude, renderedMetresPerLongitudeDegree, renderedPixelsPerMetre, renderingDetail.hatchBandHeight]);
  const mapLabels = useMemo(() => placeMapFeatureLabels(
    getMapFeaturesInView(mapFeaturePack, renderedCentre, mapDataRangeMetres).slice(0, renderingDetail.maximumLabels),
    renderedPoint,
    size,
    26,
  ), [mapDataRangeMetres, mapFeaturePack, renderedCentre, renderedPoint, renderingDetail.maximumLabels, size]);

  useEffect(() => {
    depthLoadState.current = { key: bathymetryKey, loaded: 0, failed: 0 };
    const timer = window.setTimeout(() => setDepthStatus(showDepths && bathymetryTiles.length > 0 ? "loading" : "idle"), 0);
    return () => window.clearTimeout(timer);
  }, [bathymetryKey, bathymetryTiles.length, showDepths]);

  const depthTileLoaded = useCallback((key: string) => {
    if (depthLoadState.current.key !== bathymetryKey || !bathymetryKey.includes(key)) return;
    depthLoadState.current.loaded += 1;
    setDepthStatus("ready");
  }, [bathymetryKey]);

  const depthTileFailed = useCallback((key: string) => {
    if (depthLoadState.current.key !== bathymetryKey || !bathymetryKey.includes(key)) return;
    depthLoadState.current.failed += 1;
    if (depthLoadState.current.loaded === 0 && depthLoadState.current.failed >= bathymetryTiles.length) setDepthStatus("error");
  }, [bathymetryKey, bathymetryTiles.length]);

  const routePoints = useMemo(() => route?.points.map(renderedPoint).map(({ x, y }) => `${x},${y}`).join(" ") ?? "", [renderedPoint, route]);
  const boatPoint = fix ? point(fix) : null;
  const mapRotationPivot = boatPoint ?? { x: centre, y: centre };
  const { mapRotationDegrees, boatRotationDegrees } = getMapOrientation(fix?.heading, headingUp);
  const mapOrientationTransform = `rotate(${mapRotationDegrees} ${mapRotationPivot.x} ${mapRotationPivot.y})`;
  const liveNearest = useMemo(() => pack && fix ? findNearestShore(pack, fix.longitude, fix.latitude) : null, [fix, pack]);
  const liveNearestPoint = liveNearest ? point(liveNearest) : null;
  const liveWarningRadius = warningConfig.distanceMetres * pixelsPerMetre;
  const liveShallowRadius = 115 * pixelsPerMetre / 2;
  const liveShallow = warningConfig.shallowWaterEnabled && currentDepthState === "ready" && currentDepthMetres !== null && currentDepthMetres <= warningConfig.shallowWaterMetres;
  const startPoint = useMemo(() => startMode === "manual" && manualStart ? renderedPoint(manualStart) : null, [manualStart, renderedPoint, startMode]);
  const targetPoint = useMemo(() => target ? renderedPoint(target) : null, [renderedPoint, target]);
  const focusedPlacePoint = useMemo(() => focusedPlace ? renderedPoint(focusedPlace) : null, [focusedPlace, renderedPoint]);
  const speedKnots = fix?.speed === null || fix?.speed === undefined ? null : Math.max(0, fix.speed * 1.943844);
  const activeJourney = journeyState === "active" || journeyState === "arrived";
  const activeGoNoGoLabel = goNoGoState === "go" ? copy.go : goNoGoState === "no-go" ? copy.noGo : copy.goUnknown;
  const activeDistanceValue = shoreDistanceMetres === null
    ? "—"
    : shoreDistanceMetres >= 1_000
      ? (shoreDistanceMetres / 1_000).toFixed(1)
      : Math.round(shoreDistanceMetres).toString();
  const activeDistanceUnit = shoreDistanceMetres !== null && shoreDistanceMetres >= 1_000 ? copy.kilometres : copy.metres;
  const staticMapLayers = useMemo(() => <>
    {showDepths && <g className="route-bathymetry-layer">{bathymetryTiles.map((tile) => {
      const northWest = renderedPoint({ longitude: tile.west, latitude: tile.north });
      const southEast = renderedPoint({ longitude: tile.east, latitude: tile.south });
      return <image key={tile.key} className="route-depth-tile" href={tile.url} x={northWest.x} y={northWest.y} width={southEast.x - northWest.x + .5} height={southEast.y - northWest.y + .5} preserveAspectRatio="none" onLoad={() => depthTileLoaded(tile.key)} onError={() => depthTileFailed(tile.key)} />;
    })}</g>}
    <g className="route-land-bands" aria-hidden="true">{hatchBands.map((band, index) => <rect key={index} className="route-land-area" x={band.x} y={band.y} width={band.width} height={band.height} />)}</g>
    <g className="route-coast-layer">{segments.map((segment, index) => {
      const start = renderedPoint({ longitude: segment[0], latitude: segment[1] });
      const end = renderedPoint({ longitude: segment[2], latitude: segment[3] });
      return <line key={`${segment.join(":")}:${index}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
    })}</g>
    <g className="map-feature-labels" aria-hidden="true">{mapLabels.map((label) => <g key={label.id} className={`map-feature-label ${label.kind}`} transform={`translate(${label.x} ${label.y})`}>
      <g transform={`rotate(${-mapRotationDegrees})`}>
        {label.kind === "restaurant" && <circle r="2.2" />}
        <text y={label.kind === "restaurant" ? -4 : 0}>{label.name}</text>
      </g>
    </g>)}</g>
    {routePoints && <polyline className={`planned-route ${route?.mode ?? ""}`} points={routePoints} />}
    {journeyState === "planning" && focusedPlacePoint && <g className="route-search-marker" transform={`translate(${focusedPlacePoint.x} ${focusedPlacePoint.y})`}><g transform={`rotate(${-mapRotationDegrees})`}><circle r="7" /><path d="M0 7 0 15" /><text y="-11">{focusedPlace?.name ?? ""}</text></g></g>}
    {startPoint && <g className="route-start" transform={`translate(${startPoint.x} ${startPoint.y})`}><g transform={`rotate(${-mapRotationDegrees})`}><circle r="10" /><text y="3.5">A</text></g></g>}
    {targetPoint && <g className="route-target" transform={`translate(${targetPoint.x} ${targetPoint.y})`}><g transform={`rotate(${-mapRotationDegrees})`}><circle r="11" /><text y="3.5">B</text></g></g>}
  </>, [bathymetryTiles, depthTileFailed, depthTileLoaded, focusedPlace?.name, focusedPlacePoint, hatchBands, journeyState, mapLabels, mapRotationDegrees, renderedPoint, route?.mode, routePoints, segments, showDepths, startPoint, targetPoint]);
  const guidancePosition = journeyState === "active" || journeyState === "arrived" ? fix : effectiveStart;
  const routeGuidance = useMemo(() => route && guidancePosition ? getProgressAwareRouteGuidance(route.points, guidancePosition, journeyState === "planning" ? 0 : journeyProgressMetres) : null, [guidancePosition, journeyProgressMetres, journeyState, route]);
  const nextBearing = routeGuidance && guidancePosition ? geoBearing(guidancePosition, routeGuidance.target) : null;
  const progressMetres = journeyState === "active" || journeyState === "arrived" ? routeGuidance?.progressMetres ?? 0 : 0;
  const remainingMetres = route ? routeRemainingDistance(route.distanceMetres, progressMetres) : 0;
  const progressPercent = route ? routeProgressPercent(route.distanceMetres, progressMetres) : 0;
  const remainingSeconds = route && route.distanceMetres > 0 ? route.estimatedSeconds * remainingMetres / route.distanceMetres : 0;

  useEffect(() => {
    if (journeyState !== "active" || !routeGuidance) return;
    const timer = window.setTimeout(() => setJourneyProgressMetres((current) => Math.max(current, routeGuidance.progressMetres)), 0);
    return () => window.clearTimeout(timer);
  }, [journeyState, routeGuidance]);

  useEffect(() => {
    if (journeyState !== "active" || !gpsReliable || !fix || !target || !hasReachedRouteTarget(fix, target)) return;
    const timer = window.setTimeout(() => setJourneyState("arrived"), 0);
    return () => window.clearTimeout(timer);
  }, [fix, gpsReliable, journeyState, target]);

  const readinessGpsState = journeyState === "planning" && startMode === "manual" ? "reliable" : gpsNavigationState;
  const routeReadiness = getRouteReadinessState({ gpsNavigationState: readinessGpsState, planning, hasRoute: route !== null, routeRestricted: route?.mode === "restricted", hasFailure: failure !== null });
  const routeStateClass = journeyState === "active" ? "active" : journeyState === "arrived" ? "arrived" : routeReadiness === "ready" ? "ready" : routeReadiness === "check" ? "check" : "";
  const routeStateLabel = journeyState === "active" ? copy.navigating : journeyState === "arrived" ? copy.arrived : routeReadiness === "calculating" ? "…" : routeReadiness === "ready" ? copy.ready : routeReadiness === "check" ? copy.check : copy.waiting;
  const gpsAccuracyLabel = fix && Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy ?? 0).toString() : "—";
  const gpsIssueMessage = gpsNavigationState === "inaccurate" ? copy.gpsInaccurate(gpsAccuracyLabel, MAXIMUM_NAVIGATION_ACCURACY_METRES) : gpsNavigationState === "stale" ? copy.gpsStale : gpsNavigationState === "lost" ? copy.gpsLost : copy.noPosition;

  const pointerMetrics = (element: HTMLDivElement) => {
    const bounds = element.getBoundingClientRect();
    const points = Array.from(activePointers.current.values()).map((value) => ({ x: (value.x - bounds.left) / bounds.width * size, y: (value.y - bounds.top) / bounds.height * size }));
    const centroid = points.reduce((total, value) => ({ x: total.x + value.x / points.length, y: total.y + value.y / points.length }), { x: 0, y: 0 });
    const distance = points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    return { centroid, distance };
  };

  const beginGesture = (element: HTMLDivElement, view = { centre: mapCentre, range: viewRangeMetres }) => {
    const metrics = pointerMetrics(element);
    mapGesture.current = { ...view, ...metrics, moved: false };
  };

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressCandidate.current = null;
    setLongPressActive(false);
  };

  const clampMapRange = journeyState === "planning" ? clampRouteViewRange : clampActiveRouteViewRange;

  const scheduleMapView = (nextCentre: GeoPoint, nextRange: number) => {
    pendingMapView.current = { centre: nextCentre, range: nextRange };
    if (mapViewFrame.current !== null) return;
    mapViewFrame.current = window.requestAnimationFrame(() => {
      mapViewFrame.current = null;
      const pending = pendingMapView.current;
      pendingMapView.current = null;
      if (!pending) return;
      setViewCentre(pending.centre);
      setViewRangeMetres(pending.range);
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture(event.currentTarget);
    if (journeyState !== "planning" || planning || activePointers.current.size !== 1) {
      cancelLongPress();
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * size;
    const y = (event.clientY - bounds.top) / bounds.height * size;
    const northUpPoint = rotateMapPoint({ x, y }, mapRotationPivot, -mapRotationDegrees);
    const candidate = {
      pointerId: event.pointerId,
      startedAt: Date.now(),
      point: routeMapPixelToGeo(mapCentre, viewRangeMetres, size, northUpPoint.x, northUpPoint.y),
    };
    longPressCandidate.current = candidate;
    setLongPressActive(true);
    longPressTimer.current = window.setTimeout(() => {
      const activeCandidate = longPressCandidate.current;
      if (!activeCandidate || activeCandidate.pointerId !== candidate.pointerId) return;
      const commit = shouldCommitRouteMapLongPress({
        elapsedMs: Date.now() - activeCandidate.startedAt,
        moved: mapGesture.current?.moved ?? true,
        pointerCount: activePointers.current.size,
        planning: journeyState === "planning" && !planning,
      });
      if (!commit) return;
      if (mapEditMode === "start") selectStart(activeCandidate.point);
      else selectTarget(activeCandidate.point);
      navigator.vibrate?.(25);
      longPressTimer.current = null;
      longPressCandidate.current = null;
      setLongPressActive(false);
    }, ROUTE_MAP_LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointers.current.has(event.pointerId) || !mapGesture.current) return;
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const metrics = pointerMetrics(event.currentTarget);
    const gesture = mapGesture.current;
    const deltaX = metrics.centroid.x - gesture.centroid.x;
    const deltaY = metrics.centroid.y - gesture.centroid.y;
    const northUpDelta = rotateMapDelta({ x: deltaX, y: deltaY }, -mapRotationDegrees);
    if (Math.hypot(deltaX, deltaY) > ROUTE_MAP_MOVE_TOLERANCE_PX || Math.abs(metrics.distance - gesture.distance) > ROUTE_MAP_MOVE_TOLERANCE_PX) {
      gesture.moved = true;
      cancelLongPress();
    }
    scheduleMapView(
      panRouteMapCentre(gesture.centre, gesture.range, size, northUpDelta.x, northUpDelta.y, clampMapRange),
      activePointers.current.size >= 2
        ? pinchRouteViewRange(gesture.range, gesture.distance, metrics.distance, clampMapRange)
        : gesture.range,
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    cancelLongPress();
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size > 0) beginGesture(event.currentTarget, pendingMapView.current ?? { centre: mapCentre, range: viewRangeMetres });
    else mapGesture.current = null;
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    cancelLongPress();
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size > 0) beginGesture(event.currentTarget, pendingMapView.current ?? { centre: mapCentre, range: viewRangeMetres });
    else mapGesture.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setViewRangeMetres((value) => clampMapRange(value * (event.deltaY > 0 ? 1.18 : 1 / 1.18)));
  };

  const handleMapKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") setViewRangeMetres((value) => clampMapRange(value / 1.7));
    else if (event.key === "-") setViewRangeMetres((value) => clampMapRange(value * 1.7));
    else if ((event.key === "Enter" || event.key === " ") && journeyState === "planning" && !planning) {
      if (mapEditMode === "start") selectStart(mapCentre);
      else selectTarget(mapCentre);
    } else return;
    event.preventDefault();
  };

  const editStartCoordinate = (field: "latitude" | "longitude", value: string) => {
    if (startMode === "gps") {
      setStartLatitude(field === "latitude" ? value : coordinateText(fix?.latitude));
      setStartLongitude(field === "longitude" ? value : coordinateText(fix?.longitude));
      setStartMode("manual");
      setManualStart(null);
    } else if (field === "latitude") setStartLatitude(value);
    else setStartLongitude(value);
    setInputError(false);
  };

  const useGpsStart = () => {
    setStartMode("gps");
    setManualStart(null);
    setStartLatitude("");
    setStartLongitude("");
    setInputError(false);
    if (fix && target && gpsReliable) {
      fitRoute(fix, target);
      calculate(target, fix);
    }
  };

  const useCoordinateInputs = () => {
    const parsedTargetLatitude = parseRouteCoordinate(targetLatitude);
    const parsedTargetLongitude = parseRouteCoordinate(targetLongitude);
    const parsedStartLatitude = startMode === "gps" ? fix?.latitude ?? null : parseRouteCoordinate(startLatitude);
    const parsedStartLongitude = startMode === "gps" ? fix?.longitude ?? null : parseRouteCoordinate(startLongitude);
    if (parsedStartLatitude === null || parsedStartLongitude === null || parsedTargetLatitude === null || parsedTargetLongitude === null) {
      setInputError(true);
      return;
    }
    const requestedStart = startMode === "gps" && fix ? fix : { latitude: parsedStartLatitude, longitude: parsedStartLongitude };
    const destination = { latitude: parsedTargetLatitude, longitude: parsedTargetLongitude };
    if (!routeCoordinateIsValid(requestedStart) || !routeCoordinateIsValid(destination) || (startMode === "gps" && !gpsReliable)) {
      setInputError(true);
      return;
    }
    const start = resolvePlaceSearchTarget(pack, requestedStart, undefined, destination);
    if (startMode === "manual") {
      setManualStart(start);
      setStartLatitude(coordinateText(start.latitude));
      setStartLongitude(coordinateText(start.longitude));
    }
    setTarget(destination);
    setInputError(false);
    if (routeEditor.current) routeEditor.current.open = false;
    fitRoute(start, destination);
    calculate(destination, start);
  };

  const swapPoints = () => {
    if (!effectiveStart || !target) return;
    const nextStart = target;
    const nextTarget = effectiveStart;
    setStartMode("manual");
    setManualStart(nextStart);
    setStartLatitude(coordinateText(nextStart.latitude));
    setStartLongitude(coordinateText(nextStart.longitude));
    setTarget(nextTarget);
    setTargetLatitude(coordinateText(nextTarget.latitude));
    setTargetLongitude(coordinateText(nextTarget.longitude));
    setInputError(false);
    fitRoute(nextStart, nextTarget);
    calculate(nextTarget, nextStart);
  };

  const startJourney = () => {
    if (!fix || !target || !route || !gpsReliable || planning) return;
    setStartingJourney(true);
    calculate(target, fix, true);
  };

  const endJourney = () => {
    cancelLongPress();
    setJourneyState("planning");
    setJourneyProgressMetres(0);
    setStartMode("gps");
    setViewCentre(null);
    if (fix && target && gpsReliable) calculate(target, fix);
  };

  const reset = () => {
    cancelLongPress();
    clearPendingReroute();
    routeWorker.current?.cancel();
    setTarget(null);
    setManualStart(null);
    setStartMode("gps");
    setJourneyState("planning");
    setRoute(null);
    setFailure(null);
    setPlanning(false);
    setStartingJourney(false);
    setStartLatitude("");
    setStartLongitude("");
    setTargetLatitude("");
    setTargetLongitude("");
    setInputError(false);
    setJourneyProgressMetres(0);
    setFocusedPlace(null);
    setPlaceQuery("");
    setPlaceResults([]);
    setPlaceSearchOpen(false);
    plannedFrom.current = null;
  };

  const recenterMap = () => {
    setViewCentre(null);
    if (journeyState === "active" || journeyState === "arrived") setViewRangeMetres(getActiveRouteViewRange(proximityRangeMetres, warningConfig.distanceMetres));
    else if (fix && target) setViewRangeMetres(clampRouteViewRange(routeViewRangeForTarget(2_500, fix, target) * .62));
  };

  const displayedStartLatitude = startMode === "gps" ? coordinateText(fix?.latitude) : startLatitude;
  const displayedStartLongitude = startMode === "gps" ? coordinateText(fix?.longitude) : startLongitude;
  const scaleLabel = viewRangeMetres >= 1_000 ? `${Math.round(viewRangeMetres / 1_000)} km` : `${Math.round(viewRangeMetres)} m`;
  const startSummary = startMode === "gps" ? copy.currentGps : effectiveStart ? `${effectiveStart.latitude.toFixed(4)}, ${effectiveStart.longitude.toFixed(4)}` : copy.manualPoint;
  const targetSummary = target ? `${target.latitude.toFixed(4)}, ${target.longitude.toFixed(4)}` : copy.holdSetsTarget;
  const routeNoticeCount = route ? Number(route.mode === "restricted") + Number(route.passageIds.includes("tisno-murter-bridge")) : 0;
  const currentDepthDisplay = formatCurrentDepth(currentDepthMetres, language);

  return (
    <section ref={routePlanner} className={`route-planner journey-${journeyState}`} aria-label={copy.title} style={{ "--distance-scale": warningConfig.distanceTextScalePercent / 100 } as CSSProperties}>
      <header className="route-screen-header">
        <div className="route-screen-heading">
          <span><strong>{activeJourney ? copy.navigation : copy.title}</strong><small>{journeyState === "planning" ? mapEditMode === "start" ? copy.holdSetsStart : copy.holdSetsTarget : `${copy.following} · ${copy.progress} ${Math.round(progressPercent)}%`}</small></span>
          <span className={`route-state ${routeStateClass}`}>{routeStateLabel}</span>
        </div>
        {activeJourney && route && <div className="route-live-guidance" aria-live="polite">
          <span className="bearing"><small>{copy.bearing}</small><strong>{nextBearing === null ? "—" : `${Math.round(nextBearing).toString().padStart(3, "0")}°`}</strong></span>
          <span><small>{copy.remaining}</small><strong>{formatRouteDistance(remainingMetres).toFixed(1)} {copy.nauticalMiles}</strong></span>
          <span><small>{copy.remainingEta}</small><strong>{formatRouteEta(remainingSeconds, copy.minutes)}</strong></span>
          <span className={`clearance ${route.mode}`}><small>{copy.clearance}</small><strong>{formatRouteClearance(route.minimumShoreDistanceMetres)}</strong></span>
        </div>}
      </header>

      {journeyState === "planning" && <div className="route-place-search">
        <form onSubmit={(event) => { event.preventDefault(); void runPlaceSearch(); }} role="search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={placeQuery}
            placeholder={copy.placeSearch}
            aria-label={copy.placeSearch}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={placeSearchOpen && normalizePlaceSearchText(placeQuery).length >= 2}
            aria-controls="route-place-results"
            aria-activedescendant={activePlaceIndex >= 0 ? `route-place-result-${activePlaceIndex}` : undefined}
            autoComplete="off"
            onFocus={() => setPlaceSearchOpen(true)}
            onChange={(event) => {
              setPlaceQuery(event.target.value);
              setPlaceResults([]);
              setPlaceSearchState("idle");
              setPlaceSearchOpen(true);
              setActivePlaceIndex(-1);
            }}
            onKeyDown={handlePlaceSearchKey}
          />
          <button type="submit" disabled={normalizePlaceSearchText(placeQuery).length < 2 || placeSearchState === "loading"}>{copy.search}</button>
        </form>
        {placeSearchOpen && normalizePlaceSearchText(placeQuery).length >= 2 && <div id="route-place-results" className="route-place-results" role="listbox" aria-label={copy.placeSearch}>
          {placeSearchState === "loading" && <p>{copy.searchLoading}</p>}
          {visiblePlaceResults.map((result, index) => <button id={`route-place-result-${index}`} key={result.id} type="button" role="option" aria-selected={activePlaceIndex === index} onMouseEnter={() => setActivePlaceIndex(index)} onClick={() => focusPlaceResult(result)}>
            <i>{result.kind === "bay" ? "≈" : result.kind === "island" ? "◇" : "●"}</i>
            <span><strong>{result.name}</strong><small>{formatPlaceSearchDetail(result, language)}</small></span>
            <b>›</b>
          </button>)}
          {placeSearchState !== "loading" && visiblePlaceResults.length === 0 && <p>{copy.searchEmpty}</p>}
          {placeSearchState === "offline" && <p className="route-place-offline">{copy.searchOffline}</p>}
          <small className="route-place-credit">© OpenStreetMap contributors · Photon</small>
        </div>}
        {focusedPlace && <small className="route-place-focus">{copy.searchHint(focusedPlace.name)}</small>}
      </div>}

      <div className="route-map-wrap">
        <div className="route-map" role="application" tabIndex={0} aria-label={copy.mapLabel} aria-disabled={planning} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onContextMenu={(event) => event.preventDefault()} onWheel={handleWheel} onKeyDown={handleMapKey}>
          <svg viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">
            <defs>
              <filter id="routeBoatGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              <pattern id="routeLandHatch" width="12" height="12" patternUnits="userSpaceOnUse"><rect className="route-land-fill-mark" width="12" height="12" /><path className="route-land-hatch-mark" d="M-3 12 12-3M6 15 15 6" /></pattern>
            </defs>
            <rect className="route-water" width={size} height={size} />
            <g className="route-oriented-map" transform={mapOrientationTransform}>
              <g className="route-static-map" transform={staticMapTransform}>
                {staticMapLayers}
              </g>
              {activeJourney && boatPoint && liveShallow && <g className="route-shallow-zone" aria-hidden="true"><circle cx={boatPoint.x} cy={boatPoint.y} r={Math.max(10, liveShallowRadius)} /><text x={boatPoint.x} y={boatPoint.y + 25} transform={`rotate(${-mapRotationDegrees} ${boatPoint.x} ${boatPoint.y + 25})`}>{copy.shallow} · {formatCurrentDepth(currentDepthMetres, language)} m</text></g>}
              {(journeyState === "active" || journeyState === "arrived") && boatPoint && <g className={`route-live-proximity ${shoreDistanceMetres !== null && shoreDistanceMetres < warningConfig.distanceMetres ? "danger" : "safe"}`}>
                <circle className="route-warning-ring" cx={boatPoint.x} cy={boatPoint.y} r={liveWarningRadius} />
                {liveNearestPoint && <>
                  <line className="route-nearest-line" x1={boatPoint.x} y1={boatPoint.y} x2={liveNearestPoint.x} y2={liveNearestPoint.y} />
                  <circle className="route-nearest-point" cx={liveNearestPoint.x} cy={liveNearestPoint.y} r="3.5" />
                </>}
              </g>}
            </g>
            {boatPoint && <g className="route-boat" transform={`translate(${boatPoint.x} ${boatPoint.y}) rotate(${boatRotationDegrees})`} filter="url(#routeBoatGlow)"><circle r="13" /><path d="M0-11 7 8 0 5-7 8Z" /></g>}
          </svg>
        </div>
        <WindOverlay sample={windSample} visible={showWind} mapRotationDegrees={mapRotationDegrees} />
        {activeJourney && <div className="summary-primary-row distance-map-overlay route-live-map-overlay">
          <div className="distance-readout route-live-distance">
            <span>{copy.nearestShore}</span>
            <span className="distance-value"><strong>{activeDistanceValue}</strong><small>{activeDistanceUnit}</small></span>
          </div>
          <div className={`go-no-go route-live-go-no-go ${goNoGoState}`}>
            <span aria-hidden="true">{goNoGoState === "go" ? "✓" : goNoGoState === "no-go" ? "×" : "?"}</span>
            <b>{activeGoNoGoLabel}</b>
          </div>
        </div>}
        {journeyState === "planning" && <div className="route-map-mode" aria-label={copy.pointsPanel}>
          <button type="button" aria-pressed={mapEditMode === "start"} className={mapEditMode === "start" ? "active" : ""} onClick={() => setMapEditMode("start")}><b>A</b>{copy.start}</button>
          <button type="button" aria-pressed={mapEditMode === "target"} className={mapEditMode === "target" ? "active" : ""} onClick={() => setMapEditMode("target")}><b>B</b>{copy.target}</button>
        </div>}
        {journeyState === "planning" && <div className={`route-long-press-hint ${longPressActive ? "active" : ""}`} role="status"><span />{longPressActive ? copy.holdingPoint : mapEditMode === "start" ? copy.holdSetsStart : copy.holdSetsTarget}</div>}
        <div className="route-layer-tools">
          <button type="button" className={showDepths ? "active" : ""} aria-pressed={showDepths} onClick={() => setShowDepths((value) => !value)}><i className={`route-layer-status ${depthStatus}`} />{copy.depthLayer}</button>
          <button type="button" className={showWind ? "active wind" : "wind"} aria-pressed={showWind} onClick={onToggleWind} title={windSample ? `${windState === "offline" ? "Offline · " : ""}${copy.gust}: ${Math.round(windSample.gustKnots)} kn` : windState === "error" ? copy.windUnavailable : copy.wind}><span className="wind-arrow" style={{ transform: `rotate(${windSample?.directionDegrees ?? 0}deg)` }}>↓</span>{windSample ? `${windState === "offline" ? "Offline · " : ""}${copy.wind} ${windCompassLabel(windSample.directionDegrees, language)} · ${Math.round(windSample.speedKnots)} kn` : windState === "error" ? copy.windUnavailable : copy.wind}</button>
          {showDepths && depthStatus === "error" && <small>{copy.depthUnavailable}</small>}
        </div>
        <div className="route-zoom" aria-label="Zoom">
          <button type="button" aria-label={copy.zoomIn} onClick={() => setViewRangeMetres((value) => clampMapRange(value / 1.7))}>+</button>
          <button type="button" aria-label={copy.zoomOut} onClick={() => setViewRangeMetres((value) => clampMapRange(value * 1.7))}>−</button>
          <button className="route-recenter" type="button" aria-label={copy.recenter} onClick={recenterMap}>◎</button>
          <MapOrientationControl headingUp={headingUp} heading={fix?.heading} language={language} onToggle={onToggleHeadingUp} className="route-orientation-control" />
        </div>
        <div className="route-scale"><span /><small>{scaleLabel}</small></div>
        <div className="route-map-credit">© OpenStreetMap contributors{showDepths ? ` · ${EMODNET_BATHYMETRY_ATTRIBUTION}` : ""}{showWind && windSample ? " · Wind: Open-Meteo" : ""}</div>
      </div>

      {activeJourney && <div className="instrument-footer route-live-footer">
        <div className="instrument-meta route-live-meta">
          <span className={`${currentDepthState} ${liveShallow ? "shallow" : ""}`}><strong>{currentDepthState === "ready" ? `≈${currentDepthDisplay}` : "—"}</strong> m · {liveShallow ? copy.shallow : copy.chartDepth}</span>
          <span><strong>±{gpsAccuracyLabel}</strong> m GPS</span>
          <span className="current-speed-footer"><strong>{speedKnots === null ? "—" : speedKnots.toFixed(1)}</strong> kn · {copy.currentSpeed}</span>
        </div>
        {route && <button className={journeyState === "arrived" ? "route-finish-trip" : "route-end-trip"} type="button" onClick={endJourney}>{journeyState === "arrived" ? copy.finishJourney : copy.endJourney}</button>}
      </div>}

      {journeyState === "planning" && <details ref={routeEditor} className="route-panel route-editor">
        <summary><span><strong>{copy.pointsPanel}</strong><small>{startSummary} → {targetSummary}</small></span><b>{copy.edit}</b></summary>
        <div className="route-panel-body route-points-editor">
          <div className="route-point-row">
            <span className="route-point-badge start">A</span>
            <div className="route-point-fields">
              <span><strong>{copy.start}</strong><small>{startMode === "gps" ? copy.currentGps : copy.manualPoint}</small></span>
              <label><span>{copy.latitude}</span><input aria-label={`${copy.start} ${copy.latitude}`} inputMode="decimal" value={displayedStartLatitude} onChange={(event) => editStartCoordinate("latitude", event.target.value)} /></label>
              <label><span>{copy.longitude}</span><input aria-label={`${copy.start} ${copy.longitude}`} inputMode="decimal" value={displayedStartLongitude} onChange={(event) => editStartCoordinate("longitude", event.target.value)} /></label>
            </div>
            <div className="route-point-actions"><button type="button" className={startMode === "gps" ? "active" : ""} onClick={useGpsStart} aria-label={copy.useGps}>◎</button></div>
          </div>
          <button className="route-swap" type="button" disabled={!effectiveStart || !target} onClick={swapPoints} aria-label={copy.swap}>⇅</button>
          <div className="route-point-row">
            <span className="route-point-badge target">B</span>
            <div className="route-point-fields">
              <span><strong>{copy.target}</strong><small>{target ? copy.manualPoint : copy.holdSetsTarget}</small></span>
              <label><span>{copy.latitude}</span><input aria-label={`${copy.target} ${copy.latitude}`} inputMode="decimal" value={targetLatitude} onChange={(event) => { setTargetLatitude(event.target.value); setInputError(false); }} /></label>
              <label><span>{copy.longitude}</span><input aria-label={`${copy.target} ${copy.longitude}`} inputMode="decimal" value={targetLongitude} onChange={(event) => { setTargetLongitude(event.target.value); setInputError(false); }} /></label>
            </div>
          </div>
          {inputError && <p className="route-input-error" role="alert">{copy.invalidCoordinates}</p>}
          <button className="route-calculate" type="button" disabled={planning || !planningStartAvailable} onClick={useCoordinateInputs}>{planning ? copy.calculating : copy.calculateRoute}</button>
        </div>
      </details>}

      {journeyState === "planning" && (planning || failure || route) && <div className="route-summary" aria-live="polite">
        {planning ? <p className="route-message">{startingJourney ? copy.startingJourney : copy.calculating}</p> : failure ? <p className="route-message error">{copy.failures[failure]}</p> : route ? (
          <>
            {journeyState === "planning" && <div className="route-metrics">
              <span><small>{copy.distance}</small><strong>{formatRouteDistance(route.distanceMetres).toFixed(route.distanceMetres < 18_520 ? 1 : 0)} {copy.nauticalMiles}</strong></span>
              <span><small>{copy.eta}</small><strong>{formatRouteEta(route.estimatedSeconds, copy.minutes)}</strong></span>
              <span><small>{copy.clearance}</small><strong>{formatRouteClearance(route.minimumShoreDistanceMetres)}</strong></span>
            </div>}
            {routeNoticeCount > 0 && <details className="route-notices">
              <summary><span role="alert">{copy.routeNotes}</span><b>{copy.routeNoteCount(routeNoticeCount)}</b></summary>
              <div>{route.mode === "restricted" && <p className="route-detail restricted">{copy.restrictedDetail(warningConfig.distanceMetres)}</p>}{route.passageIds.includes("tisno-murter-bridge") && <p className="route-passage-warning" role="alert">{copy.tisnoPassage}</p>}</div>
            </details>}
          </>
        ) : <p className="route-message">{copy.subtitle}</p>}
      </div>}

      {route && journeyState === "planning" && <div className="route-trip-actions">
        <button className="route-start-trip" type="button" disabled={!gpsReliable || planning} onClick={startJourney}>{copy.startJourney}</button>
        {!gpsReliable && <small>{copy.liveGpsNeeded}</small>}
      </div>}

      {journeyState === "planning" && <details className="route-panel route-options">
        <summary><span><strong>{copy.optionsPanel}</strong><small>{cruiseSpeedKnots} kn · {copy.rule(warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled)}</small></span><b>{copy.edit}</b></summary>
        <div className="route-panel-body route-controls">
          <label className="route-speed"><span><strong>{copy.cruiseSpeed}</strong><small>{copy.cruiseSpeedHint}</small></span><span><input type="number" min="2" max="60" step="1" value={cruiseSpeedKnots} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setCruiseSpeedKnots(clampCruiseSpeed(event.target.valueAsNumber))} /> kn</span></label>
          <div className="route-rule">{copy.rule(warningConfig.distanceMetres, warningConfig.maxSpeedKnots, warningConfig.speedWarningEnabled)}</div>
          <label className="route-option"><span><strong>{copy.conditionalPassages}</strong><small>{copy.conditionalPassagesHint}</small></span><input type="checkbox" checked={conditionalPassagesEnabled} onChange={(event) => setConditionalPassagesEnabled(event.target.checked)} /></label>
          {(target || manualStart) && <button className="route-reset" type="button" onClick={reset}>{copy.reset}</button>}
        </div>
      </details>}

      {journeyState === "active" && !gpsReliable && <p className="route-live-gps-warning" role="alert">{gpsIssueMessage}</p>}
    </section>
  );
}
