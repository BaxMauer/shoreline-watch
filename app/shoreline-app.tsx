"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  type CoastlinePack,
  type NearestShore,
  type ShorelineSegment,
  findNearestShore,
  getNearbyShorelineSegments,
  offsetFromShore,
} from "../lib/shoreline";

type Mode = "idle" | "live" | "demo";
type AlarmPlayback = "idle" | "ready" | "starting" | "playing" | "blocked";
type Fix = {
  longitude: number;
  latitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
};

type Status = {
  label: string;
  level: "safe" | "warning" | "danger";
};

const SHORELINE_ALARM_METRES = 300;
const DEMO_DISTANCES = [420, 315, 285, 245, 320, 285];
const DEMO_SPEEDS = [12.2, 10.1, 7.8, 6.4, 8.2, 7.5];
const DEMO_ANCHOR = { longitude: 15.55, latitude: 43.803 };

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

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 5 15-5-3-5 3 5-15Z" fill="currentColor" />
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

function statusFor(distance: number | null, accuracy: number): Status {
  if (distance === null) return { label: "Waiting for position", level: "warning" };
  if (accuracy > 50) return { label: "GPS accuracy is weak", level: "warning" };
  const conservativeDistance = Math.max(0, distance - accuracy);
  if (conservativeDistance < SHORELINE_ALARM_METRES) return { label: "Inside 300 m shoreline mark", level: "danger" };
  return { label: "Outside 300 m shoreline mark", level: "safe" };
}

function formatDistance(distance: number | null) {
  if (distance === null) return "—";
  if (distance < 1_000) return Math.round(distance).toLocaleString("en-US");
  return (distance / 1_000).toFixed(distance < 10_000 ? 2 : 1);
}

function ShorelineView({
  fix,
  nearest,
  segments,
  rangeMetres,
}: {
  fix: Fix | null;
  nearest: NearestShore | null;
  segments: ShorelineSegment[];
  rangeMetres: number;
}) {
  const width = 360;
  const height = 220;
  const centreX = width / 2;
  const centreY = height / 2;
  const pixelsPerMetre = Math.min((width - 32) / (rangeMetres * 2), (height - 32) / (rangeMetres * 2));
  const metresPerLongitudeDegree = fix ? 111_320 * Math.cos((fix.latitude * Math.PI) / 180) : 1;
  const metresPerLatitudeDegree = 110_540;

  const point = (longitude: number, latitude: number) => ({
    x: centreX + (longitude - (fix?.longitude ?? 0)) * metresPerLongitudeDegree * pixelsPerMetre,
    y: centreY - (latitude - (fix?.latitude ?? 0)) * metresPerLatitudeDegree * pixelsPerMetre,
  });

  const nearestPoint = nearest ? point(nearest.longitude, nearest.latitude) : null;
  const rangeLabel = rangeMetres < 1_000
    ? `${Math.round(rangeMetres)} m radius`
    : `${(rangeMetres / 1_000).toFixed(1)} km radius`;

  return (
    <section className="shoreline-card" aria-label="Nearest shoreline diagram">
      <div className="shoreline-card-head">
        <div><span>Local shoreline</span><strong>Boat to nearest point</strong></div>
        <span className="view-range">{rangeLabel}</span>
      </div>
      <svg className="shoreline-view" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={nearest ? `Diagram showing the nearest shoreline ${Math.round(nearest.distance)} metres away` : "Waiting for a shoreline position"}>
        <defs>
          <radialGradient id="waterGlow">
            <stop offset="0" stopColor="#123c46" />
            <stop offset="1" stopColor="#071b22" />
          </radialGradient>
          <filter id="nearestGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width={width} height={height} rx="9" fill="url(#waterGlow)" />
        <path className="view-grid" d={`M${centreX} 0V${height}M0 ${centreY}H${width}`} />
        {fix && segments.map((segment, index) => {
          const start = point(segment[0], segment[1]);
          const end = point(segment[2], segment[3]);
          return <line className="shore-segment" key={`${segment.join(":")}:${index}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
        })}
        {fix && (
          <circle
            className="limit-ring"
            cx={centreX}
            cy={centreY}
            r={SHORELINE_ALARM_METRES * pixelsPerMetre}
          />
        )}
        {nearestPoint && (
          <>
            <line className="nearest-line" x1={centreX} y1={centreY} x2={nearestPoint.x} y2={nearestPoint.y} />
            <circle className="nearest-halo" cx={nearestPoint.x} cy={nearestPoint.y} r="9" />
            <circle className="nearest-point" cx={nearestPoint.x} cy={nearestPoint.y} r="4.5" filter="url(#nearestGlow)" />
          </>
        )}
        {fix ? (
          <g className="map-boat" transform={`translate(${centreX} ${centreY}) rotate(${fix.heading ?? 0})`}>
            <path d="M0-13 8 9 0 6-8 9Z" />
            <circle cx="0" cy="0" r="2.5" />
          </g>
        ) : <text className="map-placeholder" x={centreX} y={centreY}>ACQUIRING GPS</text>}
        <text className="north-label" x={width - 20} y="22">N</text>
        <text className="ring-label" x={centreX + 5} y={centreY - SHORELINE_ALARM_METRES * pixelsPerMetre - 5}>300 m</text>
      </svg>
      <div className="shoreline-legend">
        <span><i className="legend-dot nearest" />Nearest shoreline</span>
        <span><i className="legend-line" />300 m alarm ring</span>
      </div>
    </section>
  );
}

export default function ShorelineApp() {
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
  const [lastAlarmReason, setLastAlarmReason] = useState("No alarm played yet");
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const alarmAudio = useRef<HTMLAudioElement | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const previousInside300 = useRef<boolean | null>(null);

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

  const viewRangeMetres = nearest ? Math.min(6_000, Math.max(450, nearest.distance * 1.25 + 50)) : 450;
  const nearbySegments = useMemo(() => {
    if (!pack || !fix) return [];
    return getNearbyShorelineSegments(pack, fix.longitude, fix.latitude, viewRangeMetres * 1.1);
  }, [fix, pack, viewRangeMetres]);

  const speedKnots = fix?.speed == null ? null : fix.speed * 1.943844;
  const status = statusFor(nearest?.distance ?? null, fix?.accuracy ?? 0);
  const conservativeDistance = nearest && fix ? Math.max(0, nearest.distance - fix.accuracy) : null;
  const inside300 = conservativeDistance !== null && conservativeDistance < SHORELINE_ALARM_METRES;
  const relativeBearing = nearest ? nearest.bearing - (fix?.heading ?? 0) : 0;

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
      setAlarmError("Audio is blocked. Turn up media volume, then tap the large Test 300 m alarm button.");
      return false;
    }
  }, []);

  const soundAlarm = useCallback(async (reason: string) => {
    const audio = alarmAudio.current;
    if (!audio) {
      setAlarmError("The alarm recording did not load. Refresh the app and try again.");
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
      setLastAlarmReason(reason);
      if ("vibrate" in navigator) navigator.vibrate([260, 140, 260, 140, 520]);
      return true;
    } catch {
      const fallbackWorked = await soundWebAudioFallback();
      if (fallbackWorked) {
        setAlarmArmed(true);
        setAlarmError(null);
        setAlarmPlayback("playing");
        setAlarmPlayCount((count) => count + 1);
        setLastAlarmReason(`${reason} · fallback tone`);
        return true;
      }
      setAlarmArmed(false);
      setAlarmPlayback("blocked");
      setAlarmError("The browser blocked sound. Keep this page visible, turn up media volume, and tap Test 300 m alarm again.");
      return false;
    }
  }, [soundWebAudioFallback]);

  useEffect(() => {
    if (mode === "idle" || conservativeDistance === null) return;
    const wasInside = previousInside300.current;
    if (inside300 && wasInside !== true) void soundAlarm("Automatic 300 m crossing");
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
      setTrackingError("This browser does not provide live location.");
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
          1: "Location access was denied. Allow precise location and try again.",
          2: "The phone cannot determine its current location.",
          3: "The GPS fix timed out. Keep the app visible and try again.",
        };
        setTrackingError(messages[error.code] ?? "Live location is unavailable.");
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );
  }, [pack, primeAlarm, requestWakeLock]);

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
      heading: (anchorShore.bearing + 360) % 360,
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

  const testAlarm = useCallback(() => {
    void soundAlarm("Manual test button");
  }, [soundAlarm]);

  const advanceDemo = useCallback(() => {
    const next = (demoIndex + 1) % DEMO_DISTANCES.length;
    setDemoIndex(next);
    setDemoFix(next);
  }, [demoIndex, setDemoFix]);

  const generatedDate = pack ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(pack.generatedAt)) : null;
  const distanceUnit = nearest && nearest.distance >= 1_000 ? "kilometres" : "metres";
  const playbackLabel = alarmPlayback === "playing" || alarmPlayback === "starting"
    ? "Sound playing"
    : alarmPlayback === "blocked"
      ? "Sound blocked"
      : alarmArmed
        ? "Sound ready"
        : "Not armed";

  return (
    <main className="app-shell">
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
          setAlarmError("The alarm recording could not be loaded. Refresh the app and try again.");
        }}
      />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><BoatIcon /></span>
          <span>Shoreline Watch</span>
        </div>
        <div className="connection" aria-live="polite">
          <span className={`connection-dot ${online ? "" : "offline"}`} />
          {online ? "Online" : "Offline mode"}
        </div>
      </header>

      {mode === "idle" ? (
        <>
          <section className="intro">
            <div>
              <p className="eyebrow">Croatian coast · live GPS</p>
              <h1>Know your margin.</h1>
            </div>
            <p className="intro-copy">
              See your nearest shoreline distance and get an audible alert when you cross the 300 metre mark—even when mobile coverage drops away.
            </p>
          </section>

          <section className="launch-panel" aria-label="Trip readiness">
            <div className="data-row">
              <div>
                <span className="data-label">Croatia coastline pack</span>
                <span className="data-detail">HHI source · {pack?.segmentCount.toLocaleString("en-US") ?? "—"} indexed segments</span>
              </div>
              <span className="data-state">{packError ? "FAILED" : pack ? "READY" : "LOADING"}</span>
            </div>
            <div className="data-row">
              <div>
                <span className="data-label">Offline calculation</span>
                <span className="data-detail">GPS, shoreline view and alarm stay on this device</span>
              </div>
              <span className="data-state">LOCAL</span>
            </div>

            <div className="launch-actions">
              <button className="primary-button" disabled={!pack} onClick={startLive}>Start live</button>
              <button className="secondary-button" disabled={!pack} onClick={startDemo}>Try demo</button>
            </div>
            {packError && <div className="error-box">{packError}</div>}
            <p className="fine-print">
              Starting live or demo plays a brief ready chirp. Prototype aid only—not a navigation chart. Keep an approved chart and normal lookout.
            </p>
          </section>
        </>
      ) : (
        <section className="tracker" data-alarm-count={alarmPlayCount} data-alarm-playback={alarmPlayback}>
          <div className="tracker-head">
            <span className="trip-mode">{mode === "live" ? "Live tracking" : `Murter demo · ${demoIndex + 1}/${DEMO_DISTANCES.length}`}</span>
            <button className="text-button" onClick={stopTracking}>End trip</button>
          </div>

          <div className={`status-band ${status.level === "safe" ? "" : status.level}`} aria-live="assertive">
            <span>{status.level === "danger" ? "300 m alarm" : "300 m monitor"}</span>
            <strong>{status.label}</strong>
          </div>

          <div className="distance-stage">
            <div>
              <div className="distance-label">Nearest shoreline</div>
              <div className={`distance-value ${nearest ? "" : "placeholder"}`}>{formatDistance(nearest?.distance ?? null)}</div>
              <div className="distance-unit">{nearest ? distanceUnit : "acquiring GPS"}</div>
              <div className="bearing-arrow" style={{ transform: `rotate(${relativeBearing}deg)` }} aria-label={nearest ? `Shoreline bearing ${Math.round(nearest.bearing)} degrees` : "Bearing unavailable"}>
                <ArrowIcon />
              </div>
            </div>
          </div>

          <ShorelineView fix={fix} nearest={nearest} segments={nearbySegments} rangeMetres={viewRangeMetres} />

          <div className="metrics">
            <div className="metric"><span className="metric-value">{speedKnots === null ? "—" : speedKnots.toFixed(1)}</span><span className="metric-label">Speed · kn</span></div>
            <div className="metric"><span className="metric-value">{fix ? `±${Math.round(fix.accuracy)} m` : "—"}</span><span className="metric-label">GPS accuracy</span></div>
            <div className="metric"><span className="metric-value">{nearest ? `${Math.round(nearest.bearing)}°` : "—"}</span><span className="metric-label">Shore bearing</span></div>
          </div>

          <div className="control-panel">
            <div className="alarm-panel">
              <div className="alarm-panel-head">
                <div><span className="alarm-kicker">Audible warning</span><strong>300 m shoreline alarm</strong></div>
                <span className={`alarm-state ${alarmArmed ? "armed" : ""}`}>{playbackLabel}</span>
              </div>
              <button className="alarm-test-button" onClick={testAlarm}>
                <span>▶</span> Test 300 m alarm
              </button>
              <div className="alarm-receipt" aria-live="polite">
                <span>{lastAlarmReason}</span>
                <strong>{alarmPlayCount} full {alarmPlayCount === 1 ? "play" : "plays"} this trip</strong>
              </div>
            </div>
            {mode === "demo" && <div className="demo-control"><button className="secondary-button" onClick={advanceDemo}>Advance demo position</button></div>}
            {trackingError && <div className="error-box">{trackingError}</div>}
            {alarmError && <div className="error-box">{alarmError}</div>}
            <p className="fine-print">
              Coastline pack: HHI · {generatedDate ?? "loading"}. The 300 m crossing uses measured distance minus reported GPS accuracy. Keep media volume up and the app visible.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
