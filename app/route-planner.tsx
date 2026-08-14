"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type Language = "de" | "en";
type Fix = GeoPoint & { speed: number | null; accuracy?: number; heading?: number | null };
type RoutePlannerFailure = RoutePlanningFailure | "calculation-failed";
type StartMode = "gps" | "manual";
type MapEditMode = "start" | "target";
type JourneyState = "planning" | "active" | "arrived";

const COPY = {
  de: {
    title: "Routenplanung",
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
    searchHint: (name: string, point: string) => `${name} zentriert · ${point} im Wasser gedrückt halten`,
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
    searchHint: (name: string, point: string) => `${name} centred · press and hold in the water for ${point}`,
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
  const [focusedPlace, setFocusedPlace] = useState<PlaceSearchResult | null>(null);
  const plannedFrom = useRef<GeoPoint | null>(null);
  const [journeyProgressMetres, setJourneyProgressMetres] = useState(0);
  const rerouteTimer = useRef<number | null>(null);
  const latestRerouteFix = useRef<Fix | null>(fix);
  const routeWorker = useRef<RoutePlanningWorkerController | null>(null);
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const mapGesture = useRef<{ centre: GeoPoint; range: number; centroid: { x: number; y: number }; distance: number; moved: boolean } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressCandidate = useRef<{ pointerId: number; startedAt: number; point: GeoPoint } | null>(null);
  const placeSearchController = useRef<AbortController | null>(null);
  const depthLoadState = useRef({ key: "", loaded: 0, failed: 0 });
  const routeEditor = useRef<HTMLDetailsElement | null>(null);

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
    const start = startOverride ?? effectiveStart;
    const controller = routeWorker.current;
    if (!controller || !pack || !start || !routeCoordinateIsValid(start) || !routeCoordinateIsValid(destination)) return;
    if (start === fix && !gpsReliable) return;
    const wasActiveJourney = journeyState === "active";
    setPlanning(true);
    setFailure(null);
    controller.calculate({
      pack,
      start,
      destination,
      options: {
        clearanceMetres: warningConfig.distanceMetres,
        cruiseSpeedKnots,
        speedWarningEnabled: warningConfig.speedWarningEnabled,
        nearShoreSpeedKnots: warningConfig.maxSpeedKnots,
        startAccuracyMetres: start === fix ? fix?.accuracy : undefined,
        conditionalPassagesEnabled,
      },
    }, {
      onResult: (result) => {
        setRoute(result.route ?? null);
        setFailure(result.failure ?? null);
        plannedFrom.current = start;
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
    setTarget(destination);
    setTargetLatitude(coordinateText(destination.latitude));
    setTargetLongitude(coordinateText(destination.longitude));
    setInputError(false);
    if (start) {
      fitRoute(start, destination);
      calculate(destination, start);
    }
  }, [calculate, effectiveStart, fitRoute]);

  const selectStart = useCallback((start: GeoPoint) => {
    setStartMode("manual");
    setManualStart(start);
    setStartLatitude(coordinateText(start.latitude));
    setStartLongitude(coordinateText(start.longitude));
    setInputError(false);
    setMapEditMode("target");
    if (target) {
      fitRoute(start, target);
      calculate(target, start);
    }
  }, [calculate, fitRoute, target]);

  const focusPlaceResult = (result: PlaceSearchResult) => {
    setFocusedPlace(result);
    setViewCentre({ longitude: result.longitude, latitude: result.latitude });
    setViewRangeMetres(clampRouteViewRange(result.kind === "place" ? 3_000 : 5_000));
    setPlaceQuery(result.name);
    setPlaceSearchOpen(false);
  };

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
  const point = useCallback((value: GeoPoint) => ({
    x: centre + (value.longitude - mapCentre.longitude) * metresPerLongitudeDegree * pixelsPerMetre,
    y: centre - (value.latitude - mapCentre.latitude) * 110_540 * pixelsPerMetre,
  }), [centre, mapCentre.latitude, mapCentre.longitude, metresPerLongitudeDegree, pixelsPerMetre]);
  const segments = useMemo(() => pack ? getNearbyShorelineSegments(pack, mapCentre.longitude, mapCentre.latitude, viewRangeMetres * 1.45, 5_000) : [], [mapCentre.latitude, mapCentre.longitude, pack, viewRangeMetres]);
  const bathymetryTiles = useMemo(() => showDepths ? buildEmodnetBathymetryTiles(mapCentre, viewRangeMetres, 720) : [], [mapCentre, showDepths, viewRangeMetres]);
  const bathymetryKey = bathymetryTiles.map((tile) => tile.key).join("|");
  const hatchPath = useMemo(() => {
    if (!pack) return "";
    const bandHeight = 1.5;
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
  const mapLabels = useMemo(() => placeMapFeatureLabels(
    getMapFeaturesInView(mapFeaturePack, mapCentre, viewRangeMetres),
    point,
    size,
    26,
  ), [mapCentre, mapFeaturePack, point, size, viewRangeMetres]);

  useEffect(() => {
    depthLoadState.current = { key: bathymetryKey, loaded: 0, failed: 0 };
    const timer = window.setTimeout(() => setDepthStatus(showDepths && bathymetryTiles.length > 0 ? "loading" : "idle"), 0);
    return () => window.clearTimeout(timer);
  }, [bathymetryKey, bathymetryTiles.length, showDepths]);

  const depthTileLoaded = (key: string) => {
    if (depthLoadState.current.key !== bathymetryKey || !bathymetryKey.includes(key)) return;
    depthLoadState.current.loaded += 1;
    setDepthStatus("ready");
  };

  const depthTileFailed = (key: string) => {
    if (depthLoadState.current.key !== bathymetryKey || !bathymetryKey.includes(key)) return;
    depthLoadState.current.failed += 1;
    if (depthLoadState.current.loaded === 0 && depthLoadState.current.failed >= bathymetryTiles.length) setDepthStatus("error");
  };

  const routePoints = route?.points.map(point).map(({ x, y }) => `${x},${y}`).join(" ") ?? "";
  const boatPoint = fix ? point(fix) : null;
  const liveNearest = useMemo(() => pack && fix ? findNearestShore(pack, fix.longitude, fix.latitude) : null, [fix, pack]);
  const liveNearestPoint = liveNearest ? point(liveNearest) : null;
  const liveWarningRadius = warningConfig.distanceMetres * pixelsPerMetre;
  const liveDistanceLabel = shoreDistanceMetres === null ? "—" : formatRouteClearance(shoreDistanceMetres);
  const startPoint = startMode === "manual" && manualStart ? point(manualStart) : null;
  const targetPoint = target ? point(target) : null;
  const focusedPlacePoint = focusedPlace ? point(focusedPlace) : null;
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

  const beginGesture = (element: HTMLDivElement) => {
    const metrics = pointerMetrics(element);
    mapGesture.current = { centre: mapCentre, range: viewRangeMetres, ...metrics, moved: false };
  };

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressCandidate.current = null;
    setLongPressActive(false);
  };

  const clampMapRange = journeyState === "planning" ? clampRouteViewRange : clampActiveRouteViewRange;

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
    const candidate = {
      pointerId: event.pointerId,
      startedAt: Date.now(),
      point: routeMapPixelToGeo(mapCentre, viewRangeMetres, size, x, y),
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
    if (Math.hypot(deltaX, deltaY) > ROUTE_MAP_MOVE_TOLERANCE_PX || Math.abs(metrics.distance - gesture.distance) > ROUTE_MAP_MOVE_TOLERANCE_PX) {
      gesture.moved = true;
      cancelLongPress();
    }
    setViewCentre(panRouteMapCentre(gesture.centre, gesture.range, size, deltaX, deltaY, clampMapRange));
    if (activePointers.current.size >= 2) setViewRangeMetres(pinchRouteViewRange(gesture.range, gesture.distance, metrics.distance, clampMapRange));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivE