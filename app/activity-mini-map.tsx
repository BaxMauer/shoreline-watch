"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TripActivity } from "../lib/activity-log";
import { getTripTrack, type TripTrackPoint } from "../lib/activity-track";
import { getLandIntervalsAtLatitude, getNearbyShorelineSegments, type CoastlinePack } from "../lib/shoreline";

const WIDTH = 104;
const HEIGHT = 70;

function fallbackTrack(trip: TripActivity): TripTrackPoint[] {
  return [trip.startPoint, trip.endPoint]
    .filter((point): point is NonNullable<typeof point> => Boolean(point))
    .map((point, index) => ({
      ...point,
      tripId: trip.id,
      sequence: index,
      timestamp: index ? trip.endedAt : trip.startedAt,
      accuracy: 0,
      speedKnots: null,
      heading: null,
      shoreDistanceMetres: null,
      depthMetres: null,
    }));
}

export default function ActivityMiniMap({ trip, coastline, language }: { trip: TripActivity; coastline: CoastlinePack | null; language: "de" | "en" }) {
  const element = useRef<HTMLSpanElement>(null);
  const [shouldLoadTrack, setShouldLoadTrack] = useState(false);
  const [storedTrack, setStoredTrack] = useState<TripTrackPoint[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      const timer = setTimeout(() => setShouldLoadTrack(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setShouldLoadTrack(true);
      observer.disconnect();
    }, { rootMargin: "120px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoadTrack) return;
    let active = true;
    getTripTrack(trip.id)
      .then((points) => { if (active) setStoredTrack(points); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [shouldLoadTrack, trip.id]);

  const points = useMemo(() => storedTrack.length ? storedTrack : fallbackTrack(trip), [storedTrack, trip]);
  const map = useMemo(() => {
    if (!points.length) return null;
    const minLatitude = Math.min(...points.map((point) => point.latitude));
    const maxLatitude = Math.max(...points.map((point) => point.latitude));
    const minLongitude = Math.min(...points.map((point) => point.longitude));
    const maxLongitude = Math.max(...points.map((point) => point.longitude));
    const latitude = (minLatitude + maxLatitude) / 2;
    const longitude = (minLongitude + maxLongitude) / 2;
    const longitudeScale = 111_320 * Math.max(.1, Math.cos(latitude * Math.PI / 180));
    const latitudeScale = 110_540;
    const routeWidth = (maxLongitude - minLongitude) * longitudeScale;
    const routeHeight = (maxLatitude - minLatitude) * latitudeScale;
    const halfRange = Math.max(70, routeWidth / 2, routeHeight / 2) * 1.38;
    const scale = Math.min((WIDTH - 12) / (halfRange * 2), (HEIGHT - 10) / (halfRange * 2));
    const viewport = {
      halfWidthMetres: WIDTH / (2 * scale),
      halfHeightMetres: HEIGHT / (2 * scale),
      radiusMetres: Math.hypot(WIDTH / (2 * scale), HEIGHT / (2 * scale)) + 3 / scale,
    };
    const project = (point: { latitude: number; longitude: number }) => ({
      x: WIDTH / 2 + (point.longitude - longitude) * longitudeScale * scale,
      y: HEIGHT / 2 - (point.latitude - latitude) * latitudeScale * scale,
    });
    const shore = coastline ? getNearbyShorelineSegments(coastline, longitude, latitude, viewport.radiusMetres * 1.08, 500) : [];
    const landBands: Array<{ x: number; y: number; width: number }> = [];
    if (coastline) {
      const west = longitude - viewport.halfWidthMetres / longitudeScale;
      const east = longitude + viewport.halfWidthMetres / longitudeScale;
      for (let y = -3; y < HEIGHT + 3; y += 3) {
        const scanLatitude = latitude + (HEIGHT / 2 - y - 1.5) / (latitudeScale * scale);
        for (const [landWest, landEast] of getLandIntervalsAtLatitude(coastline, scanLatitude, west, east)) {
          const left = Math.max(0, project({ longitude: landWest, latitude: scanLatitude }).x);
          const right = Math.min(WIDTH, project({ longitude: landEast, latitude: scanLatitude }).x);
          if (right > left) landBands.push({ x: left, y, width: right - left });
        }
      }
    }
    const sampled = points.length > 72
      ? points.filter((_, index) => index % Math.ceil(points.length / 72) === 0 || index === points.length - 1)
      : points;
    return { project, shore, landBands, sampled };
  }, [coastline, points]);

  if (!map) return <span ref={element} className="activity-mini-map empty" aria-label={language === "de" ? "Keine Kartendaten" : "No map data"}><i /><b>⌖</b></span>;
  const start = map.project(map.sampled[0]);
  const end = map.project(map.sampled.at(-1)!);
  const routePoints = map.sampled.map((point) => {
    const projected = map.project(point);
    return `${projected.x},${projected.y}`;
  }).join(" ");

  return <span ref={element} className="activity-mini-map" role="img" aria-label={language === "de" ? "Mini-Karte der Fahrt" : "Mini map of the trip"}>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <rect className="activity-mini-water" width={WIDTH} height={HEIGHT} rx="10" />
      <g className="activity-mini-land">{map.landBands.map((band, index) => <rect key={index} x={band.x} y={band.y} width={band.width} height="3.5" />)}</g>
      <g className="activity-mini-shore">{map.shore.map((segment, index) => {
        const from = map.project({ longitude: segment[0], latitude: segment[1] });
        const to = map.project({ longitude: segment[2], latitude: segment[3] });
        return <line key={index} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
      })}</g>
      <polyline className="activity-mini-route-shadow" points={routePoints} />
      <polyline className="activity-mini-route" points={routePoints} />
      <circle className="activity-mini-start" cx={start.x} cy={start.y} r="3.5" />
      <circle className="activity-mini-end" cx={end.x} cy={end.y} r="3.5" />
    </svg>
    <b aria-hidden="true">›</b>
  </span>;
}
