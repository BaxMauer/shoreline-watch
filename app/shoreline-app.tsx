"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  type CoastlinePack,
  type CourseToShore,
  type NearestShore,
  type ShorelineSegment,
  distanceToSegment,
  findCourseToShore,
  findNearestShore,
  getNearbyShorelineSegments,
  offsetFromShore,
} from "../lib/shoreline";

type Mode = "idle" | "live" | "demo";
type AlarmPlayback = "idle" | "ready" | "starting" | "playing" | "blocked";
type RiskLevel = "none" | "warning" | "danger";
type Language = "de" | "en";
type Theme = "ocean" | "xp" | "dark" | "nautical";
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

const SHORELINE_ALARM_METRES = 300;
const DEMO_DISTANCES = [420, 315, 285, 245, 320, 285];
const DEMO_SPEEDS = [12.2, 10.1, 7.8, 6.4, 8.2, 7.5];
const DEMO_ANCHOR = { longitude: 15.55, latitude: 43.803 };

const COPY = {
  de: {
    online: "Online",
    offline: "Offline",
    eyebrow: "Kroatische Küste · Live-GPS",
    heroTitle: "Abstand im Blick.",
    intro: "Nächste Küste, ein 300-m-Alarm, vollständig offline verfügbar.",
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
    live: "Live",
    end: "Beenden",
    waitingGps: "Warte auf GPS",
    weakGps: "GPS ungenau",
    inside300: "Unter 300 m",
    clear300: "300 m frei",
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
    courseWarning: "300-m-Grenze auf aktuellem Kurs",
    courseWarningDetail: (eta: string) => `${eta} bei aktueller Geschwindigkeit`,
    seconds: "Sek.",
    minutes: "Min.",
    shore: "Küste",
    testAlarm: "Alarm testen",
    nextPosition: "Nächste Position",
    soundBlocked: "Ton blockiert — Medienlautstärke erhöhen und Tracking neu starten.",
    soundMissing: "Alarmton konnte nicht geladen werden — App neu öffnen.",
    locationUnavailable: "Live-Standort ist in diesem Browser nicht verfügbar.",
    locationDenied: "Genaue Standortfreigabe erlauben und erneut versuchen.",
    locationUnknown: "Das Smartphone kann den Standort nicht bestimmen.",
    locationTimeout: "GPS-Zeitüberschreitung — App sichtbar lassen.",
  },
  en: {
    online: "Online",
    offline: "Offline",
    eyebrow: "Croatian coast · live GPS",
    heroTitle: "Know your margin.",
    intro: "Nearest shoreline, one 300 m alarm, fully available offline.",
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
    live: "Live",
    end: "End",
    waitingGps: "Waiting for GPS",
    weakGps: "Low GPS accuracy",
    inside300: "Inside 300 m",
    clear300: "300 m clear",
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
    courseWarning: "300 m mark on current course",
    courseWarningDetail: (eta: string) => `${eta} at current speed`,
    seconds: "sec",
    minutes: "min",
    shore: "shore",
    testAlarm: "Test alarm",
    nextPosition: "Next position",
    soundBlocked: "Sound blocked — raise media volume, then restart tracking.",
    soundMissing: "Alarm sound did not load — reopen the app.",
    locationUnavailable: "Live location is not available in this browser.",
    locationDenied: "Allow precise location and try again.",
    locationUnknown: "The phone cannot determine its location.",
    locationTimeout: "GPS timed out — keep the app visible.",
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

function scheduleTone(context: AudioContext, start: number, frequency: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.32, start + 0.025);
  gain.gain.setValueAtTime(0.32, start + 0.27);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.35);
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
  fix,
  nearest,
  segments,
  courseToShore,
  courseRisk,
  rangeMetres,
  language,
}: {
  fix: Fix | null;
  nearest: NearestShore | null;
  segments: ShorelineSegment[];
  courseToShore: CourseToShore | null;
  courseRisk: CourseRisk;
  rangeMetres: number;
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
  const ringRadius = SHORELINE_ALARM_METRES * pixelsPerMetre;
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
        if (Math.hypot(east, north) > SHORELINE_ALARM_METRES) continue;
        const bearing = (Math.atan2(east, north) * 180) / Math.PI;
        const sector = Math.floor((((bearing + 360) % 360) / 5));
        sectors.add(sector);
        sectors.add((sector + 71) % 72);
        sectors.add((sector + 1) % 72);
      }
    }

    return Array.from(sectors).sort((left, right) => left - right);
  }, [fix, metresPerLatitudeDegree, segments]);

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
      </defs>
      <circle cx={centre} cy={centre} r="166" fill="url(#plotGlow)" />

      <g className="coast-layer">
        {fix && segments.map((segment, index) => {
          const start = point(segment[0], segment[1]);
          const end = point(segment[2], segment[3]);
          const close = distanceToSegment(fix.longitude, fix.latitude, segment).distance < SHORELINE_ALARM_METRES;
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
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [pack, setPack] = useState<CoastlinePack | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [fix, setFix] = useState<Fix | null>(null);
  const [demoIndex, setDemoIndex] = useState(0);
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [alarmError, setAlarmError] = useState<string | null>(null);
  const [alarmArmed, setAlarmArmed] = useState(false);
  const [alarmPlayback, setAlarmPlayback] = useState<AlarmPlayback>("idle");
  const [alarmPlayCount, setAlarmPlayCount] = useState(0);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const alarmAudio = useRef<HTMLAudioElement | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const previousInside300 = useRef<boolean | null>(null);
  const copy = COPY[language];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedLanguage = window.localStorage.getItem("shoreline-language");
      const savedTheme = window.localStorage.getItem("shoreline-theme");
      if (savedLanguage === "de" || savedLanguage === "en") setLanguage(savedLanguage);
      if (savedTheme === "ocean" || savedTheme === "xp" || savedTheme === "dark" || savedTheme === "nautical") setTheme(savedTheme);
      setPreferencesLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem("shoreline-language", language);
    window.localStorage.setItem("shoreline-theme", theme);
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
  }, [language, preferencesLoaded, theme]);

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

  const viewRangeMetres = nearest ? Math.min(6_000, Math.max(420, nearest.distance * 1.15 + 35)) : 420;
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
  const conservativeDistance = nearest && fix ? Math.max(0, nearest.distance - fix.accuracy) : null;
  const inside300 = conservativeDistance !== null && conservativeDistance < SHORELINE_ALARM_METRES;
  const isUnderway = speedMetresPerSecond >= 0.77;

  const courseRisk = useMemo<CourseRisk>(() => {
    if (!courseToShore || !isUnderway) return { level: "none", label: "", detail: "" };
    const secondsToShore = courseToShore.distance / speedMetresPerSecond;
    const secondsToMark = Math.max(0, (courseToShore.distance - SHORELINE_ALARM_METRES) / speedMetresPerSecond);

    if (inside300 && secondsToShore <= 300) {
      return {
        level: "danger",
        label: copy.courseDanger,
        detail: copy.courseDangerDetail(formatEta(secondsToShore, language)),
      };
    }
    if (!inside300 && secondsToMark <= 180) {
      return {
        level: "warning",
        label: copy.courseWarning,
        detail: copy.courseWarningDetail(formatEta(secondsToMark, language)),
      };
    }
    return { level: "none", label: "", detail: "" };
  }, [copy, courseToShore, inside300, isUnderway, language, speedMetresPerSecond]);

  const getAudioContext = useCallback(() => {
    if (audioContext.current && audioContext.current.state !== "closed") return audioContext.current;
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext.current = new AudioContextClass();
    return audioContext.current;
  }, []);

  const soundWebAudioFallback = useCallback(async () => {
    const context = getAudioContext();
    if (!context) return false;
    try {
      if (context.state === "suspended") await context.resume();
      if (context.state !== "running") return false;
      const start = context.currentTime + 0.02;
      scheduleTone(context, start, 880);
      scheduleTone(context, start + 0.46, 880);
      scheduleTone(context, start + 0.92, 1_040);
      return true;
    } catch {
      return false;
    }
  }, [getAudioContext]);

  const primeAlarm = useCallback(async () => {
    const audio = alarmAudio.current;
    if (!audio) return false;
    try {
      audio.muted = false;
      audio.volume = 1;
      audio.currentTime = 0;
      await audio.play();
      window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        setAlarmPlayback("ready");
      }, 110);
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
  }, [copy.soundBlocked]);

  const soundAlarm = useCallback(async () => {
    const audio = alarmAudio.current;
    if (!audio) {
      setAlarmError(copy.soundMissing);
      return false;
    }
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.volume = 1;
      setAlarmPlayback("starting");
      await audio.play();
      setAlarmArmed(true);
      setAlarmError(null);
      setAlarmPlayback("playing");
      setAlarmPlayCount((count) => count + 1);
      if ("vibrate" in navigator) navigator.vibrate([260, 140, 260, 140, 520]);
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
  }, [copy.soundBlocked, copy.soundMissing, soundWebAudioFallback]);

  useEffect(() => {
    if (mode === "idle" || conservativeDistance === null) return;
    const wasInside = previousInside300.current;
    if (inside300 && wasInside !== true) void soundAlarm();
    previousInside300.current = inside300;
  }, [conservativeDistance, inside300, mode, soundAlarm]);

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
    setMode("idle");
    setDemoIndex(0);
    previousInside300.current = null;
  }, []);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    wakeLock.current?.release().catch(() => undefined);
    audioContext.current?.close().catch(() => undefined);
  }, []);

  const startLive = useCallback(async () => {
    if (!pack || !navigator.geolocation) {
      setTrackingError(copy.locationUnavailable);
      return;
    }
    void primeAlarm();
    previousInside300.current = null;
    setMode("live");
    setTrackingError(null);
    await requestWakeLock();
    navigator.storage?.persist?.().catch(() => false);
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setFix({
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp,
        });
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
  }, [copy, pack, primeAlarm, requestWakeLock]);

  const setDemoFix = useCallback((index: number) => {
    if (!pack) return;
    const anchorShore = findNearestShore(pack, DEMO_ANCHOR.longitude, DEMO_ANCHOR.latitude);
    if (!anchorShore) return;
    const bearingFromShore = (anchorShore.bearing + 180) % 360;
    const point = offsetFromShore(anchorShore, bearingFromShore, DEMO_DISTANCES[index]);
    setFix({
      ...point,
      accuracy: 6,
      speed: DEMO_SPEEDS[index] / 1.943844,
      heading: (anchorShore.bearing + (index === 4 ? 180 : 0)) % 360,
      timestamp: Date.now(),
    });
  }, [pack]);

  const startDemo = useCallback(() => {
    void primeAlarm();
    previousInside300.current = null;
    setMode("demo");
    setTrackingError(null);
    setDemoIndex(0);
    setDemoFix(0);
  }, [primeAlarm, setDemoFix]);

  const advanceDemo = useCallback(() => {
    const next = (demoIndex + 1) % DEMO_DISTANCES.length;
    setDemoIndex(next);
    setDemoFix(next);
  }, [demoIndex, setDemoFix]);

  const distanceUnit = nearest && nearest.distance >= 1_000 ? copy.kilometres : copy.metres;
  const statusLabel = !nearest
    ? copy.waitingGps
    : (fix?.accuracy ?? 0) > 50
      ? copy.weakGps
      : inside300
        ? copy.inside300
        : copy.clear300;
  const alarmLabel = alarmPlayback === "playing" || alarmPlayback === "starting"
    ? copy.playing
    : alarmPlayback === "blocked"
      ? copy.blocked
      : alarmArmed
        ? copy.ready
        : copy.notReady;

  return (
    <main className={`app-shell theme-${theme} ${mode !== "idle" ? "is-tracking" : ""}`}>
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
            <p className="intro-copy">{copy.intro}</p>
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
            <span className="trip-mode">{mode === "live" ? copy.live : `${copy.demo} ${demoIndex + 1}/${DEMO_DISTANCES.length}`}</span>
            <button className="text-button" onClick={stopTracking}>{copy.end}</button>
          </div>

          <section className={`instrument ${inside300 ? "inside-limit" : ""} course-${courseRisk.level}`} aria-label={copy.nearestShore}>
            <div className={`status-pill ${inside300 ? "danger" : ""} ${!nearest ? "waiting" : ""}`} aria-live="assertive">
              <span />{statusLabel}
            </div>
            <div className={`sound-state ${alarmPlayback === "blocked" ? "blocked" : ""}`}>
              <span />{alarmLabel}
            </div>

            <div className="distance-readout">
              <span>{copy.nearestShore}</span>
              <strong className={!nearest ? "placeholder" : ""}>{formatDistance(nearest?.distance ?? null, language)}</strong>
              <small>{nearest ? distanceUnit : copy.acquiring}</small>
            </div>

            <ProximityPlot
              fix={fix}
              nearest={nearest}
              segments={nearbySegments}
              courseToShore={courseToShore}
              courseRisk={courseRisk}
              rangeMetres={viewRangeMetres}
              language={language}
            />

            <div className="instrument-footer">
              {courseRisk.level !== "none" ? (
                <div className={`course-alert ${courseRisk.level}`} aria-live="assertive">
                  <span className="course-symbol">↗</span>
                  <span><strong>{courseRisk.label}</strong><small>{courseRisk.detail}</small></span>
                </div>
              ) : (
                <div className="instrument-meta">
                  <span><strong>{speedKnots === null ? "—" : speedKnots.toFixed(1)}</strong> kn</span>
                  <span><strong>{fix ? `±${Math.round(fix.accuracy)}` : "—"}</strong> m GPS</span>
                  <span><strong>{nearest ? `${Math.round(nearest.bearing)}°` : "—"}</strong> {copy.shore}</span>
                </div>
              )}
            </div>
          </section>

          {(trackingError || alarmError) && <div className="compact-error">{trackingError || alarmError}</div>}

          {mode === "demo" && (
            <div className="tracker-actions">
              <button className="sound-button" onClick={() => void soundAlarm()}>
                <SoundIcon />
                <span><strong>{copy.testAlarm}</strong><small>{alarmLabel}</small></span>
              </button>
              <button className="next-button" onClick={advanceDemo}>{copy.nextPosition}</button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
