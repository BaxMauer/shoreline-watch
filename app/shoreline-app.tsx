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
import { classifyWarningZone, getWarningHysteresisMetres, getWarningOutputPlan, getWarningTransition } from "../lib/warning-state";
import { getGeneratedAlertPeak } from "../lib/audio-levels";
import { APP_VERSION } from "../lib/app-version";
import RoutePlanner from "./route-planner";
import {
  getGoNoGoState,
  getPlotRangeMetres,
  getPowerSaveReason,
  updateStationaryState,
  type StationaryState,
} from "../lib/navigation-display";
import {
  calculateClosingRate,
  classifyClosingRate,
  getGpsNavigationState,
  getGpsSignalState,
  MAXIMUM_NAVIGATION_ACCURACY_METRES,
  shouldUseSunlightMode,
  type DistanceSample,
} from "../lib/navigation-metrics";

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

const WARNING_CONFIG_STORAGE_KEY = "shoreline-warning-config-v1";
const AUTO_SUNLIGHT_STORAGE_KEY = "shoreline-auto-sunlight";
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
    finePrint: "Nur als Navigationshilfe. Amtliche Seekarte verwenden und Ausguck halten.",
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
    quietAtSafeSpeed: "Distanzton nur bei zu hohem Tempo",
    quietAtSafeSpeedHint: (speed: number) => `Bis ${speed} kn bleibt der Ton beim Einfahren aus. Bildschirmwarnung und Vibration bleiben aktiv.`,
    croatiaPreset: "Kroatienwerte",
    croatiaRule: "Kroatien: maximal 8 kn bis 300 m zur Küste; Glisierfahrt erst außerhalb von 300 m.",
    alertOutputs: "Alarmausgabe",
    alertVolume: "Lautstärke",
    volumeBoostHint: "Über 100 % wird der Alarm zusätzlich verstärkt.",
    warningSound: "Warnalarm",
    warningSoundHint: "Beim Einfahren oder Überschreiten des Tempolimits.",
    safeSound: "Freifahrtton",
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
    go: "GO",
    noGo: "NO GO",
    goUnknown: "PRÜFEN",
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
    speedDanger: "Zu schnell nahe der Küste",
    speedDangerDetail: (speed: string, limit: string, distance: number) => `${speed} kn · Limit ${limit} kn innerhalb ${distance} m`,
    playing: "Wiedergabe",
    blocked: "Blockiert",
    ready: "Bereit",
    notReady: "Nicht bereit",
    nearestShore: "Nächste Küste",
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
    finePrint: "Navigation aid only. Keep an approved chart and normal lookout.",
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
    quietAtSafeSpeed: "Distance sound only above speed limit",
    quietAtSafeSpeedHint: (speed: number) => `At or below ${speed} kn, entering the zone stays silent. Screen alert and vibration remain active.`,
    croatiaPreset: "Croatia preset",
    croatiaRule: "Croatia: maximum 8 kn within 300 m of shore; planing only beyond 300 m.",
    alertOutputs: "Alert outputs",
    alertVolume: "Volume",
    volumeBoostHint: "Above 100% adds extra alarm amplification.",
    warningSound: "Warning alarm",
    warningSoundHint: "When entering the zone or exceeding its speed limit.",
    safeSound: "Safe-water chime",
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
    go: "GO",
    noGo: "NO GO",
    goUnknown: "CHECK",
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
    speedDanger: "Too fast near shoreline",
    speedDangerDetail: (speed: string, limit: string, distance: number) => `${speed} kn · ${limit} kn limit within ${distance} m`,
    playing: "Playing",
    blocked: "Blocked",
    ready: "Ready",
    notReady: "Not ready",
    nearestShore: "Nearest shoreline",
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
  const point = (longitude: number, latitude: number) => ({
    x: centre + (longitude - (fix?.longitude ?? 0)) * metresPerLongitudeDegree * pixelsPerMetre,
    y: centre - (latitude - (fix?.latitude ?? 0)) * metresPerLatitudeDegree * pixelsPerMetre,
  });
  const ringRadius = warningDistanceMetres * pixelsPerMetre;
  const nearestPoint = nearest ? point(nearest.longitude, nearest.latitude) : null;
  const coursePoint = courseToShore ? point(courseToShore.longitude, courseToShore.latitude) : null;

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
    </svg>
  );
}

export default function ShorelineApp() {
  const [language, setLanguage] = useState<Language>("de");
  const [theme, setTheme] = useState<Theme>("ocean");
  const [autoSunlight, setAutoSunlight] = useState(true);
  const [warningConfig, setWarningConfig] = useState<WarningConfig>(CROATIA_WARNING_CONFIG);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [pack, setPack] = useState<CoastlinePack | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
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
  const [stationaryState, setStationaryState] = useState<StationaryState>({ reference: null, lastMovementAt: 0 });
  const [trackerTab, setTrackerTab] = useState<TrackerTab>("distance");
  const [warningZoneInside, setWarningZoneInside] = useState<boolean | null>(null);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
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
  const copy = COPY[language];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedLanguage = window.localStorage.getItem("shoreline-language");
      const savedTheme = window.localStorage.getItem("shoreline-theme");
      const savedAutoSunlight = window.localStorage.getItem(AUTO_SUNLIGHT_STORAGE_KEY);
      const savedWarningConfig = window.localStorage.getItem(WARNING_CONFIG_STORAGE_KEY);
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
      setPreferencesLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem("shoreline-language", language);
    window.localStorage.setItem("shoreline-theme", theme);
    window.localStorage.setItem(AUTO_SUNLIGHT_STORAGE_KEY, String(autoSunlight));
    window.localStorage.setItem(WARNING_CONFIG_STORAGE_KEY, JSON.stringify(warningConfig));
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
  }, [autoSunlight, language, preferencesLoaded, theme, warningConfig]);

  useEffect(() => {
    if (mode === "idle") return;
    const interval = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [mode]);

  useEffect(() => {
    let refreshing = false;
    const refreshForUpdate = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", refreshForUpdate);
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    fetch("/data/croatia-coastline.json")
      .then((response) => {
        if (!response.ok) throw new Error("Coastline pack could not be loaded.");
        return response.json() as Promise<CoastlinePack>;
      })
      .then((data) => setPack(data))
      .catch((error: unknown) => setPackError(error instanceof Error ? error.message : "Coastline pack could not be loaded."));

    return () => navigator.serviceWorker?.removeEventListener("controllerchange", refreshForUpdate);
  }, []);

  const nearest = useMemo<NearestShore | null>(() => {
    if (!pack || !fix) return null;
    return findNearestShore(pack, fix.longitude, fix.latitude);
  }, [pack, fix]);

  const gpsSignalState = getGpsSignalState(
    mode === "live",
    fix?.timestamp ?? null,
    trackingStartedAt,
    clockNow,
  );
  const gpsNavigationState = getGpsNavigationState(gpsSignalState, fix?.accuracy);
  const gpsReliable = gpsNavigationState === "reliable";
  const gpsAgeSeconds = Math.max(0, Math.floor((clockNow - (fix?.timestamp ?? trackingStartedAt ?? clockNow)) / 1_000));
  const gpsSignalProblem = gpsSignalState === "stale" || gpsSignalState === "lost";
  const gpsNavigationProblem = gpsNavigationState !== "reliable";
  const sunlightActive = mode !== "idle" && shouldUseSunlightMode(
    autoSunlight,
    clockNow,
    fix?.latitude ?? null,
    fix?.longitude ?? null,
  );

  useEffect(() => {
    if (!nearest || !fix || mode === "idle") return;
    const lastSample = distanceSamples.current.at(-1);
    if (lastSample?.timestamp === fix.timestamp) return;
    if (lastSample && (fix.timestamp <= lastSample.timestamp || fix.timestamp - lastSample.timestamp > 30_000)) {
      distanceSamples.current = [];
    }
    distanceSamples.current.push({ timestamp: fix.timestamp, distanceMetres: nearest.distance });
    distanceSamples.current = distanceSamples.current.filter((sample) => sample.timestamp >= fix.timestamp - 20_000).slice(-12);
    setClosingRateMetresPerSecond(calculateClosingRate(distanceSamples.current));
  }, [fix, mode, nearest]);

  const viewRangeMetres = getPlotRangeMetres(nearest?.distance ?? null, warningConfig.distanceMetres);
  const nearbySegments = useMemo(() => {
    if (!pack || !fix) return [];
    return getNearbyShorelineSegments(pack, fix.longitude, fix.latitude, viewRangeMetres * 1.15);
  }, [fix, pack, viewRangeMetres]);

  const courseToShore = useMemo(() => {
    if (!fix || fix.heading === null) return null;
    return findCourseToShore(nearbySegments, fix.longitude, fix.latitude, fix.heading);
  }, [fix, nearbySegments]);

  const speedMetresPerSecond = fix?.speed ?? 0;
  const speedKnots = fix?.speed == null ? null : fix.speed * 1.943844;
  const conservativeDistance = nearest && fix && Number.isFinite(fix.accuracy) && fix.accuracy >= 0
    ? Math.max(0, nearest.distance - fix.accuracy)
    : null;
  const rawInsideLimit = conservativeDistance !== null && conservativeDistance < warningConfig.distanceMetres;
  const insideLimit = warningZoneInside ?? rawInsideLimit;
  const speedViolation = warningConfig.speedWarningEnabled
    && insideLimit
    && speedKnots !== null
    && speedKnots > warningConfig.maxSpeedKnots;
  const activeSpeedViolation = gpsReliable && speedViolation;
  const isUnderway = speedMetresPerSecond >= 0.77;
  const closingTrend = classifyClosingRate(gpsReliable ? closingRateMetresPerSecond : null);
  const closingMetresPerMinute = closingRateMetresPerSecond === null || !gpsReliable
    ? null
    : Math.round(Math.abs(closingRateMetresPerSecond) * 60);

  const courseRisk = useMemo<CourseRisk>(() => {
    if (!gpsReliable || !courseToShore || !isUnderway) return { level: "none", label: "", detail: "" };
    const secondsToShore = courseToShore.distance / speedMetresPerSecond;
    const secondsToMark = Math.max(0, (courseToShore.distance - warningConfig.distanceMetres) / speedMetresPerSecond);

    if (insideLimit && secondsToShore <= 300) {
      return {
        level: "danger",
        label: copy.courseDanger,
        detail: copy.courseDangerDetail(formatEta(secondsToShore, language)),
      };
    }
    if (!insideLimit && secondsToMark <= 180) {
      return {
        level: "warning",
        label: copy.courseWarning(warningConfig.distanceMetres),
        detail: copy.courseWarningDetail(formatEta(secondsToMark, language)),
      };
    }
    return { level: "none", label: "", detail: "" };
  }, [copy, courseToShore, gpsReliable, insideLimit, isUnderway, language, speedMetresPerSecond, warningConfig.distanceMetres]);

  const goNoGoState = getGoNoGoState(
    conservativeDistance,
    warningConfig.distanceMetres,
    gpsReliable,
    warningZoneInside,
  );
  const powerSaveReason = getPowerSaveReason({
    enabled: warningConfig.powerSaveEnabled,
    tracking: mode === "live",
    gpsIsReliable: gpsReliable,
    distanceMetres: nearest?.distance ?? null,
    farDistanceMetres: warningConfig.powerSaveDistanceMetres,
    lastMovementAt: stationaryState.lastMovementAt,
    stationaryAfterMinutes: warningConfig.powerSaveStationaryMinutes,
    alertActive: insideLimit || activeSpeedViolation || courseRisk.level !== "none" || visualSignal !== null,
    wakeUntil: powerSaveWakeUntil,
    now: clockNow,
  });

  const wakePowerDisplay = useCallback(() => {
    setPowerSaveWakeUntil(Date.now() + 30_000);
  }, []);

  const getAudioContext = useCallback(() => {
    if (audioContext.current && audioContext.current.state !== "closed") return audioContext.current;
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext.current = new AudioContextClass();
    return audioContext.current;
  }, []);

  const ensureAlarmAudioGraph = useCallback(() => {
    const context = getAudioContext();
    const audio = alarmAudio.current;
    if (!context || !audio) return context;
    if (!alarmMediaSource.current || !alarmGain.current) {
      try {
        alarmMediaSource.current = context.createMediaElementSource(audio);
        alarmGain.current = context.createGain();
        alarmMediaSource.current.connect(alarmGain.current);
        alarmGain.current.connect(context.destination);
      } catch {
        alarmMediaSource.current = null;
        alarmGain.current = null;
      }
    }
    if (alarmGain.current) {
      alarmGain.current.gain.setValueAtTime(warningConfig.alertVolumePercent / 100, context.currentTime);
    } else {
      audio.volume = Math.min(1, warningConfig.alertVolumePercent / 100);
    }
    return context;
  }, [getAudioContext, warningConfig.alertVolumePercent]);

  useEffect(() => {
    const context = audioContext.current;
    if (context && alarmGain.current) {
      alarmGain.current.gain.setValueAtTime(warningConfig.alertVolumePercent / 100, context.currentTime);
    } else if (alarmAudio.current) {
      alarmAudio.current.volume = Math.min(1, warningConfig.alertVolumePercent / 100);
    }
  }, [warningConfig.alertVolumePercent]);

  const soundWebAudioFallback = useCallback(async () => {
    const context = getAudioContext();
    if (!context) return false;
    try {
      if (context.state === "suspended") await context.resume();
      if (context.state !== "running") return false;
      const start = context.currentTime + 0.02;
      scheduleTone(context, start, 880, warningConfig.alertVolumePercent);
      scheduleTone(context, start + 0.46, 880, warningConfig.alertVolumePercent);
      scheduleTone(context, start + 0.92, 1_040, warningConfig.alertVolumePercent);
      return true;
    } catch {
      return false;
    }
  }, [getAudioContext, warningConfig.alertVolumePercent]);

  const primeAlarm = useCallback(async () => {
    const audio = alarmAudio.current;
    if (!audio) return false;
    try {
      const context = ensureAlarmAudioGraph();
      if (context?.state === "suspended") await context.resume();
      if (context?.state === "running") {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.02);
      }
      audio.muted = false;
      if (alarmGain.current && context) {
        alarmGain.current.gain.setValueAtTime(0.0001, context.currentTime);
      } else {
        audio.volume = 0;
      }
      audio.currentTime = 0;
      await audio.play();
      window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        if (alarmGain.current && context) {
          alarmGain.current.gain.setValueAtTime(warningConfig.alertVolumePercent / 100, context.currentTime);
        } else {
          audio.volume = Math.min(1, warningConfig.alertVolumePercent / 100);
        }
        setAlarmPlayback("ready");
      }, 70);
      setAlarmArmed(true);
      setAlarmError(null);
      setAlarmPlayback("playing");
      return true;
    } catch {
      setAlarmArmed(false);
      setAlarmPlayback("blocked");
      setAlarmError(copy.soundBlocked);
      return false;
    }
  }, [copy.soundBlocked, ensureAlarmAudioGraph, warningConfig.alertVolumePercent]);

  const soundAlarm = useCallback(async () => {
    const audio = alarmAudio.current;
    if (!audio) {
      setAlarmError(copy.soundMissing);
      return false;
    }
    try {
      const context = ensureAlarmAudioGraph();
      if (context?.state === "suspended") await context.resume();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      if (alarmGain.current && context) {
        alarmGain.current.gain.setValueAtTime(warningConfig.alertVolumePercent / 100, context.currentTime);
      } else {
        audio.volume = Math.min(1, warningConfig.alertVolumePercent / 100);
      }
      setAlarmPlayback("starting");
      await audio.play();
      setAlarmArmed(true);
      setAlarmError(null);
      setAlarmPlayback("playing");
      setAlarmPlayCount((count) => count + 1);
      return true;
    } catch {
      const fallbackWorked = await soundWebAudioFallback();
      if (fallbackWorked) {
        setAlarmArmed(true);
        setAlarmError(null);
        setAlarmPlayback("playing");
        setAlarmPlayCount((count) => count + 1);
        return true;
      }
      setAlarmArmed(false);
      setAlarmPlayback("blocked");
      setAlarmError(copy.soundBlocked);
      return false;
    }
  }, [copy.soundBlocked, copy.soundMissing, ensureAlarmAudioGraph, soundWebAudioFallback, warningConfig.alertVolumePercent]);

  const soundSafeChime = useCallback(async () => {
    const context = getAudioContext();
    if (!context) return false;
    try {
      if (context.state === "suspended") await context.resume();
      if (context.state !== "running") return false;
      const start = context.currentTime + 0.02;
      scheduleChimeTone(context, start, 523.25, warningConfig.alertVolumePercent, 0.26);
      scheduleChimeTone(context, start + 0.3, 659.25, warningConfig.alertVolumePercent, 0.26);
      scheduleChimeTone(context, start + 0.6, 783.99, warningConfig.alertVolumePercent, 0.38);
      setAlarmError(null);
      setAlarmPlayback("playing");
      window.setTimeout(() => setAlarmPlayback("ready"), 1_050);
      return true;
    } catch {
      setAlarmPlayback("blocked");
      setAlarmError(copy.soundBlocked);
      return false;
    }
  }, [copy.soundBlocked, getAudioContext, warningConfig.alertVolumePercent]);

  const triggerVisualSignal = useCallback((kind: VisualSignalKind) => {
    if (!warningConfig.visualAlertsEnabled) return;
    visualSignalSequence.current += 1;
    const sequence = visualSignalSequence.current;
    setVisualSignal({ kind, sequence });
    if (visualSignalTimer.current !== null) window.clearTimeout(visualSignalTimer.current);
    visualSignalTimer.current = window.setTimeout(() => {
      setVisualSignal((current) => current?.sequence === sequence ? null : current);
      visualSignalTimer.current = null;
    }, kind === "safe" ? 2_000 : 2_400);
  }, [warningConfig.visualAlertsEnabled]);

  const triggerVibration = useCallback((kind: "danger" | "safe") => {
    if (!warningConfig.vibrationEnabled || !("vibrate" in navigator)) return;
    navigator.vibrate(kind === "danger" ? [300, 120, 300, 120, 600] : [90, 70, 160]);
  }, [warningConfig.vibrationEnabled]);

  const testWarningOutputs = useCallback(() => {
    triggerVisualSignal("distance");
    triggerVibration("danger");
    if (warningConfig.warningSoundEnabled && warningConfig.alertVolumePercent > 0) void soundAlarm();
  }, [soundAlarm, triggerVibration, triggerVisualSignal, warningConfig.alertVolumePercent, warningConfig.warningSoundEnabled]);

  useEffect(() => {
    if (mode === "idle" || conservativeDistance === null || !gpsReliable) return;
    const wasInside = previousInsideLimit.current;
    const wasSpeedViolation = previousSpeedViolation.current;
    const nextInside = classifyWarningZone(wasInside, conservativeDistance, warningConfig.distanceMetres);
    const nextSpeedViolation = warningConfig.speedWarningEnabled
      && nextInside
      && speedKnots !== null
      && speedKnots > warningConfig.maxSpeedKnots;
    const transition = getWarningTransition(wasInside, nextInside, wasSpeedViolation, nextSpeedViolation);
    const outputPlan = getWarningOutputPlan(transition, {
      ...warningConfig,
      speedKnown: speedKnots !== null,
      speedViolation: nextSpeedViolation,
    });
    if (outputPlan.visual) triggerVisualSignal(outputPlan.visual);
    if (outputPlan.vibration) triggerVibration(outputPlan.vibration);
    if (outputPlan.sound === "warning") void soundAlarm();
    if (outputPlan.sound === "safe") void soundSafeChime();
    previousInsideLimit.current = nextInside;
    previousSpeedViolation.current = nextSpeedViolation;
    setWarningZoneInside(nextInside);
  }, [conservativeDistance, gpsReliable, mode, soundAlarm, soundSafeChime, speedKnots, triggerVibration, triggerVisualSignal, warningConfig]);

  const requestWakeLock = useCallback(async () => {
    const wakeNavigator = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    try {
      wakeLock.current = (await wakeNavigator.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLock.current = null;
    }
  }, []);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    alarmAudio.current?.pause();
    setFix(null);
    setTrackingError(null);
    setAlarmError(null);
    setAlarmArmed(false);
    setAlarmPlayback("idle");
    setVisualSignal(null);
    if (visualSignalTimer.current !== null) window.clearTimeout(visualSignalTimer.current);
    visualSignalTimer.current = null;
    setMode("idle");
    setDemoIndex(0);
    setTrackingStartedAt(null);
    setClosingRateMetresPerSecond(null);
    distanceSamples.current = [];
    previousInsideLimit.current = null;
    previousSpeedViolation.current = null;
    setWarningZoneInside(null);
    setPowerSaveWakeUntil(0);
    setStationaryState({ reference: null, lastMovementAt: 0 });
    setTrackerTab("distance");
  }, []);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    wakeLock.current?.release().catch(() => undefined);
    audioContext.current?.close().catch(() => undefined);
    if (visualSignalTimer.current !== null) window.clearTimeout(visualSignalTimer.current);
  }, []);

  const startLive = useCallback(async () => {
    if (!pack || !navigator.geolocation) {
      setTrackingError(copy.locationUnavailable);
      return;
    }
    if ((warningConfig.warningSoundEnabled || warningConfig.safeSoundEnabled) && warningConfig.alertVolumePercent > 0) {
      void primeAlarm();
    } else {
      setAlarmArmed(false);
      setAlarmPlayback("idle");
      setAlarmError(null);
    }
    previousInsideLimit.current = null;
    previousSpeedViolation.current = null;
    setWarningZoneInside(null);
    const startedAt = Date.now();
    setStationaryState({ reference: null, lastMovementAt: startedAt });
    setPowerSaveWakeUntil(0);
    setClockNow(startedAt);
    setTrackingStartedAt(startedAt);
    setClosingRateMetresPerSecond(null);
    distanceSamples.current = [];
    setMode("live");
    setTrackerTab("distance");
    setTrackingError(null);
    await requestWakeLock();
    navigator.storage?.persist?.().catch(() => false);
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const nextFix: Fix = {
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp,
        };
        setStationaryState((current) => updateStationaryState(current, nextFix, warningConfig.powerSaveAnchorRadiusMetres));
        setFix(nextFix);
        setTrackingError(null);
      },
      (error) => {
        const messages: Record<number, string> = {
          1: copy.locationDenied,
          2: copy.locationUnknown,
          3: copy.locationTimeout,
        };
        setTrackingError(messages[error.code] ?? copy.locationUnavailable);
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );
  }, [copy, pack, primeAlarm, requestWakeLock, warningConfig.alertVolumePercent, warningConfig.powerSaveAnchorRadiusMetres, warningConfig.safeSoundEnabled, warningConfig.warningSoundEnabled]);

  const setDemoFix = useCallback((index: number, timestamp = Date.now()) => {
    if (!pack) return;
    const anchorShore = findNearestShore(pack, DEMO_ANCHOR.longitude, DEMO_ANCHOR.latitude);
    if (!anchorShore) return;
    const bearingFromShore = (anchorShore.bearing + 180) % 360;
    const point = offsetFromShore(anchorShore, bearingFromShore, warningConfig.distanceMetres * DEMO_DISTANCE_FACTORS[index]);
    setFix({
      ...point,
      accuracy: 6,
      speed: DEMO_SPEEDS[index] / 1.943844,
      heading: (anchorShore.bearing + (index === 4 ? 180 : 0)) % 360,
      timestamp,
    });
  }, [pack, warningConfig.distanceMetres]);

  const startDemo = useCallback(() => {
    if ((warningConfig.warningSoundEnabled || warningConfig.safeSoundEnabled) && warningConfig.alertVolumePercent > 0) {
      void primeAlarm();
    } else {
      setAlarmArmed(false);
      setAlarmPlayback("idle");
      setAlarmError(null);
    }
    previousInsideLimit.current = null;
    previousSpeedViolation.current = null;
    setWarningZoneInside(null);
    demoTimestamp.current = Date.now();
    setClockNow(demoTimestamp.current);
    setTrackingStartedAt(demoTimestamp.current);
    setClosingRateMetresPerSecond(null);
    distanceSamples.current = [];
    setMode("demo");
    setTrackerTab("distance");
    setTrackingError(null);
    setDemoIndex(0);
    setDemoFix(0, demoTimestamp.current);
  }, [primeAlarm, setDemoFix, warningConfig.alertVolumePercent, warningConfig.safeSoundEnabled, warningConfig.warningSoundEnabled]);

  const advanceDemo = useCallback(() => {
    const next = (demoIndex + 1) % DEMO_DISTANCE_FACTORS.length;
    demoTimestamp.current += 20_000;
    setDemoIndex(next);
    setDemoFix(next, demoTimestamp.current);
  }, [demoIndex, setDemoFix]);

  const distanceUnit = nearest && nearest.distance >= 1_000 ? copy.kilometres : copy.metres;
  const statusLabel = gpsNavigationState === "lost"
    ? copy.gpsLost
    : gpsNavigationState === "stale"
      ? copy.gpsStale
      : gpsNavigationState === "waiting" || !nearest
        ? copy.waitingGps
        : gpsNavigationState === "inaccurate"
          ? copy.weakGps
          : activeSpeedViolation
            ? copy.speedDanger
            : insideLimit
              ? copy.insideLimit(warningConfig.distanceMetres)
              : copy.clearLimit(warningConfig.distanceMetres);
  const gpsAccuracyLabel = fix && Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy).toString() : "—";
  const gpsNavigationDetail = gpsNavigationState === "inaccurate"
    ? copy.weakGpsDetail(gpsAccuracyLabel, MAXIMUM_NAVIGATION_ACCURACY_METRES)
    : gpsNavigationState === "stale"
      ? copy.gpsStaleDetail(gpsAgeSeconds)
      : copy.gpsLostDetail(gpsAgeSeconds);
  const closingDisplay = closingTrend === "approaching"
    ? `↓${closingMetresPerMinute}`
    : closingTrend === "receding"
      ? `↑${closingMetresPerMinute}`
      : closingTrend === "steady"
        ? "≈0"
        : "—";
  const warningSoundMuted = !warningConfig.warningSoundEnabled || warningConfig.alertVolumePercent === 0;
  const alarmLabel = warningSoundMuted
    ? copy.muted
    : alarmPlayback === "playing" || alarmPlayback === "starting"
      ? copy.playing
      : alarmPlayback === "blocked"
        ? copy.blocked
        : alarmArmed
          ? copy.ready
          : copy.notReady;
  const visualSignalCopy = visualSignal?.kind === "speed"
    ? { title: copy.visualSpeed, detail: copy.visualSpeedDetail(warningConfig.maxSpeedKnots) }
    : visualSignal?.kind === "safe"
      ? { title: copy.visualSafe, detail: copy.visualSafeDetail(warningConfig.distanceMetres) }
      : { title: copy.visualDistance, detail: copy.visualDistanceDetail(warningConfig.distanceMetres) };

  return (
    <main className={`app-shell theme-${theme} ${mode !== "idle" ? "is-tracking" : ""} ${sunlightActive ? "sunlight-mode" : ""} ${powerSaveReason ? "power-save-active" : ""}`}>
      <audio
        className="alarm-audio"
        ref={alarmAudio}
        src="/audio/shoreline-alarm.wav"
        preload="auto"
        playsInline
        onPlaying={() => setAlarmPlayback("playing")}
        onEnded={() => setAlarmPlayback("ready")}
        onError={() => {
          setAlarmPlayback("blocked");
          setAlarmError(copy.soundMissing);
        }}
      />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><BoatIcon /></span>
          <span>Shoreline Watch</span>
          <span className="app-version">v{APP_VERSION}</span>
        </div>
        <div className="connection" aria-live="polite">
          <span className={`connection-dot ${online ? "" : "offline"}`} />
          {online ? copy.online : copy.offline}
        </div>
      </header>

      {mode === "idle" ? (
        <>
          <section className="intro">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.heroTitle}</h1>
            <p className="intro-copy">{copy.intro(warningConfig.distanceMetres)}</p>
          </section>

          <section className="launch-panel" aria-label={copy.startAria}>
            <div className={`readiness ${packError ? "failed" : ""}`}>
              <span className="readiness-dot" />
              {packError ? copy.coastError : pack ? copy.coastReady : copy.coastLoading}
            </div>
            <div className="preferences">
              <label className="preference-field">
                <span>{copy.language}</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="preference-field">
                <span>{copy.theme}</span>
                <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                  <option value="ocean">{copy.themeOcean}</option>
                  <option value="xp">{copy.themeXp}</option>
                  <option value="dark">{copy.themeDark}</option>
                  <option value="nautical">{copy.themeNautical}</option>
                </select>
              </label>
            </div>
            <label className="sunlight-setting">
              <span><strong>{copy.autoSunlight}</strong><small>{copy.autoSunlightHint}</small></span>
              <input type="checkbox" checked={autoSunlight} onChange={(event) => setAutoSunlight(event.target.checked)} />
            </label>
            <details className="warning-settings">
              <summary>
                <span>{copy.settings}</span>
                <strong>{copy.settingsSummary(warningConfig.distanceMetres, warningConfig.speedWarningEnabled, warningConfig.maxSpeedKnots, warningConfig.alertVolumePercent)}</strong>
              </summary>
              <div className="settings-content">
                <label className="setting-row" htmlFor="warning-distance">
                  <span>{copy.distanceWarning}</span>
                  <span className="number-field"><input id="warning-distance" type="number" inputMode="numeric" min="50" max="2000" step="10" value={warningConfig.distanceMetres} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setWarningConfig((current) => ({ ...current, distanceMetres: event.target.valueAsNumber }))} onBlur={() => setWarningConfig((current) => sanitizeWarningConfig(current))} /><b>m</b></span>
                </label>
                <p className="setting-note">{copy.hysteresisHint(getWarningHysteresisMetres(warningConfig.distanceMetres))}</p>
                <label className="volume-setting display-size-setting" htmlFor="distance-text-size">
                  <span><strong>{copy.distanceTextSize}</strong><small>{copy.distanceTextSizeHint}</small></span>
                  <output htmlFor="distance-text-size">{warningConfig.distanceTextScalePercent}%</output>
                  <input id="distance-text-size" type="range" min="80" max="150" step="5" value={warningConfig.distanceTextScalePercent} onChange={(event) => setWarningConfig((current) => sanitizeWarningConfig({ ...current, distanceTextScalePercent: event.target.valueAsNumber }))} />
                </label>
                <label className="toggle-row">
                  <span><strong>{copy.speedWarning}</strong><small>{copy.speedWarningHint(warningConfig.distanceMetres)}</small></span>
                  <input type="checkbox" checked={warningConfig.speedWarningEnabled} onChange={(event) => setWarningConfig((current) => ({ ...current, speedWarningEnabled: event.target.checked }))} />
                </label>
                {warningConfig.speedWarningEnabled && (
                  <>
                    <label className="setting-row" htmlFor="speed-limit">
                      <span>{copy.speedLimit}</span>
                      <span className="number-field"><input id="speed-limit" type="number" inputMode="decimal" min="1" max="40" step="0.5" value={warningConfig.maxSpeedKnots} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setWarningConfig((current) => ({ ...current, maxSpeedKnots: event.target.valueAsNumber }))} onBlur={() => setWarningConfig((current) => sanitizeWarningConfig(current))} /><b>kn</b></span>
                    </label>
                    <label className="toggle-row">
                      <span><strong>{copy.quietAtSafeSpeed}</strong><small>{copy.quietAtSafeSpeedHint(warningConfig.maxSpeedKnots)}</small></span>
                      <input type="checkbox" checked={warningConfig.suppressDistanceSoundAtSafeSpeed} onChange={(event) => setWarningConfig((current) => ({ ...current, suppressDistanceSoundAtSafeSpeed: event.target.checked }))} />
                    </label>
                  </>
                )}
                <p className="settings-section-label">{copy.alertOutputs}</p>
                <label className="volume-setting" htmlFor="alert-volume">
                  <span><strong>{copy.alertVolume}</strong><small>{copy.volumeBoostHint}</small></span>
                  <output htmlFor="alert-volume">{warningConfig.alertVolumePercent}%</output>
                  <input id="alert-volume" type="range" min="0" max="200" step="5" value={warningConfig.alertVolumePercent} onChange={(event) => setWarningConfig((current) => sanitizeWarningConfig({ ...current, alertVolumePercent: event.target.valueAsNumber }))} />
                </label>
                <label className="toggle-row">
                  <span><strong>{copy.warningSound}</strong><small>{copy.warningSoundHint}</small></span>
                  <input type="checkbox" checked={warningConfig.warningSoundEnabled} onChange={(event) => setWarningConfig((current) => ({ ...current, warningSoundEnabled: event.target.checked }))} />
                </label>
                <label className="toggle-row">
                  <span><strong>{copy.safeSound}</strong><small>{copy.safeSoundHint}</small></span>
                  <input type="checkbox" checked={warningConfig.safeSoundEnabled} onChange={(event) => setWarningConfig((current) => ({ ...current, safeSoundEnabled: event.target.checked }))} />
                </label>
                <label className="toggle-row">
                  <span><strong>{copy.visualAlerts}</strong><small>{copy.visualAlertsHint}</small></span>
                  <input type="checkbox" checked={warningConfig.visualAlertsEnabled} onChange={(event) => setWarningConfig((current) => ({ ...current, visualAlertsEnabled: event.target.checked }))} />
                </label>
                <label className="toggle-row">
                  <span><strong>{copy.vibration}</strong><small>{copy.vibrationHint}</small></span>
                  <input type="checkbox" checked={warningConfig.vibrationEnabled} onChange={(event) => setWarningConfig((current) => ({ ...current, vibrationEnabled: event.target.checked }))} />
                </label>
                <p className="settings-section-label">{copy.energySection}</p>
                <label className="toggle-row">
                  <span><strong>{copy.energySaving}</strong><small>{copy.energySavingHint}</small></span>
                  <input type="checkbox" checked={warningConfig.powerSaveEnabled} onChange={(event) => setWarningConfig((current) => ({ ...current, powerSaveEnabled: event.target.checked }))} />
                </label>
                {warningConfig.powerSaveEnabled && (
                  <>
                    <label className="setting-row" htmlFor="power-distance">
                      <span>{copy.energyDistance}</span>
                      <span className="number-field"><input id="power-distance" type="number" inputMode="numeric" min="500" max="20000" step="100" value={warningConfig.powerSaveDistanceMetres} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setWarningConfig((current) => ({ ...current, powerSaveDistanceMetres: event.target.valueAsNumber }))} onBlur={() => setWarningConfig((current) => sanitizeWarningConfig(current))} /><b>m</b></span>
                    </label>
                    <label className="setting-row" htmlFor="power-stationary">
                      <span>{copy.energyStationary}</span>
                      <span className="number-field"><input id="power-stationary" type="number" inputMode="numeric" min="1" max="30" step="1" value={warningConfig.powerSaveStationaryMinutes} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setWarningConfig((current) => ({ ...current, powerSaveStationaryMinutes: event.target.valueAsNumber }))} onBlur={() => setWarningConfig((current) => sanitizeWarningConfig(current))} /><b>min</b></span>
                    </label>
                    <label className="setting-row setting-row-with-hint" htmlFor="power-anchor-radius">
                      <span><strong>{copy.energyAnchorRadius}</strong><small>{copy.energyAnchorRadiusHint}</small></span>
                      <span className="number-field"><input id="power-anchor-radius" type="number" inputMode="numeric" min="10" max="200" step="5" value={warningConfig.powerSaveAnchorRadiusMetres} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setWarningConfig((current) => ({ ...current, powerSaveAnchorRadiusMetres: event.target.valueAsNumber }))} onBlur={() => setWarningConfig((current) => sanitizeWarningConfig(current))} /><b>m</b></span>
                    </label>
                  </>
                )}
                <div className="preset-row">
                  <p>{copy.croatiaRule}</p>
                  <button type="button" onClick={() => setWarningConfig((current) => ({ ...current, distanceMetres: CROATIA_WARNING_CONFIG.distanceMetres, speedWarningEnabled: CROATIA_WARNING_CONFIG.speedWarningEnabled, maxSpeedKnots: CROATIA_WARNING_CONFIG.maxSpeedKnots }))}>{copy.croatiaPreset}</button>
                </div>
              </div>
            </details>
            <div className="launch-actions">
              <button className="primary-button" disabled={!pack} onClick={startLive}>{copy.startLive}</button>
              <button className="secondary-button" disabled={!pack} onClick={startDemo}>{copy.demo}</button>
            </div>
            <p className="fine-print">{copy.finePrint}</p>
          </section>
        </>
      ) : (
        <section className="tracker" data-alarm-count={alarmPlayCount} data-alarm-playback={alarmPlayback}>
          <div className="tracker-head">
            <span className="trip-mode-group">
              <span className="trip-mode">{mode === "live" ? copy.live : `${copy.demo} ${demoIndex + 1}/${DEMO_DISTANCE_FACTORS.length}`}</span>
              {sunlightActive && <span className="sunlight-badge">☀ {copy.sunlightActive}</span>}
            </span>
            <button className="text-button" onClick={stopTracking}>{copy.end}</button>
          </div>

          <div className="tracker-content">
          <section hidden={trackerTab !== "distance"} style={{ "--distance-scale": warningConfig.distanceTextScalePercent / 100 } as CSSProperties} className={`instrument ${insideLimit && gpsReliable ? "inside-limit" : ""} ${activeSpeedViolation ? "speed-danger" : ""} ${gpsNavigationProblem ? `gps-${gpsNavigationState}` : ""} course-${courseRisk.level}`} aria-label={copy.nearestShore}>
            <div className={`status-pill ${gpsNavigationState === "lost" || (gpsReliable && (insideLimit || activeSpeedViolation)) ? "danger" : ""} ${gpsNavigationState === "stale" || gpsNavigationState === "inaccurate" ? "stale" : ""} ${gpsNavigationState === "waiting" || (!nearest && gpsReliable) ? "waiting" : ""}`} aria-live="assertive">
              <span />{statusLabel}
            </div>
            <div className={`sound-state ${alarmPlayback === "blocked" ? "blocked" : ""} ${warningSoundMuted ? "muted" : ""}`}>
              <span />{alarmLabel}
            </div>

            {visualSignal && (
              <div key={visualSignal.sequence} className={`visual-signal ${visualSignal.kind}`} role="status" aria-live={visualSignal.kind === "safe" ? "polite" : "assertive"}>
                <span className="visual-signal-card"><strong>{visualSignalCopy.title}</strong><small>{visualSignalCopy.detail}</small></span>
              </div>
            )}

            <div className="distance-readout">
              <span>{copy.nearestShore}</span>
              <strong className={!nearest ? "placeholder" : ""}>{formatDistance(nearest?.distance ?? null, language)}</strong>
              <small>{gpsSignalProblem && nearest ? `${copy.lastKnown} · ${distanceUnit}` : nearest ? distanceUnit : copy.acquiring}</small>
              <div className={`go-no-go ${goNoGoState}`} role="status" aria-live="polite">
                <span aria-hidden="true">{goNoGoState === "go" ? "✓" : goNoGoState === "no-go" ? "×" : "?"}</span>
                <b>{goNoGoState === "go" ? copy.go : goNoGoState === "no-go" ? copy.noGo : copy.goUnknown}</b>
              </div>
            </div>

            <ProximityPlot
              pack={pack}
              fix={fix}
              nearest={nearest}
              segments={nearbySegments}
              courseToShore={courseToShore}
              courseRisk={courseRisk}
              rangeMetres={viewRangeMetres}
              warningDistanceMetres={warningConfig.distanceMetres}
              language={language}
            />

            <div className="instrument-footer">
              {gpsSignalProblem || gpsNavigationState === "inaccurate" ? (
                <div className={`course-alert gps-alert ${gpsNavigationState}`} aria-live="assertive">
                  <span className="course-symbol">!</span>
                  <span><strong>{gpsNavigationState === "lost" ? copy.gpsLost : gpsNavigationState === "stale" ? copy.gpsStale : copy.weakGps}</strong><small>{gpsNavigationDetail}</small></span>
                </div>
              ) : activeSpeedViolation ? (
                <div className="course-alert danger speed-alert" aria-live="assertive">
                  <span className="course-symbol">↓</span>
                  <span><strong>{copy.speedDanger}</strong><small>{copy.speedDangerDetail(speedKnots?.toFixed(1) ?? "—", warningConfig.maxSpeedKnots.toFixed(1), warningConfig.distanceMetres)}</small></span>
                </div>
              ) : courseRisk.level !== "none" ? (
                <div className={`course-alert ${courseRisk.level}`} aria-live="assertive">
                  <span className="course-symbol">↗</span>
                  <span><strong>{courseRisk.label}</strong><small>{courseRisk.detail}</small></span>
                </div>
              ) : (
                <div className="instrument-meta">
                  <span><strong>{speedKnots === null ? "—" : speedKnots.toFixed(1)}</strong> kn</span>
                  <span><strong>{fix ? `±${Math.round(fix.accuracy)}` : "—"}</strong> m GPS</span>
                  <span className={`closing-rate ${closingTrend}`} aria-label={copy.closingRate(closingTrend, closingMetresPerMinute)} title={copy.closing}><strong>{closingDisplay}</strong> m/min</span>
                </div>
              )}
            </div>
          </section>

          <div hidden={trackerTab !== "route"} className="route-tab-panel">
            <RoutePlanner
              pack={pack}
              fix={fix}
              warningConfig={warningConfig}
              language={language}
              gpsNavigationState={gpsNavigationState}
            />
          </div>
          </div>

          {(trackingError || alarmError) && <div className="compact-error">{trackingError || alarmError}</div>}

          <nav className="tracker-tabs" aria-label={language === "de" ? "Ansicht" : "View"}>
            <button type="button" className={trackerTab === "distance" ? "active" : ""} aria-current={trackerTab === "distance" ? "page" : undefined} onClick={() => { setTrackerTab("distance"); setPowerSaveWakeUntil(Date.now() + 30_000); }}><span aria-hidden="true">◎</span>{copy.distanceTab}</button>
            <button type="button" className={trackerTab === "route" ? "active" : ""} aria-current={trackerTab === "route" ? "page" : undefined} onClick={() => { setTrackerTab("route"); setPowerSaveWakeUntil(Date.now() + 30_000); }}><span aria-hidden="true">↗</span>{copy.routeTab}</button>
          </nav>

          {mode === "demo" && trackerTab === "distance" && (
            <div className="tracker-actions">
              <button className="sound-button" onClick={testWarningOutputs}>
                <SoundIcon />
                <span><strong>{copy.testAlarm}</strong><small>{warningSoundMuted ? copy.muted : `${warningConfig.alertVolumePercent}%`}</small></span>
              </button>
              <button className="next-button" onClick={advanceDemo}>{copy.nextPosition}</button>
            </div>
          )}
        </section>
      )}

      {powerSaveReason && (
        <button className="power-save-screen" type="button" onClick={wakePowerDisplay} aria-label={copy.tapToWake}>
          <span className="power-save-mode">{copy.powerSavingActive}</span>
          <span className="power-save-go"><i aria-hidden="true">✓</i> {copy.go}</span>
          <strong>{formatDistance(nearest?.distance ?? null, language)}</strong>
          <small>{distanceUnit}</small>
          <em>{powerSaveReason === "far-shore" ? copy.powerFar : copy.powerStationary}</em>
          <span className="power-save-wake">{copy.tapToWake}</span>
        </button>
      )}
    </main>
  );
}
