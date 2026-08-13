"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  type CoastlinePack,
  type NearestShore,
  findNearestShore,
  offsetFromShore,
} from "../lib/shoreline";

type Mode = "idle" | "live" | "demo";
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

function scheduleTone(
  context: AudioContext,
  start: number,
  duration: number,
  frequency: number,
  volume: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.setValueAtTime(volume, start + duration - 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
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
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const previousInside300 = useRef<boolean | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    fetch("/data/croatia-coastline.json")
      .then((response) => {
        if (!response.ok) throw new Error("Coastline pack could not be loaded.");
        return response.json() as Promise<CoastlinePack>;
      })
      .then((data) => setPack(data))
      .catch((error: unknown) => setPackError(error instanceof Error ? error.message : "Coastline pack could not be loaded."));

  }, []);

  const nearest = useMemo<NearestShore | null>(() => {
    if (!pack || !fix) return null;
    return findNearestShore(pack, fix.longitude, fix.latitude);
  }, [pack, fix]);

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

  const armAlarm = useCallback(async (playReadyChirp = true) => {
    const context = getAudioContext();
    if (!context) {
      setAlarmError("This browser does not provide Web Audio alarms.");
      return false;
    }

    try {
      if (context.state === "suspended") await context.resume();
      if (context.state !== "running") throw new Error("Audio did not start");
      setAlarmArmed(true);
      setAlarmError(null);
      if (playReadyChirp) scheduleTone(context, context.currentTime + 0.02, 0.12, 660, 0.12);
      return true;
    } catch {
      setAlarmArmed(false);
      setAlarmError("Audio is blocked. Turn up media volume, then tap Test alarm.");
      return false;
    }
  }, [getAudioContext]);

  const soundAlarm = useCallback(async () => {
    const context = getAudioContext();
    if (!context) {
      setAlarmError("This browser does not provide Web Audio alarms.");
      return;
    }

    try {
      if (context.state === "suspended") await context.resume();
      if (context.state !== "running") throw new Error("Audio did not start");
      const start = context.currentTime + 0.03;
      scheduleTone(context, start, 0.32, 880, 0.3);
      scheduleTone(context, start + 0.48, 0.32, 880, 0.3);
      scheduleTone(context, start + 0.96, 0.48, 1040, 0.34);
      setAlarmArmed(true);
      setAlarmError(null);
      if ("vibrate" in navigator) navigator.vibrate([220, 150, 220, 150, 350]);
    } catch {
      setAlarmArmed(false);
      setAlarmError("Audio was suspended. Keep the app visible and tap Test alarm to re-arm it.");
    }
  }, [getAudioContext]);

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
    setFix(null);
    setTrackingError(null);
    setAlarmError(null);
    setMode("idle");
    setDemoIndex(0);
    previousInside300.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopTracking();
      audioContext.current?.close().catch(() => undefined);
    };
  }, [stopTracking]);

  const startLive = useCallback(async () => {
    if (!pack || !navigator.geolocation) return;
    await armAlarm();
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
  }, [armAlarm, pack, requestWakeLock]);

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

  const startDemo = useCallback(async () => {
    await armAlarm();
    previousInside300.current = null;
    setMode("demo");
    setTrackingError(null);
    setDemoIndex(0);
    setDemoFix(0);
  }, [armAlarm, setDemoFix]);

  const testAlarm = useCallback(async () => {
    const armed = await armAlarm(false);
    if (armed) await soundAlarm();
  }, [armAlarm, soundAlarm]);

  const advanceDemo = useCallback(() => {
    const next = (demoIndex + 1) % DEMO_DISTANCES.length;
    setDemoIndex(next);
    setDemoFix(next);
  }, [demoIndex, setDemoFix]);

  const generatedDate = pack ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(pack.generatedAt)) : null;
  const distanceUnit = nearest && nearest.distance >= 1_000 ? "kilometres" : "metres";

  return (
    <main className="app-shell">
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
                <span className="data-detail">GPS positions stay on this device</span>
              </div>
              <span className="data-state">LOCAL</span>
            </div>

            <div className="launch-actions">
              <button className="primary-button" disabled={!pack} onClick={startLive}>Start live</button>
              <button className="secondary-button" disabled={!pack} onClick={startDemo}>Try demo</button>
            </div>
            {packError && <div className="error-box">{packError}</div>}
            <p className="fine-print">
              Prototype aid only—not a navigation chart. Keep an approved chart and normal lookout. Regulatory exceptions are not inferred.
            </p>
          </section>
        </>
      ) : (
        <section className="tracker">
          <div className="tracker-head">
            <span className="trip-mode">{mode === "live" ? "Live tracking" : `Murter demo · ${demoIndex + 1}/${DEMO_DISTANCES.length}`}</span>
            <button className="text-button" onClick={stopTracking}>End trip</button>
          </div>

          <div className={`status-band ${status.level === "safe" ? "" : status.level}`}>{status.label}</div>

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

          <div className="metrics">
            <div className="metric"><span className="metric-value">{speedKnots === null ? "—" : speedKnots.toFixed(1)}</span><span className="metric-label">Speed · kn</span></div>
            <div className="metric"><span className="metric-value">{fix ? `±${Math.round(fix.accuracy)} m` : "—"}</span><span className="metric-label">GPS accuracy</span></div>
            <div className="metric"><span className="metric-value">{nearest ? `${Math.round(nearest.bearing)}°` : "—"}</span><span className="metric-label">Shore bearing</span></div>
          </div>

          <div className="control-panel">
            <div className="control-row">
              <div className="control-copy"><strong>300 m shoreline alarm</strong><span>A short chirp confirms it is armed</span></div>
              <span className={`alarm-state ${alarmArmed ? "armed" : ""}`}>{alarmArmed ? "Armed" : "Not armed"}</span>
            </div>
            <div className="control-row">
              <div className="control-copy"><strong>Audible warning</strong><span>Three beeps at the 300 m crossing</span></div>
              <button className="icon-button" onClick={testAlarm}>Test alarm</button>
            </div>
            {mode === "demo" && <div className="demo-control"><button className="secondary-button" onClick={advanceDemo}>Advance demo position</button></div>}
            {trackingError && <div className="error-box">{trackingError}</div>}
            {alarmError && <div className="error-box">{alarmError}</div>}
            <p className="fine-print">
              Coastline pack: HHI · {generatedDate ?? "loading"}. The 300 m crossing uses measured distance minus reported GPS accuracy.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
