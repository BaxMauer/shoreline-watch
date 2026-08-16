"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { activityTotals, type ActivityRecord, type TripActivity, type TripDraft } from "../lib/activity-log";
import { buildTripGpx, getTripTrack, type TripTrackPoint } from "../lib/activity-track";
import type { AnchorWatch } from "../lib/anchor-watch";
import { getNearbyShorelineSegments, type CoastlinePack } from "../lib/shoreline";

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

function TrackMap({ points, coastline, language }: { points: TripTrackPoint[]; coastline: CoastlinePack | null; language: "de" | "en" }) {
  const map = useMemo(() => {
    if (!points.length) return null;
    const minLatitude = Math.min(...points.map((point) => point.latitude));
    const maxLatitude = Math.max(...points.map((point) => point.latitude));
    const minLongitude = Math.min(...points.map((point) => point.longitude));
    const maxLongitude = Math.max(...points.map((point) => point.longitude));
    const centre = { latitude: (minLatitude + maxLatitude) / 2, longitude: (minLongitude + maxLongitude) / 2 };
    const longitudeScale = 111_320 * Math.max(.1, Math.cos(centre.latitude * Math.PI / 180));
    const latitudeScale = 110_540;
    const routeWidth = (maxLongitude - minLongitude) * longitudeScale;
    const routeHeight = (maxLatitude - minLatitude) * latitudeScale;
    const halfRange = Math.max(350, routeWidth / 2, routeHeight / 2) * 1.32;
    const scale = Math.min(320 / (halfRange * 2), 188 / (halfRange * 2));
    const project = (longitude: number, latitude: number) => ({
      x: 180 + (longitude - centre.longitude) * longitudeScale * scale,
      y: 110 - (latitude - centre.latitude) * latitudeScale * scale,
    });
    const shore = coastline ? getNearbyShorelineSegments(coastline, centre.longitude, centre.latitude, halfRange * 1.7, 3_000) : [];
    return { project, shore, halfRange };
  }, [coastline, points]);

  if (!map) return <div className="track-map-empty">{language === "de" ? "Noch keine GPS-Punkte" : "No GPS points available"}</div>;
  const start = map.project(points[0].longitude, points[0].latitude);
  const end = map.project(points.at(-1)!.longitude, points.at(-1)!.latitude);
  return <div className="track-map-wrap">
    <svg className="track-map" viewBox="0 0 360 220" role="img" aria-label={language === "de" ? "Aufgezeichnete GPS-Fahrt" : "Recorded GPS trip"}>
      <defs><filter id="trackGlow"><feGaussianBlur stdDeviation="2.3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <rect className="track-map-water" width="360" height="220" rx="16" />
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
      <text className="track-map-scale" x="12" y="205">GPS TRACK · {distance(map.halfRange * 2)}</text>
    </svg>
    <div className="track-speed-legend"><span className="slow">≤8 kn</span><span className="cruise">8–15 kn</span><span className="fast">&gt;15 kn</span></div>
  </div>;
}

function SpeedChart({ points }: { points: TripTrackPoint[] }) {
  const values = points.map((point) => point.speedKnots ?? 0);
  const maximum = Math.max(1, ...values);
  const polyline = values.map((value, index) => `${values.length === 1 ? 0 : index / (values.length - 1) * 320},${58 - value / maximum * 52}`).join(" ");
  return <div className="track-speed-chart"><span><small>GESCHWINDIGKEIT</small><b>max {maximum.toFixed(1)} kn</b></span><svg viewBox="0 0 320 62" preserveAspectRatio="none" aria-label="Geschwindigkeitsverlauf"><path d="M0 58H320" /><polyline points={polyline} /></svg></div>;
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
    ["Ø Tempo", `${trip.averageSpeedKnots.toFixed(1)} kn`],
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
    {points.length > 1 && <SpeedChart points={points} />}
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
      const content = <><span className="activity-icon" aria-hidden="true">{isTrip ? "↗" : "⚓"}</span><div className="activity-row-main"><small>{date}</small><strong>{isTrip ? ([record.startLabel, record.endLabel].filter(Boolean).join(" → ") || (de ? "Fahrt" : "Trip")) : (place || (de ? "Ankern" : "Anchored"))}</strong><span>{isTrip ? `${distance(record.distanceMetres)} · Ø ${record.averageSpeedKnots.toFixed(1)} kn · ${record.trackPointCount ?? 0} GPS` : `${duration(record.durationMs, language)} · max ${Math.round(record.maxDriftMetres)} m ${de ? "Drift" : "drift"}`}</span><div className="activity-meter"><i style={{ width: `${Math.min(100, isTrip ? record.maxSpeedKnots * 4 : record.maxDriftMetres / Math.max(1, record.radiusMetres) * 100)}%` }} /></div></div><b>{isTrip ? "›" : duration(record.durationMs, language)}</b></>;
      return isTrip ? <button type="button" className="activity-row trip" key={record.id} onClick={() => setSelectedTripId(record.id)} style={{ "--activity-index": index } as CSSProperties}>{content}</button> : <article className="activity-row anchor" key={record.id} style={{ "--activity-index": index } as CSSProperties}>{content}</article>;
    })}</div>
    <footer className="activity-privacy"><span>⌂</span><p><strong>{de ? "Nur auf diesem Gerät" : "Only on this device"}</strong><small>{de ? "Detaillierte GPS-Tracks werden lokal gespeichert und nie übertragen. Maximal 200 Logbucheinträge." : "Detailed GPS tracks stay on this device and are never transmitted. Maximum 200 logbook entries."}</small></p>{records.length > 0 && <button type="button" onClick={onClear}>{de ? "Löschen" : "Clear"}</button>}</footer>
  </section>;
}
