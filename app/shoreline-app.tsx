"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  type CoastlinePack,
  type NearestShore,
  findNearestShore,
  offsetFromShore,
} from "../lib/shoreline";

type Mode = "idle" | "live" | "demo";
type VesselClass = "small" | "medium" | "large";
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

const LIMITS: Record<VesselClass, number> = {
  small: 50,
  medium: 150,
  large: 300,
};

const DEMO_DISTANCES = [420, 315, 275, 145, 78, 48, 66, 108];
const DEMO_SPEEDS = [12.2, 11.4, 10.6, 8.7, 6.2, 3.8, 4.1, 5.2];
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

function playTone(level: "warning" | "danger" = "warning") {
  const AudioContextClass = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = level === "danger" ? "square" : "sine";
  oscillator.frequency.value = level === "danger" ? 880 : 620;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (level === "danger" ? 0.48 : 0.24));
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.5);
  oscillator.addEventListener("ended", () => context.close());
}

function statusFor(distance: number | null, accuracy: number, speedKnots: number | null, limit: number): Status {
  if (distance === null) return { label: "Waiting for position", level: "warning" };
  if (accuracy > 50) return { label: "GPS accuracy is weak", level: "warning" };
  const conservativeDistance = Math.max(0, distance - accuracy);
  if (conservativeDistance < limit) return { label: `Inside ${limit} m shoreline limit`, level: "danger" };
  if (conservativeDistance < limit + 30) return { label: "Approaching shoreline limit", level: "warning" };
  if (distance < 300 && speedKnots !== null && speedKnots > 8) return { label: "Reduce speed below 8 kn", level: "danger" };
  if (distance < 300) return { label: "Inside 300 m coastal zone", level: "warning" };
  return { label: "Clear of configured limits", level: "safe" };
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
  const [vesselClass, setVesselClass] = useState<VesselClass>("small");
  const [demoIndex, setDemoIndex] = useState(0);
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const previousLevel = useRef<Status["level"]>("safe");

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
  const limit = LIMITS[vesselClass];
  const status = statusFor(nearest?.distance ?? null, fix?.accuracy ?? 0, speedKnots, limit);
  const relativeBearing = nearest ? nearest.bearing - (fix?.heading ?? 0) : 0;

  useEffect(() => {
    if (mode !== "idle" && status.level !== previousLevel.current && status.level !== "safe") {
      playTone(status.level);
      if ("vibrate" in navigator) navigator.vibrate(status.level === "danger" ? [180, 100, 180] : 120);
    }
    previousLevel.current = status.level;
  }, [mode, status.level]);

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
    setMode("idle");
    setDemoIndex(0);
    previousLevel.current = "safe";
  }, []);

  useEffect(() => stopTracking, [stopTracking]);

  const startLive = useCallback(async () => {
    if (!pack || !navigator.geolocation) return;
    playTone("warning");
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
  }, [pack, requestWakeLock]);

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
    playTone("warning");
    setMode("demo");
    setTrackingError(null);
    setDemoIndex(0);
    setDemoFix(0);
  }, [setDemoFix]);

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
              See your nearest shoreline distance, speed zone and GPS margin—even when mobile coverage drops away.
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
              <div className="control-copy"><strong>Vessel category</strong><span>Sets a {limit} m shoreline warning</span></div>
              <select className="vessel-select" value={vesselClass} onChange={(event) => setVesselClass(event.target.value as VesselClass)} aria-label="Vessel category">
                <option value="small">Under 15 m</option>
                <option value="medium">15–30 m</option>
                <option value="large">30 m+</option>
              </select>
            </div>
            <div className="control-row">
              <div className="control-copy"><strong>Audible warning</strong><span>Test the current alarm volume</span></div>
              <button className="icon-button" onClick={() => playTone("danger")}>Test alarm</button>
            </div>
            {mode === "demo" && <div className="demo-control"><button className="secondary-button" onClick={advanceDemo}>Advance demo position</button></div>}
            {trackingError && <div className="error-box">{trackingError}</div>}
            <p className="fine-print">
              Coastline pack: HHI · {generatedDate ?? "loading"}. Warning distance uses measured distance minus reported GPS accuracy.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
