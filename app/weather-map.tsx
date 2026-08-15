"use client";

import { useMemo } from "react";
import { findWeatherMapHour, nauticalWeatherMetricValue, type NauticalWeatherMapLocation, type NauticalWeatherMetric } from "../lib/nautical-weather";
import type { GeoPoint } from "../lib/route-planning";
import type { ShorelineSegment } from "../lib/shoreline";

type Props = {
  point: GeoPoint;
  locations: NauticalWeatherMapLocation[];
  segments: ShorelineSegment[];
  metric: NauticalWeatherMetric;
  time: string;
  unit: string;
  digits: number;
  language: "de" | "en";
  loading: boolean;
};

function palette(metric: NauticalWeatherMetric, ratio: number) {
  const bounded = Math.max(0, Math.min(1, ratio));
  if (metric === "rain") return `hsl(${205 - bounded * 35} 88% ${62 - bounded * 22}%)`;
  if (metric === "visibility") return `hsl(${185 + bounded * 25} 60% ${42 + bounded * 25}%)`;
  if (metric === "pressure") return `hsl(${275 - bounded * 80} 65% ${62 - bounded * 18}%)`;
  if (metric === "waves" || metric === "current") return `hsl(${180 + bounded * 105} 72% ${58 - bounded * 24}%)`;
  if (metric === "temperature" || metric === "seaTemperature") return `hsl(${210 - bounded * 205} 82% ${58 - bounded * 16}%)`;
  return `hsl(${174 - bounded * 170} 82% ${54 - bounded * 16}%)`;
}

function directionFor(metric: NauticalWeatherMetric, location: NauticalWeatherMapLocation, time: string) {
  const hour = findWeatherMapHour(location, time);
  if (!hour) return null;
  if (metric === "wind" || metric === "gusts") return hour.windDirectionDegrees;
  if (metric === "waves") return hour.waveDirectionDegrees;
  if (metric === "current") return hour.currentDirectionDegrees;
  return null;
}

export default function WeatherMap({ point, locations, segments, metric, time, unit, digits, language, loading }: Props) {
  const samples = useMemo(() => locations.flatMap((location) => {
    const hour = findWeatherMapHour(location, time);
    const value = hour ? nauticalWeatherMetricValue(hour, metric) : null;
    return value === null ? [] : [{ location, value }];
  }), [locations, metric, time]);
  const values = samples.map((sample) => sample.value);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const span = Math.max(maximum - minimum, 0.001);
  const bounds = useMemo(() => ({
    west: point.longitude - .185,
    east: point.longitude + .185,
    south: point.latitude - .14,
    north: point.latitude + .14,
  }), [point.latitude, point.longitude]);
  const project = (longitude: number, latitude: number) => ({
    x: (longitude - bounds.west) / (bounds.east - bounds.west) * 360,
    y: (bounds.north - latitude) / (bounds.north - bounds.south) * 220,
  });
  const boat = project(point.longitude, point.latitude);
  const visibleSegments = segments.filter(([lon1, lat1, lon2, lat2]) =>
    Math.max(lon1, lon2) >= bounds.west && Math.min(lon1, lon2) <= bounds.east && Math.max(lat1, lat2) >= bounds.south && Math.min(lat1, lat2) <= bounds.north,
  ).slice(0, 900);

  return <article className="weather-map-card">
    <svg viewBox="0 0 360 220" role="img" aria-label={language === "de" ? `Wetterkarte für ${time.slice(11, 16)} Uhr` : `Weather map for ${time.slice(11, 16)}`}>
      <defs>
        <pattern id="weather-map-grid" width="45" height="44" patternUnits="userSpaceOnUse"><path d="M45 0H0V44" className="weather-map-grid" /></pattern>
        <filter id="weather-map-blur"><feGaussianBlur stdDeviation="18" /></filter>
      </defs>
      <rect className="weather-map-water" width="360" height="220" />
      <rect width="360" height="220" fill="url(#weather-map-grid)" />
      <g className="weather-map-heat" filter="url(#weather-map-blur)">
        {samples.map(({ location, value }, index) => { const position = project(location.longitude, location.latitude); return <circle key={`${location.latitude}:${location.longitude}:${index}`} cx={position.x} cy={position.y} r="48" fill={palette(metric, (value - minimum) / span)} />; })}
      </g>
      <g className="weather-map-coast">
        {visibleSegments.map((segment, index) => { const start = project(segment[0], segment[1]); const end = project(segment[2], segment[3]); return <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />; })}
      </g>
      <g className="weather-map-values">
        {samples.map(({ location, value }, index) => { const position = project(location.longitude, location.latitude); const direction = directionFor(metric, location, time); return <g key={`${location.latitude}:${location.longitude}:value:${index}`} transform={`translate(${position.x} ${position.y})`}><circle r="15" fill={palette(metric, (value - minimum) / span)} /><text y="3">{value.toFixed(digits)}</text>{direction !== null && <text className="weather-map-arrow" y="-19" transform={`rotate(${direction})`}>↓</text>}</g>; })}
      </g>
      <g className="weather-map-boat" transform={`translate(${boat.x} ${boat.y})`}><circle r="11"/><path d="M0-12 7 9 0 6-7 9Z"/></g>
      <g className="weather-map-compass" transform="translate(332 27)"><circle r="16"/><text y="4">N</text></g>
    </svg>
    <footer><span><i style={{ background: palette(metric, 0) }} />{minimum.toFixed(digits)} {unit}</span><time>{time.slice(11, 16)}</time><span>{maximum.toFixed(digits)} {unit}<i style={{ background: palette(metric, 1) }} /></span></footer>
    {loading && <span className="weather-map-loading">{language === "de" ? "Kartenwerte werden aktualisiert" : "Updating map values"}</span>}
  </article>;
}
