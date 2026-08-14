"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  type CoastlinePack,
  type CourseToShore,
  type NearestShore,
  type ShorelineSegment,
  distanceToSegment,
  findCourseToShore,
  findNearestShore,
  getLandIntervalsAtLatitude,
  getNearbyShorelineSegments,
  offsetFromShore,
} from "../lib/shoreline";
import { CROATIA_WARNING_CONFIG, sanitizeWarningConfig, type WarningConfig } from "../lib/warning-config";
import {
  classifyWarningZone,
  gateWarningSoundForDangerEpisode,
  getWarningHysteresisMetres,
  getWarningOutputPlan,
  getWarningTransition,
} from "../lib/warning-state";
import { getGeneratedAlertPeak } from "../lib/audio-levels";
import { APP_VERSION } from "../lib/app-version";
import RoutePlanner from "./route-planner";
import {
  createStationaryState,
  distanceFromStationaryReference,
  getAnchorTimerSnapshot,
  getGoNoGoState,
  getPlotRangeMetres,
  getPowerSaveReason,
  updateStationaryState,
  type StationaryState,
} from "../lib/navigation-display";
import {
  getMapFeaturesInView,
  placeMapFeatureLabels,
  type MapFeaturePack,
} from "../lib/map-features";
import {
  calculateClosingRate,
  classifyClosingRate,
  getGpsNavigationState,
  getGpsSignalState,
  MAXIMUM_NAVIGATION_ACCURACY_METRES,
  shouldUseSunlightMode,
  type DistanceSample,
} from "../lib/navigation-metrics";
import {
  depthSampleCellKey,
  fetchCurrentWaterDepth,
  formatCurrentDepth,
  type CurrentDepthState,
} from "../lib/bathymetry";

type Mode = "idle" | "live" | "demo";
type AlarmPlayback = "idle" | "ready" | "starting" | "playing" | "blocked";
type RiskLevel = "none" | "warning" | "danger";
type Language = "de" | "en";
type Theme = "ocean" | "xp" | "dark" | "nautical";
type VisualSignalKind = "distance" | "speed" | "safe";
type TrackerTab = "distance" | "route";
type Fix = {
  longitude: number;
  latitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
};

type CourseRisk = {
  level: RiskLevel;
  label: string;
  detail: string;
};

type ScreenWakeLock = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void, options?: { once?: boolean }) => void;
};

const WARNING_CONFIG_STORAGE_KEY = "shoreline-warning-config-v1";
const AUTO_SUNLIGHT_STORAGE_KEY = "shoreline-auto-sunlight";
const DEBUG_STORAGE_KEY = "shoreline-debug-enabled";
const DEMO_DISTANCE_FACTORS = [1.4, 1.05, 0.95, 0.82, 1.07, 0.95];
const DEMO_SPEEDS = [12.2, 10.1, 7.8, 6.4, 8.2, 7.5];
const DEMO_ANCHOR = { longitude: 15.55, latitude: 43.803 };

const COPY = {
  de: {
    online: "Online",
    offline: "Offline",
    eyebrow: "Kroatische Küste · Live-GPS",
    heroTitle: "Abstand im Blick.",
    intro: (distance: number) => `Nächste Küste, ein ${distance}-m-Alarm, vollständig offline verfügbar.`,
    startAria: "Küstenüberwachung starten",
    coastError: "Küstendaten nicht verfügbar",
    coastReady: "Kroatische Küste offline bereit",
    coastLoading: "Kroatische Küste wird geladen",
    startLive: "Live starten",
    demo: "Demo",
    finePrint: "Kartentiefe nur zur Orientierung. Keine Prüfung von Untiefen, Felsen, Verkehr, Bojen, Fahrwasser, Wetter oder Vorschriften. Amtliche Seekarte verwenden und Ausguck halten.",
    language: "Sprache",
    theme: "Design",
    themeOcean: "Ocean",
    themeXp: "Windows XP",
    themeDark: "Dark Mode",
    themeNautical: "Klassisch nautisch",
    autoSunlight: "Automatischer Sonnenmodus",
    autoSunlightHint: "Stärkerer Kontrast bei Tageslicht – offline aus GPS und Uhrzeit.",
    sunlightActive: "Sonnenmodus",
    settings: "Warnungen",
    settingsSummary: (distance: number, speedEnabled: boolean, speed: number, volume: number) =>
      speedEnabled ? `${distance} m · ${speed} kn · ${volume} %` : `${distance} m · ${volume} %`,
    distanceWarning: "Warnabstand",
    distanceTextSize: "Entfernungsanzeige",
    distanceTextSizeHint: "Größe der Meterzahl für gute Ablesbarkeit aus der Entfernung.",
    hysteresisHint: (metres: number) => `Schaltpuffer ±${metres} m verhindert wiederholte Alarme durch GPS-Schwankungen.`,
    speedWarning: "Tempo im Küstenbereich prüfen",
    speedLimit: "Maximaltempo",
    speedWarningHint: (distance: number) => `Warnt über dem Limit innerhalb von ${distance} m.`,
    quietAtSafeSpeed: "Distanzton nur über eingestelltem Limit",
    quietAtSafeSpeedHint: (speed: number) => `Bis zum eingestellten Wert von ${speed} kn bleibt der Ton beim Einfahren aus. Bildschirmwarnung und Vibration bleiben aktiv.`,
    croatiaPreset: "Kroatienwerte",
    croatiaRule: "Voreinstellung: 8 kn bis 300 m Küstenabstand. Geltende Vorschriften mit amtlichen Quellen prüfen.",
    alertOutputs: "Alarmausgabe",
    alertVolume: "Lautstärke",
    volumeBoostHint: "Über 100 % wird der Alarm zusätzlich verstärkt.",
    warningSound: "Warnalarm",
    warningSoundHint: "Beim Einfahren oder Überschreiten des Tempolimits.",
    safeSound: "Abstandsfreigabeton",
    safeSoundHint: "Beim Verlassen des Warnbereichs.",
    visualAlerts: "Bildschirmwarnung",
    visualAlertsHint: "Deutlicher Farbblitz zusätzlich zum Ton.",
    vibration: "Vibration",
    vibrationHint: "Haptisches Signal, wenn das Gerät es unterstützt.",
    energySaving: "Energiesparmodus",
    energySavingHint: "OLED-schwarze Anzeige weit vor der Küste oder nach längerem Stillstand. GPS und Warnungen bleiben aktiv.",
    energyDistance: "Aktiv ab Küstenabstand",
    energyStationary: "Aktiv nach Stillstand",
    energyAnchorRadius: "Ankerkreis",
    energyAnchorRadiusHint: "Schwojen innerhalb dieses Radius gilt weiterhin als Stillstand.",
    energySection: "Energiesparen",
    anchorTimer: "Anker-Timer",
    anchorRunning: "läuft",
    anchorReady: "aktiv",
    anchorBlocked: "pausiert",
    diagnosticsSection: "Diagnose",
    debugMode: "Debug-Daten anzeigen",
    debugModeHint: "Zeigt lokale Live-, GPS-, Tiefen-, Alarm- und Ankerdaten. Es werden keine Daten übertragen.",
    debugCopy: "Daten kopieren",
    go: "GO",
    noGo: "NO GO",
    goUnknown: "PRÜFEN",
    powerNavigationScope: "Bewertung berücksichtigt nur den Küstenabstand",
    powerSavingActive: "Energiesparmodus aktiv",
    powerFar: "Küste weit entfernt",
    powerStationary: "Keine Bewegung erkannt",
    tapToWake: "Antippen für volle Anzeige",
    muted: "Stumm",
    visualDistance: "Warnbereich erreicht",
    visualDistanceDetail: (distance: number) => `Weniger als ${distance} m zur Küste`,
    visualSpeed: "Tempo reduzieren",
    visualSpeedDetail: (speed: number) => `Mehr als ${speed} kn im Küstenbereich`,
    visualSafe: "Abstand wieder frei",
    visualSafeDetail: (distance: number) => `Mehr als ${distance} m zur Küste`,
    live: "Live",
    end: "Beenden",
    waitingGps: "Warte auf GPS",
    weakGps: "GPS ungenau",
    weakGpsDetail: (accuracy: string, maximum: number) => `GPS-Genauigkeit ±${accuracy} m. Benötigt: ±${maximum} m oder besser.`,
    gpsStale: "GPS veraltet",
    gpsLost: "GPS-Signal verloren",
    gpsStaleDetail: (seconds: number) => `Letzte Position vor ${seconds} Sek.`,
    gpsLostDetail: (seconds: number) => seconds > 0 ? `Keine neue Position seit ${seconds} Sek.` : "Keine zuverlässige Position verfügbar.",
    lastKnown: "Letzte bekannte Position",
    insideLimit: (distance: number) => `Unter ${distance} m`,
    clearLimit: (distance: number) => `${distance} m frei`,
    speedDanger: "Eingestelltes Tempolimit überschritten",
    speedDangerDetail: (speed: string, limit: string, distance: number) => `${speed} kn · Limit ${limit} kn innerhalb ${distance} m`,
    playing: "Wiedergabe",
    blocked: "Blockiert",
    ready: "Bereit",
    notReady: "Nicht bereit",
    nearestShore: "Nächste Küste",
    chartDepth: "Kartentiefe",
    depthWaiting: "Warte auf GPS für Kartentiefe",
    depthLoading: "Kartentiefe wird geladen",
    depthUnavailable: "Keine Wassertiefe im Kartenraster",
    depthError: "Kartentiefe momentan nicht verfügbar",
    depthDetail: "EMODnet · ca. 115-m-Raster",
    metres: "Meter",
    kilometres: "Kilometer",
    acquiring: "Position wird ermittelt",
    plotAcquiring: "Küstenposition wird ermittelt",
    plotDistance: (distance: number) => `Nächste Küste ${distance} Meter entfernt`,
    courseDanger: "Küste auf aktuellem Kurs",
    courseDangerDetail: (eta: string) => `${eta} bis zur Küste · Kurs prüfen`,
    courseWarning: (distance: number) => `${distance}-m-Grenze auf aktuellem Kurs`,
    courseWarningDetail: (eta: string) => `${eta} bei aktueller Geschwindigkeit`,
    seconds: "Sek.",
    minutes: "Min.",
    shore: "Küste",
    closing: "Küstenannäherung",
    closingRate: (trend: "approaching" | "receding" | "steady" | "unknown", metresPerMinute: number | null) =>
      trend === "approaching" ? `Annäherung ${metresPerMinute} Meter pro Minute` : trend === "receding" ? `Entfernung ${metresPerMinute} Meter pro Minute` : trend === "steady" ? "Abstand stabil" : "Annäherung wird berechnet",
    testAlarm: "Alarm testen",
    nextPosition: "Nächste Position",
    soundBlocked: "Ton blockiert — Medienlautstärke erhöhen und Tracking neu starten.",
    soundMissing: "Alarmton konnte nicht geladen werden — App neu öffnen.",
    locationUnavailable: "Live-Standort ist in diesem Browser nicht verfügbar.",
    locationDenied: "Genaue Standortfreigabe erlauben und erneut versuchen.",
    locationUnknown: "Das Smartphone kann den Standort nicht bestimmen.",
    locationTimeout: "GPS-Zeitüberschreitung — App sichtbar lassen.",
    distanceTab: "Abstand",
    routeTab: "Route",
  },
  en: {
    online: "Online",
    offline: "Offline",
    eyebrow: "Croatian coast · live GPS",
    heroTitle: "Know your margin.",
    intro: (distance: number) => `Nearest shoreline, one ${distance} m alarm, fully available offline.`,
    startAria: "Start shoreline tracking",
    coastError: "Coastline data unavailable",
    coastReady: "Croatia shoreline ready offline",
    coastLoading: "Loading Croatia shoreline",
    startLive: "Start live",
    demo: "Demo",
    finePrint: "Chart depth is for orientation only. No shoal, rock, traffic, buoy, channel, weather, or legal checks. Keep an approved chart and normal lookout.",
    language: "Language",
    theme: "Theme",
    themeOcean: "Ocean",
    themeXp: "Windows XP",
    themeDark: "Dark mode",
    themeNautical: "Old-school nautical",
    autoSunlight: "Automatic sunlight mode",
    autoSunlightHint: "Stronger daylight contrast, calculated offline from GPS and time.",
    sunlightActive: "Sunlight mode",
    settings: "Warnings",
    settingsSummary: (distance: number, speedEnabled: boolean, speed: number, volume: number) =>
      speedEnabled ? `${distance} m · ${speed} kn · ${volume}%` : `${distance} m · ${volume}%`,
    distanceWarning: "Warning distance",
    distanceTextSize: "Distance display",
    distanceTextSizeHint: "Size of the distance digits for long-range readability.",
    hysteresisHint: (metres: number) => `A ±${metres} m switching buffer prevents repeated alerts from GPS fluctuations.`,
    speedWarning: "Check speed near shore",
    speedLimit: "Maximum speed",
    speedWarningHint: (distance: number) => `Warn above the limit while within ${distance} m.`,
    quietAtSafeSpeed: "Distance sound only above configured limit",
    quietAtSafeSpeedHint: (speed: number) => `At or below the configured ${speed} kn, entering the zone stays silent. Screen alert and vibration remain active.`,
    croatiaPreset: "Croatia preset",
    croatiaRule: "Preset: 8 kn within 300 m of shore. Verify applicable rules in official sources.",
    alertOutputs: "Alert outputs",
    alertVolume: "Volume",
    volumeBoostHint: "Above 100% adds extra alarm amplification.",
    warningSound: "Warning alarm",
    warningSoundHint: "When entering the zone or exceeding its speed limit.",
    safeSound: "Clearance chime",
    safeSoundHint: "When leaving the warning zone.",
    visualAlerts: "Screen alert",
    visualAlertsHint: "A clear colour flash in addition to sound.",
    vibration: "Vibration",
    vibrationHint: "Haptic signal when supported by the device.",
    energySaving: "Power-saving mode",
    energySavingHint: "OLED-black display far from shore or after no movement. GPS and warnings stay active.",
    energyDistance: "Activate beyond shoreline distance",
    energyStationary: "Activate after stationary",
    energyAnchorRadius: "Anchor circle",
    energyAnchorRadiusHint: "Swinging within this radius still counts as stationary.",
    energySection: "Power saving",
    anchorTimer: "Anchor timer",
    anchorRunning: "running",
    anchorReady: "active",
    anchorBlocked: "paused",
    diagnosticsSection: "Diagnostics",
    debugMode: "Show debug data",
    debugModeHint: "Shows local live, GPS, depth, alarm and anchor data. No data is transmitted.",
    debugCopy: "Copy data",
    go: "GO",
    noGo: "NO GO",
    goUnknown: "CHECK",
    powerNavigationScope: "Assessment measures shoreline clearance only",
    powerSavingActive: "Power-saving mode active",
    powerFar: "Shoreline is far away",
    powerStationary: "No movement detected",
    tapToWake: "Tap for full display",
    muted: "Muted",
    visualDistance: "Warning zone reached",
    visualDistanceDetail: (distance: number) => `Less than ${distance} m from shore`,
    visualSpeed: "Reduce speed",
    visualSpeedDetail: (speed: number) => `Above ${speed} kn near shore`,
    visualSafe: "Distance clear again",
    visualSafeDetail: (distance: number) => `More than ${distance} m from shore`,
    live: "Live",
    end: "End",
    waitingGps: "Waiting for GPS",
    weakGps: "Low GPS accuracy",
    weakGpsDetail: (accuracy: string, maximum: number) => `GPS accuracy ±${accuracy} m. Required: ±${maximum} m or better.`,
    gpsStale: "GPS data stale",
    gpsLost: "GPS signal lost",
    gpsStaleDetail: (seconds: number) => `Last position ${seconds} sec ago.`,
    gpsLostDetail: (seconds: number) => seconds > 0 ? `No new position for ${seconds} sec.` : "No reliable position available.",
    lastKnown: "Last known position",
    insideLimit: (distance: number) => `Inside ${distance} m`,
    clearLimit: (distance: number) => `${distance} m clear`,
    speedDanger: "Configured speed limit exceeded",
    speedDangerDetail: (speed: string, limit: string, distance: number) => `${speed} kn · ${limit} kn limit within ${distance} m`,
    playing: "Playing",
    blocked: "Blocked",
    ready: "Ready",
    notReady: "Not ready",
    nearestShore: "Nearest shoreline",
    chartDepth: "Chart depth",
    depthWaiting: "Waiting for GPS chart depth",
    depthLoading: "Loading chart depth",
    depthUnavailable: "No water depth in the chart grid",
    depthError: "Chart depth is currently unavailable",
    depthDetail: "EMODnet · approx. 115 m grid",
    metres: "metres",
    kilometres: "kilometres",
    acquiring: "acquiring",
    plotAcquiring: "Acquiring shoreline position",
    plotDistance: (distance: number) => `Nearest shoreline ${distance} metres away`,
    courseDanger: "Shoreline on current course",
    courseDangerDetail: (eta: string) => `${eta} to shore · check course`,
    courseWarning: (distance: number) => `${distance} m mark on current course`,
    courseWarningDetail: (eta: string) => `${eta} at current speed`,
    seconds: "sec",
    minutes: "min",
    shore: "shore",
    closing: "Shore closing rate",
    closingRate: (trend: "approaching" | "receding" | "steady" | "unknown", metresPerMinute: number | null) =>
      trend === "approaching" ? `Closing at ${metresPerMinute} metres per minute` : trend === "receding" ? `Opening at ${metresPerMinute} metres per minute` : trend === "steady" ? "Distance steady" : "Calculating closing rate",
    testAlarm: "Test alarm",
    nextPosition: "Next position",
    soundBlocked: "Sound blocked — raise media volume, then restart tracking.",
    soundMissing: "Alarm sound did not load — reopen the app.",
    locationUnavailable: "Live location is not available in this browser.",
    locationDenied: "Allow precise location and try again.",
    locationUnknown: "The phone cannot determine its location.",
    locationTimeout: "GPS timed out — keep the app visible.",
    distanceTab: "Distance",
    routeTab: "Route",
  },
} as const;

function subscribeToConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function BoatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 14.5 12 18l8-3.5-2.2 4.1A3 3 0 0 1 15.2 20H8.8a3 3 0 0 1-2.6-1.4L4 14.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7 13.5 8.2 8h7.6l1.2 5.5M12 8V4m0 0 3 2m-3-2L9 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 9.5h3.4L13 6v12l-4.6-3.5H5v-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M16 9a4 4 0 0 1 0 6m2.2-8.2a7 7 0 0 1 0 10.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function scheduleTone(context: AudioContext, start: number, frequency: number, volumePercent: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  const peak = Math.max(0.0001, getGeneratedAlertPeak(volumePercent));
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.025);
  gain.gain.setValueAtTime(peak, start + 0.27);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.35);
}

function scheduleChimeTone(context: AudioContext, start: number, frequency: number, volumePercent: number, duration = 0.36) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, getGeneratedAlertPeak(volumePercent)), start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function formatDistance(distance: number | null, language: Language) {
  if (distance === null) return "—";
  if (distance < 1_000) return Math.round(distance).toLocaleString(language === "de" ? "de-DE" : "en-US");
  return (distance / 1_000).toFixed(distance < 10_000 ? 2 : 1);
}

function formatEta(seconds: number, language: Language) {
  const copy = COPY[language];
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} ${copy.seconds}`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder === 60 ? `${minutes + 1} ${copy.minutes}` : `${minutes}:${remainder.toString().padStart(2, "0")} ${copy.minutes}`;
}

function formatTimer(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function polarPoint(centre: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: centre + Math.sin(radians) * radius, y: centre - Math.cos(radians) * radius };
}

function ringArc(centre: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarPoint(centre, radius, startAngle);
  const end = polarPoint(centre, radius, endAngle);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}

function ProximityPlot({
  pack,
  mapFeaturePack,
  fix,
  nearest,
  segments,
  courseToShore,
  courseRisk,
  rangeMetres,
  warningDistanceMetres,
  language,
}: {
  pack: CoastlinePack | null;
  mapFeaturePack: MapFeaturePack | null;
  fix: Fix | null;
  nearest: NearestShore | null;
  segments: ShorelineSegment[];
  courseToShore: CourseToShore | null;
  courseRisk: CourseRisk;
  rangeMetres: number;
  warningDistanceMetres: number;
  language: Language;
}) {
  const copy = COPY[language];
  const size = 360;
  const centre = size / 2;
  const pixelsPerMetre = 146 / rangeMetres;
  const metresPerLongitudeDegree = fix ? 111_320 * Math.cos((fix.latitude * Math.PI) / 180) : 1;
  const metresPerLatitudeDegree = 110_540;
  const point = useCallback((longitude: number, latitude: number) => ({
    x: centre + (longitude - (fix?.longitude ?? 0)) * metresPerLongitudeDegree * pixelsPerMetre,
    y: centre - (latitude - (fix?.latitude ?? 0)) * metresPerLatitudeDegree * pixelsPerMetre,
  }), [centre, fix?.latitude, fix?.longitude, metresPerLongitudeDegree, pixelsPerMetre]);
  const ringRadius = warningDistanceMetres * pixelsPerMetre;
  const nearestPoint = nearest ? point(nearest.longitude, nearest.latitude) : null;
  const coursePoint = courseToShore ? point(courseToShore.longitude, courseToShore.latitude) : null;
  const mapLabels = useMemo(() => {
    if (!fix) return [];
    const halfRangeMetres = centre / pixelsPerMetre;
    return placeMapFeatureLabels(
      getMapFeaturesInView(mapFeaturePack, fix, halfRangeMetres),
      (value) => point(value.longitude, value.latitude),
      size,
      10,
    );
  }, [centre, fix, mapFeaturePack, pixelsPerMetre, point, size]);

  const dangerSectors = useMemo(() => {
    if (!fix) return [];
    const sectors = new Set<number>();
    const longitudeScale = 111_320 * Math.cos((fix.latitude * Math.PI) / 180);

    for (const segment of segments) {
      const startX = (segment[0] - fix.longitude) * longitudeScale;
      const startY = (segment[1] - fix.latitude) * metresPerLatitudeDegree;
      const endX = (segment[2] - fix.longitude) * longitudeScale;
      const endY = (segment[3] - fix.latitude) * metresPerLatitudeDegree;
      const length = Math.hypot(endX - startX, endY - startY);
      const steps = Math.min(100, Math.max(1, Math.ceil(length / 18)));

      for (let index = 0; index <= steps; index += 1) {
        const position = index / steps;
        const east = startX + (endX - startX) * position;
        const north = startY + (endY - startY) * position;
        if (Math.hypot(east, north) > warningDistanceMetres) continue;
        const bearing = (Math.atan2(east, north) * 180) / Math.PI;
        const sector = Math.floor((((bearing + 360) % 360) / 5));
        sectors.add(sector);
        sectors.add((sector + 71) % 72);
        sectors.add((sector + 1) % 72);
      }
    }

    return Array.from(sectors).sort((left, right) => left - right);
  }, [fix, metresPerLatitudeDegree, segments, warningDistanceMetres]);

  const landHatchPath = useMemo(() => {
    if (!fix || !pack) return "";
    const bandHeight = 4;
    const minimumLongitude = fix.longitude - centre / (metresPerLongitudeDegree * pixelsPerMetre);
    const maximumLongitude = fix.longitude + centre / (metresPerLongitudeDegree * pixelsPerMetre);
    let path = "";

    for (let y = 0; y < size; y += bandHeight) {
      const sampleY = y + bandHeight / 2;
      const latitude = fix.latitude + (centre - sampleY) / (metresPerLatitudeDegree * pixelsPerMetre);
      const intervals = getLandIntervalsAtLatitude(pack, latitude, minimumLongitude, maximumLongitude);
      const top = Math.max(0, y - 0.25);
      const bottom = Math.min(size, y + bandHeight + 0.25);

      for (const [west, east] of intervals) {
        const left = Math.max(0, centre + (west - fix.longitude) * metresPerLongitudeDegree * pixelsPerMetre);
        const right = Math.min(size, centre + (east - fix.longitude) * metresPerLongitudeDegree * pixelsPerMetre);
        if (right > left) path += `M${left} ${top}H${right}V${bottom}H${left}Z`;
      }
    }
    return path;
  }, [centre, fix, metresPerLatitudeDegree, metresPerLongitudeDegree, pack, pixelsPerMetre, size]);

  return (
    <svg
      className="proximity-plot"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={nearest ? copy.plotDistance(Math.round(nearest.distance)) : copy.plotAcquiring}
    >
      <defs>
        <radialGradient id="plotGlow">
          <stop offset="0" stopColor="#123740" stopOpacity=".72" />
          <stop offset=".72" stopColor="#0a222a" stopOpacity=".18" />
          <stop offset="1" stopColor="#071b22" stopOpacity="0" />
        </radialGradient>
        <filter id="boatGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <pattern id="landHatch" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect className="land-fill-mark" width="12" height="12" />
          <path className="land-hatch-mark" d="M-3 12 12-3M6 15 15 6" />
        </pattern>
        <clipPath id="plotClip"><circle cx={centre} cy={centre} r="166" /></clipPath>
      </defs>
      <circle cx={centre} cy={centre} r="166" fill="url(#plotGlow)" />

      <g className="land-hatch-layer" aria-hidden="true" clipPath="url(#plotClip)">
        {landHatchPath && <path className="land-hatch-area" d={landHatchPath} />}
      </g>

      {nearestPoint && (
        <line
          className="nearest-shore-line"
          x1={centre}
          y1={centre}
          x2={nearestPoint.x}
          y2={nearestPoint.y}
          vectorEffect="non-scaling-stroke"
        />
      )}

      <g className="coast-layer">
        {fix && segments.map((segment, index) => {
          const start = point(segment[0], segment[1]);
          const end = point(segment[2], segment[3]);
          const close = distanceToSegment(fix.longitude, fix.latitude, segment).distance < warningDistanceMetres;
          return (
            <line
              className={`shore-segment ${close ? "close" : ""}`}
              key={`${segment.join(":")}:${index}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>

      <g className="map-feature-labels" aria-hidden="true">
        {mapLabels.map((label) => <g key={label.id} className={`map-feature-label ${label.kind}`} transform={`translate(${label.x} ${label.y})`}>
          {label.kind === "restaurant" && <circle r="2.2" />}
          <text y={label.kind === "restaurant" ? -4 : 0}>{label.name}</text>
        </g>)}
      </g>

      <circle className="proximity-ring" cx={centre} cy={centre} r={ringRadius} />
      {dangerSectors.map((sector) => (
        <path
          className="danger-ring-arc"
          key={sector}
          d={ringArc(centre, ringRadius, sector * 5 + 0.6, sector * 5 + 4.4)}
        />
      ))}

      {coursePoint && courseRisk.level !== "none" && (
        <>
          <line className="course-line" x1={centre} y1={centre} x2={coursePoint.x} y2={coursePoint.y} />
          <circle className="course-hit" cx={coursePoint.x} cy={coursePoint.y} r="4" />
        </>
      )}

      {nearestPoint && <circle className="nearest-point" cx={nearestPoint.x} cy={nearestPoint.y} r="3.8" />}

      {fix ? (
        <g className="map-boat" transform={`translate(${centre} ${centre}) rotate(${fix.heading ?? 0})`} filter="url(#boatGlow)">
          <circle className="boat-halo" cx="0" cy="0" r="17" />
          <path d="M0-14 8.5 10 0 6.5-8.5 10Z" />
          <circle className="boat-centre" cx="0" cy="0" r="2.6" />
        </g>
      ) : <text className="plot-placeholder" x={centre} y={centre}>{copy.waitingGps.toUpperCase()}</text>}
      <text className="proximity-map-credit" x="188" y="351">© OpenStreetMap contributors</text>
    </svg>
  );
}

export default function ShorelineApp() {
  const [language, setLanguage] = useState<Language>("de");
  const [theme, setTheme] = useState<Theme>("ocean");
  const [autoSunlight, setAutoSunlight] = useState(true);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [warningConfig, setWarningConfig] = useState<WarningConfig>(CROATIA_WARNING_CONFIG);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [pack, setPack] = useState<CoastlinePack | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [mapFeaturePack, setMapFeaturePack] = useState<MapFeaturePack | null>(null);
  const [mapFeatureError, setMapFeatureError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [fix, setFix] = useState<Fix | null>(null);
  const [demoIndex, setDemoIndex] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [trackingStartedAt, setTrackingStartedAt] = useState<number | null>(null);
  const [closingRateMetresPerSecond, setClosingRateMetresPerSecond] = useState<number | null>(null);
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [alarmError, setAlarmError] = useState<string | null>(null);
  const [alarmArmed, setAlarmArmed] = useState(false);
  const [alarmPlayback, setAlarmPlayback] = useState<AlarmPlayback>("idle");
  const [alarmPlayCount, setAlarmPlayCount] = useState(0);
  const [visualSignal, setVisualSignal] = useState<{ kind: VisualSignalKind; sequence: number } | null>(null);
  const [powerSaveWakeUntil, setPowerSaveWakeUntil] = useState(0);
  const [stationaryState, setStationaryState] = useState<StationaryState>(() => createStationaryState());
  const [trackerTab, setTrackerTab] = useState<TrackerTab>("distance");
  const [warningZoneInside, setWarningZoneInside] = useState<boolean | null>(null);
  const [currentDepthMetres, setCurrentDepthMetres] = useState<number | null>(null);
  const [currentDepthState, setCurrentDepthState] = useState<CurrentDepthState>("idle");
  const [depthDebug, setDepthDebug] = useState({ requestedAt: null as number | null, respondedAt: null as number | null, error: null as string | null });
  const watchId = useRef<number | null>(null);
  const modeRef = useRef<Mode>("idle");
  const wakeLock = useRef<ScreenWakeLock | null>(null);
  const wakeLockRequestPending = useRef(false);
  const wakeLockRetryTimer = useRef<number | null>(null);
  const alarmAudio = useRef<HTMLAudioElement | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const alarmMediaSource = useRef<MediaElementAudioSourceNode | null>(null);
  const alarmGain = useRef<GainNode | null>(null);
  const visualSignalTimer = useRef<number | null>(null);
  const visualSignalSequence = useRef(0);
  const distanceSamples = useRef<DistanceSample[]>([]);
  const demoTimestamp = useRef(0);
  const previousInsideLimit = useRef<boolean | null>(null);
  const previousSpeedViolation = useRef<boolean | null>(null);
  const warningSoundAvailableForDangerEpisode = useRef(false);
  const depthQueryPoint = useRef<{ key: string; latitude: number; longitude: number } | null>(null);
  const copy = COPY[language];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedLanguage = window.localStorage.getItem("shoreline-language");
      const savedTheme = window.localStorage.getItem("shoreline-theme");
      const savedAutoSunlight = window.localStorage.getItem(AUTO_SUNLIGHT_STORAGE_KEY);
      const savedWarningConfig = window.localStorage.getItem(WARNING_CONFIG_STORAGE_KEY);
      const savedDebug = window.localStorage.getItem(DEBUG_STORAGE_KEY);
      if (savedLanguage === "de" || savedLanguage === "en") setLanguage(savedLanguage);
      if (savedTheme === "ocean" || savedTheme === "xp" || savedTheme === "dark" || savedTheme === "nautical") setTheme(savedTheme);
      if (savedAutoSunlight === "false") setAutoSunlight(false);
      if (savedAutoSunlight === "true") setAutoSunlight(true);
      if (savedWarningConfig) {
        try {
          setWarningConfig(sanitizeWarningConfig(JSON.parse(savedWarningConfig)));
        } catch {
          setWarningConfig(CROATIA_WARNING_CONFIG);
        }
      }
      setDebugEnabled(savedDebug === "true")