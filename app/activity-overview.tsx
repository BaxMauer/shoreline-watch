"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { activityTotals, type ActivityRecord, type TripActivity, type TripDraft } from "../lib/activity-log";
import { buildTripGpx, getMapViewportExtent, getTripTrack, type TripTrackPoint } from "../lib/activity-track";
import type { AnchorWatch } from "../lib/anchor-watch";
import { getLandIntervalsAtLatitude, getNearbyShorelineSegments, type CoastlinePack } from "../lib/shoreline";
import ActivityMiniMap from "./activity-mini-map";

type Props = {
  language: "de" | "en";
  records: ActivityRecord[];
  currentTrip: TripDraft | null;
  currentAnchor: AnchorWatch | null;
  now: number;
  coastline: CoastlinePack | null;
  onBack?: () => void;
  onClear: () => void;
};

function duration(milliseconds: number, language: "de" | "en") {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} ${language === "de" ? "Min." : "min"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function distance(metres: number) {
  return metres >= 1_000 ? `${(metres / 1_000).toFixed(metres >= 10_000 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

const TRACK_MAP_WIDTH = 360;
const TRACK_MAP_HEIGHT = 246;
const MIN_TRACK_RANGE_METRES = 80;
const MAX_TRACK_RANGE_METRES = 50_000;

type TrackMapView = { latitude: number; longitude: number; halfRange: number };

function trackMapScale(halfRange: number) {
  return Math.min(326 / (halfRange * 2), 214 / (halfRange * 2));
}

function clampTrackRange(halfRange: number) {
  return Math.max(MIN_TRACK_RANGE_METRES, Math.min(MAX_TRACK_RANGE_METRES, halfRange));
}

function TrackMap({ points, coastline, language }: { points: TripTrackPoint[]; coastline: CoastlinePack | null; language: "de" | "en" }) {
  const fittedView = useMemo<TrackMapView>(() => {
    if (!points.length) return { latitude: 0, longitude: 0, halfRange: 350 };
    const minLatitude = Math.min(...points.map((point) => point.latitude));
    const maxLatitude = Math.max(...points.map((point) => point.latitude));
    const minLongitude = Math.min(...points.map((point) => point.longitude));
    const maxLongitude = Math.max(...points.map((point) => point.longitude));
    const centre = { latitude: (minLatitude + maxLatitude) / 2, longitude: (minLongitude + maxLongitude) / 2 };
    const longitudeScale = 111_320 * Math.max(.1, Math.cos(centre.latitude * Math.PI / 180));
    const routeWidth = (maxLongitude - minLongitude) * longitudeScale;
    const routeHeight = (maxLatitude - minLatitude) * 110_540;
    return { ...centre, halfRange: clampTrackRange(Math.max(160, routeWidth / 2, routeHeight / 2) * 1.35) };
  }, [points]);
  const [view, setView] = useState(fittedView);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<null | { mode: "pan"; pointerId: number; point: { x: number; y: number }; view: TrackMapView } | { mode: "pinch"; distance: number; view: TrackMapView }>(null);

  const map = useMemo(() => {
    if (!points.length) return null;
    const longitudeScale = 111_320 * Math.max(.1, Math.cos(view.latitude * Math.PI / 180));
    const latitudeScale = 110_540;
    const scale = trackMapScale(view.halfRange);
    const viewport = getMapViewportExtent(TRACK_MAP_WIDTH, TRACK_MAP_HEIGHT, scale, 4)!;
    const project = (longitude: number, latitude: number) => ({
      x: TRACK_MAP_WIDTH / 2 + (longitude - view.longitude) * longitudeScale * scale,
      y: TRACK_MAP_HEIGHT / 2 - (latitude - view.latitude) * latitudeScale * scale,
    });
    const shore = coastline ? getNearbyShorelineSegments(coastline, view.longitude, view.latitude, viewport.radiusMetres * 1.08, 4_000) : [];
    const landBands: Array<{ x: number; y: number; width: number }> = [];
    if (coastline) {
      const west = view.longitude - viewport.halfWidthMetres / longitudeScale;
      const east = view.longitude + viewport.halfWidthMetres / longitudeScale;
      for (let y = -4; y < TRACK_MAP_HEIGHT + 4; y += 4) {
        const scanLatitude = view.latitude + (TRACK_MAP_HEIGHT / 2 - y - 2) / (latitudeScale * scale);
        for (const [landWest, landEast] of getLandIntervalsAtLatitude(coastline, scanLatitude, west, east)) {
          const left = Math.max(0, project(landWest, scanLatitude).x);
          const right = Math.min(TRACK_MAP_WIDTH, project(landEast, scanLatitude).x);
          if (right > left) landBands.push({ x: left, y, width: right - left });
        }
      }
    }
    return { project, shore, landBands, longitudeScale, latitudeScale, scale };
  }, [coastline, points, view]);

  const eventPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rectangle.left) / rectangle.width * TRACK_MAP_WIDTH,
      y: (event.clientY - rectangle.top) / rectangle.height * TRACK_MAP_HEIGHT,
    };
  };
  const startPinch = () => {
    const active = [...pointers.current.values()];
    if (active.length < 2) return;
    gesture.current = { mode: "pinch", distance: Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y), view };
  };
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = eventPoint(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) startPinch();
    else gesture.current = { mode: "pan", pointerId: event.pointerId, point, view };
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = eventPoint(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) {
      if (gesture.current?.mode !== "pinch") startPinch();
      const active = [...pointers.current.values()];
      const currentDistance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y);
      const pinch = gesture.current?.mode === "pinch" ? gesture.current : null;
      if (pinch && currentDistance > 1) setView({ ...pinch.view, halfRange: clampTrackRange(pinch.view.halfRange * pinch.distance / currentDistance) });
      return;
    }
    const pan = gesture.current?.mode === "pan" && gesture.current.pointerId === event.pointerId ? gesture.current : null;
    if (!pan) return;
    const scale = trackMapScale(pan.view.halfRange);
    const longitudeScale = 111_320 * Math.max(.1, Math.cos(pan.view.latitude * Math.PI / 180));
    setView({
      ...pan.view,
      latitude: pan.view.latitude + (point.y - pan.point.y) / (110_540 * scale),
      longitude: pan.view.longitude - (point.x - pan.point.x) / (longitudeScale * scale),
    });
  };
  const handlePointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 1) {
      const [pointerId, point] = [...pointers.current.entries()][0];
      gesture.current = { mode: "pan", pointerId, point, view };
    } else gesture.current = null;
  };
  const zoom = (factor: number) => setView((current) => ({ ...current, halfRange: clampTrackRange(current.halfRange * factor) }));
  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.22 : .82);
  };
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "+" || event.key === "=") zoom(.75);
    else if (event.key === "-") zoom(1.33);
    else if (event.key === "0" || event.key === "Home") setView(fittedView);
    else return;
    event.preventDefault();
  };

  if (!map) return <div className="track-map-empty">{language === "de" ? "Noch keine GPS-Punkte" : "No GPS points available"}</div>;
  const start = map.project(points[0].longitude, points[0].latitude);
  const end = map.project(points.at(-1)!.longitude, points.at(-1)!.latitude);
  return <div className="track-map-wrap">
    <svg className="track-map" viewBox={`0 0 ${TRACK_MAP_WIDTH} ${TRACK_MAP_HEIGHT}`} role="application" tabIndex={0} aria-label={language === "de" ? "Interaktive Karte der aufgezeichneten Fahrt. Ziehen zum Verschieben, aufziehen oder Tasten zum Zoomen." : "Interactive map of the recorded trip. Drag to pan, pinch or use buttons to zoom."} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onWheel={handleWheel} onDoubleClick={() => zoom(.65)} onKeyDown={handleKeyDown}>
      <defs><filter id="trackGlow"><feGaussianBlur stdDeviation="2.3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter><pattern id="trackLandHatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="9" height="9" className="track-map-land-base"/><line x1="0" y1="0" x2="0" y2="9" className="track-map-land-line"/></pattern></defs>
      <rect className="track-map-water" width={TRACK_MAP_WIDTH} height={TRACK_MAP_HEIGHT} rx="16" />
      <g className="track-map-land">{map.landBands.map((band, index) => <rect key={index} x={band.x} y={band.y} width={band.width} height="4.5" />)}</g>
      <g className="track-map-shore">{map.shore.map((segment, index) => {
        const startPoint = map.project(segment[0], segment[1]);
        const endPoint = map.project(segment[2], segment[3]);
        return <line key={index} x1={startPoint.x} y1={startPoint.y} x2={endPoint.x} y2={endPoint.y} />;
      })}</g>
      <polyline className="track-route-underlay" points={points.map((point) => { const p = map.project(point.longitude, point.latitude); return `${p.x},${p.y}`; }).join(" ")} />
      <g className="track-route-segments" filter="url(#trackGlow)">{points.slice(1).map((point, index) => {
        const from = map.project(points[index].longitude, points[index].latitude);
        const to = map.project(point.longitude, point.latitude);
        const speed = point.speedKnots ?? 0;
        return <line className={speed > 15 ? "fast" : speed > 8 ? "cruise" : "slow"} key={`${point.timestamp}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
      })}</g>
      <g className="track-marker start" transform={`translate(${start.x} ${start.y})`}><circle r="9" /><text y="3">A</text></g>
      <g className="track-marker end" transform={`translate(${end.x} ${end.y})`}><circle r="9" /><text y="3">B</text></g>
      <text className="track-map-scale" x="12" y={TRACK_MAP_HEIGHT - 13}>{language === "de" ? "SICHTBREITE" : "VIEW WIDTH"} · {distance(view.halfRange * 2)}</text>
      <g className="track-map-north" transform="translate(337 222)"><path d="M0-9L5 7L0 4L-5 7Z"/><text y="-13">N</text></g>
    </svg>
    <div className="track-map-controls" aria-label={language === "de" ? "Kartensteuerung" : "Map controls"}>
      <button type="button" aria-label={language === "de" ? "Vergrößern" : "Zoom in"} onClick={() => zoom(.7)}>+</button>
      <button type="button" aria-label={language === "de" ? "Verkleinern" : "Zoom out"} onClick={() => zoom(1.42)}>−</button>
      <button type="button" aria-label={language === "de" ? "Gesamte Fahrt anzeigen" : "Fit complete trip"} onClick={() => setView(fittedView)}>⌖</button>
    </div>
    <div className="track-speed-legend"><span className="slow">≤8 kn</span><span className="cruise">8–15 kn</span><span className="fast">&gt;15 kn</span></div>
    <div className="track-map-help">{language === "de" ? "Ziehen · Aufziehen zum Zoomen" : "Drag · Pinch to zoom"}</div>
  </div>;
}

function SpeedChart({ points, language }: { points: TripTrackPoint[]; language: "de" | "en" }) {
  const values = points.map((point) => point.speedKnots ?? 0);
  const maximum = Math.max(1, ...values);
  const polyline = values.map((value, index) => `${values.length === 1 ? 0 : index / (values.length - 1) * 320},${58 - value / maximum * 52}`).join(" ");
  return <div className="track-speed-chart"><span><small>{language === "de" ? "GESCHWINDIGKEIT" : "SPEED"}</small><b>max {maximum.toFixed(1)} kn</b></span><svg viewBox="0 0 320 62" preserveAspectRatio="none" role="img" aria-label={language === "de" ? "Geschwindigkeitsverlauf" : "Speed over time"}><path d="M0 58H320" /><polyline points={polyline} /></svg></div>;
}

function TripDetail({ trip, language, coastline, onBack }: { trip: TripActivity; language: "de" | "en"; coastline: CoastlinePack | null; onBack: () => void }) {
  const de = language === "de";
  const [points, setPoints] = useState<TripTrackPoint[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getTripTrack(trip.id).then((track) => active && setPoints(track)).catch(() => active && setPoints([])).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [trip.id]);
  const averageAccuracy = points.length ? points.reduce((sum, point) => sum + point.accuracy, 0) / points.length : null;
  const title = [trip.startLabel, trip.endLabel].filter(Boolean).join(" → ") || (de ? "Aufgezeichnete Fahrt" : "Recorded trip");
  const exportGpx = () => {
    const blob = new Blob([buildTripGpx(title, points)], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shoreline-${new Date(trip.startedAt).toISOString().slice(0, 10)}.gpx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const metrics = [
    [de ? "Strecke" : "Distance", distance(trip.distanceMetres)],
    [de ? "Gesamtdauer" : "Duration", duration(trip.durationMs, language)],
    [de ? "In Bewegung" : "Moving", duration(trip.movingDurationMs, language)],
    [de ? "Ø Tempo" : "Average speed", `${trip.averageSpeedKnots.toFixed(1)} kn`],
    [de ? "Max. Tempo" : "Top speed", `${trip.maxSpeedKnots.toFixed(1)} kn`],
    [de ? "Kleinster Küstenabstand" : "Closest shore", trip.minShoreDistanceMetres === null ? "—" : distance(trip.minShoreDistanceMetres)],
    [de ? "Geringste Kartentiefe" : "Minimum chart depth", trip.minDepthMetres === null ? "—" : `${trip.minDepthMetres.toFixed(1)} m`],
    [de ? "Warnungen" : "Warnings", String(trip.warningCount)],
    [de ? "GPS-Punkte" : "GPS points", String(points.length || trip.trackPointCount || 0)],
    [de ? "Ø GPS-Genauigkeit" : "Avg GPS accuracy", averageAccuracy === null ? "—" : `±${averageAccuracy.toFixed(0)} m`],
  ];
  return <section className="trip-detail">
    <header className="trip-detail-header"><button type="button" onClick={onBack}>‹ {de ? "Logbuch" : "Logbook"}</button><span><small>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(trip.startedAt)}</small><strong>{title}</strong></span><button type="button" disabled={!points.length} onClick={exportGpx}>GPX</button></header>
    {loading ? <div className="track-map-loading">{de ? "GPS-Track wird geladen …" : "Loading GPS track…"}</div> : <TrackMap points={points} coastline={coastline} language={language} />}
    {points.length > 1 && <SpeedChart points={points} language={language} />}
    <div className="trip-detail-grid">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>
    <div className="trip-route-note"><span>⌖</span><p><strong>{de ? "Automatisch aufgezeichnet" : "Recorded automatically"}</strong><small>{de ? "Dieser GPS-Track läuft bei jedem Live-Tracking – auch ohne aktive Navigation." : "This GPS track runs during every live session, even without active navigation."}</small></p></div>
  </section>;
}

export default function ActivityOverview({ language, records, currentTrip, currentAnchor, now, coastline, onBack, onClear }: Props) {
  const de = language === "de";
  const totals = activityTotals(records);
  const hasLive = Boolean(currentTrip || currentAnchor);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const selectedTrip = records.find((record): record is TripActivity => record.kind === "trip" && record.id === selectedTripId) ?? null;
  if (selectedTrip) return <TripDetail key={selectedTrip.id} trip={selectedTrip} language={language} coastline={coastline} onBack={() => setSelectedTripId(null)} />;
  return <section className="activity-overview" aria-label={de ? "Aktivitäten" : "Activities"}>
    <header className="activity-header"><span><small>{de ? "LOKALES LOGBUCH" : "LOCAL LOGBOOK"}</small><strong>{de ? "Aktivitäten" : "Activities"}</strong></span>{onBack && <button type="button" onClick={onBack}>{de ? "Zurück" : "Back"}</button>}</header>
    <div className="activity-hero"><div className="activity-radar" aria-hidden="true"><i /><b>⌁</b></div><span><small>{de ? "Gesamtstrecke" : "Total distance"}</small><strong>{distance(totals.distanceMetres)}</strong><em>{totals.trips} {de ? "Fahrten" : "trips"}</em></span><span><small>{de ? "Bestwert" : "Top speed"}</small><strong>{totals.maxSpeedKnots.toFixed(1)}</strong><em>kn</em></span><span><small>{de ? "Ankerzeit" : "Anchor time"}</small><strong>{duration(totals.anchorDurationMs, language)}</strong><em>{totals.driftAlarms} {de ? "Driftalarme" : "drift alarms"}</em></span></div>
    {hasLive && <div className="activity-live"><i aria-hidden="true" /><span><small>{currentAnchor ? (de ? "ANKERWACHE AKTIV" : "ANCHOR WATCH ACTIVE") : (de ? "GPS-TRACK LÄUFT" : "GPS TRACK RECORDING")}</small><strong>{currentAnchor ? (de ? "Ankerwache" : "Anchor watch") : (de ? "Fahrt läuft" : "Trip underway")}</strong></span><b>{currentAnchor ? duration(now - currentAnchor.setAt, language) : `${duration(now - (currentTrip?.startedAt ?? now), language)} · ${currentTrip?.trackPointCount ?? 0} GPS`}</b></div>}
    <div className="activity-timeline">{records.length === 0 ? <div className="activity-empty"><span aria-hidden="true">⌁</span><strong>{de ? "Noch keine Einträge" : "No entries yet"}</strong><p>{de ? "Jede Live-Fahrt und Ankerzeit wird automatisch mit GPS-Track auf diesem Gerät gespeichert." : "Every live trip and anchor session is stored automatically with its GPS track on this device."}</p></div> : records.map((record, index) => {
      const date = new Intl.DateTimeFormat(language, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(record.startedAt);
      const isTrip = record.kind === "trip";
      const place = !isTrip ? [record.bayName, record.islandName].filter(Boolean).join(" · ") : "";
      const content = <><span className="activity-icon" aria-hidden="true">{isTrip ? "↗" : "⚓"}</span><div className="activity-row-main"><small>{date}</small><strong>{isTrip ? ([record.startLabel, record.endLabel].filter(Boolean).join(" → ") || (de ? "Fahrt" : "Trip")) : (place || (de ? "Ankern" : "Anchored"))}</strong><span>{isTrip ? `${distance(record.distanceMetres)} · ${de ? "Ø" : "avg"} ${record.averageSpeedKnots.toFixed(1)} kn · ${record.trackPointCount ?? 0} GPS` : `${duration(record.durationMs, language)} · max ${Math.round(record.maxDriftMetres)} m ${de ? "Drift" : "drift"}`}</span><div className="activity-meter"><i style={{ width: `${Math.min(100, isTrip ? record.maxSpeedKnots * 4 : record.maxDriftMetres / Math.max(1, record.radiusMetres) * 100)}%` }} /></div></div>{isTrip ? <ActivityMiniMap trip={record} coastline={coastline} language={language} /> : <b>{duration(record.durationMs, language)}</b>}</>;
      return isTrip ? <button type="button" className="activity-row trip" key={record.id} onClick={() => setSelectedTripId(record.id)} style={{ "--activity-index": index } as CSSProperties}>{content}</button> : <article className="activity-row anchor" key={record.id} style={{ "--activity-index": index } as CSSProperties}>{content}</article>;
    })}</div>
    <footer className="activity-privacy"><span>⌂</span><p><strong>{de ? "Nur auf diesem Gerät" : "Only on this device"}</strong><small>{de ? "Detaillierte GPS-Tracks werden lokal gespeichert und nie übertragen. Maximal 200 Logbucheinträge." : "Detailed GPS tracks stay on this device and are never transmitted. Maximum 200 logbook entries."}</small></p>{records.length > 0 && <button type="button" onClick={onClear}>{de ? "Löschen" : "Clear"}</button>}</footer>
  </section>;
}
