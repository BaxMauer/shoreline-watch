"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import {
  compassLabel,
  findWeatherMapHour,
  nauticalWeatherMetricValue,
  type NauticalWeatherMapLocation,
  type NauticalWeatherMetric,
} from "../lib/nautical-weather";
import { getMapFeaturesInView, placeMapFeatureLabels, type MapFeaturePack } from "../lib/map-features";
import type { GeoPoint } from "../lib/route-planning";
import { getLandIntervalsAtLatitude, type CoastlinePack, type ShorelineSegment } from "../lib/shoreline";

type Props = {
  point: GeoPoint;
  locations: NauticalWeatherMapLocation[];
  segments: ShorelineSegment[];
  coastline: CoastlinePack | null;
  mapFeatures: MapFeaturePack | null;
  metric: NauticalWeatherMetric;
  metricLabel: string;
  time: string;
  unit: string;
  digits: number;
  language: "de" | "en";
  loading: boolean;
};

const WIDTH = 360;
const HEIGHT = 220;
const HALF_RANGE_METRES = 18_000;
const METRES_PER_LATITUDE_DEGREE = 110_540;

function metricRange(metric: NauticalWeatherMetric, minimum: number, maximum: number) {
  if (metric === "wind") return { minimum: 0, maximum: 30, caution: 15, danger: 25, reverse: false };
  if (metric === "gusts") return { minimum: 0, maximum: 40, caution: 20, danger: 30, reverse: false };
  if (metric === "waves") return { minimum: 0, maximum: 2, caution: .8, danger: 1.5, reverse: false };
  if (metric === "current") return { minimum: 0, maximum: 2, caution: 1, danger: 1.5, reverse: false };
  if (metric === "rain") return { minimum: 0, maximum: 100, caution: 60, danger: 90, reverse: false };
  if (metric === "visibility") return { minimum: 0, maximum: 20, caution: 5, danger: 2, reverse: true };
  const padding = Math.max((maximum - minimum) * .12, metric === "pressure" ? 1 : .5);
  return { minimum: minimum - padding, maximum: maximum + padding, caution: null, danger: null, reverse: false };
}

function palette(metric: NauticalWeatherMetric, value: number, minimum: number, maximum: number) {
  const range = metricRange(metric, minimum, maximum);
  if (range.reverse) {
    if (range.danger !== null && value <= range.danger) return "#f25f54";
    if (range.caution !== null && value <= range.caution) return "#e9b94f";
  } else {
    if (range.danger !== null && value >= range.danger) return "#f25f54";
    if (range.caution !== null && value >= range.caution) return "#e9b94f";
  }
  const ratio = Math.max(0, Math.min(1, (value - range.minimum) / Math.max(.001, range.maximum - range.minimum)));
  if (metric === "temperature" || metric === "seaTemperature") return `hsl(${205 - ratio * 178} 77% ${50 + ratio * 7}%)`;
  if (metric === "pressure") return `hsl(${235 + ratio * 42} 62% ${55 - ratio * 7}%)`;
  if (metric === "rain") return `hsl(${186 + ratio * 42} 76% ${49 - ratio * 5}%)`;
  if (metric === "visibility") return `hsl(${174 + ratio * 16} 62% ${42 + ratio * 8}%)`;
  return `hsl(${174 - ratio * 35} 69% ${45 + ratio * 4}%)`;
}

function directionFor(metric: NauticalWeatherMetric, location: NauticalWeatherMapLocation, time: string) {
  const hour = findWeatherMapHour(location, time);
  if (!hour) return null;
  if (metric === "wind" || metric === "gusts") return hour.windDirectionDegrees;
  if (metric === "waves") return hour.waveDirectionDegrees;
  if (metric === "current") return hour.currentDirectionDegrees;
  return null;
}

function distanceMetres(point: GeoPoint, location: NauticalWeatherMapLocation) {
  const longitudeScale = 111_320 * Math.cos(point.latitude * Math.PI / 180);
  return Math.hypot((location.longitude - point.longitude) * longitudeScale, (location.latitude - point.latitude) * METRES_PER_LATITUDE_DEGREE);
}

export default function WeatherMap({ point, locations, segments, coastline, mapFeatures, metric, metricLabel, time, unit, digits, language, loading }: Props) {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const samples = useMemo(() => locations.flatMap((location) => {
    const hour = findWeatherMapHour(location, time);
    const value = hour ? nauticalWeatherMetricValue(hour, metric) : null;
    return value === null ? [] : [{ location, value }];
  }), [locations, metric, time]);
  const values = samples.map((sample) => sample.value);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const bounds = useMemo(() => ({
    west: point.longitude - .185,
    east: point.longitude + .185,
    south: point.latitude - .14,
    north: point.latitude + .14,
  }), [point.latitude, point.longitude]);
  const project = useCallback((longitude: number, latitude: number) => ({
    x: (longitude - bounds.west) / (bounds.east - bounds.west) * WIDTH,
    y: (bounds.north - latitude) / (bounds.north - bounds.south) * HEIGHT,
  }), [bounds]);
  const boat = project(point.longitude, point.latitude);
  const visibleSegments = useMemo(() => segments.filter(([lon1, lat1, lon2, lat2]) =>
    Math.max(lon1, lon2) >= bounds.west && Math.min(lon1, lon2) <= bounds.east && Math.max(lat1, lat2) >= bounds.south && Math.min(lat1, lat2) <= bounds.north,
  ).slice(0, 900), [bounds, segments]);
  const landPath = useMemo(() => {
    if (!coastline) return "";
    let path = "";
    for (let y = 0; y < HEIGHT; y += 4) {
      const latitude = bounds.north - (y + 2) / HEIGHT * (bounds.north - bounds.south);
      for (const [west, east] of getLandIntervalsAtLatitude(coastline, latitude, bounds.west, bounds.east)) {
        const left = Math.max(0, project(west, latitude).x);
        const right = Math.min(WIDTH, project(east, latitude).x);
        if (right > left) path += `M${left} ${y}H${right}V${Math.min(HEIGHT, y + 4.5)}H${left}Z`;
      }
    }
    return path;
  }, [bounds, coastline, project]);
  const labels = useMemo(() => placeMapFeatureLabels(
    getMapFeaturesInView(mapFeatures, point, HALF_RANGE_METRES),
    (location) => project(location.longitude, location.latitude),
    WIDTH,
    12,
  ).filter((label) => label.y >= 15 && label.y <= HEIGHT - 12), [mapFeatures, point, project]);
  const defaultSample = useMemo(() => samples.toSorted((left, right) => distanceMetres(point, left.location) - distanceMetres(point, right.location))[0] ?? null, [point, samples]);
  const selected = samples.find(({ location }) => `${location.latitude}:${location.longitude}` === selectedLocation) ?? defaultSample;
  const selectedDirection = selected ? directionFor(metric, selected.location, time) : null;
  const selectedDistance = selected ? distanceMetres(point, selected.location) : 0;
  const scaleWidth = 10_000 / (111_320 * Math.cos(point.latitude * Math.PI / 180) * (bounds.east - bounds.west)) * WIDTH;
  const vectorSamples = samples.filter((_, index) => index % 2 === 0);
  const select = (location: NauticalWeatherMapLocation) => setSelectedLocation(`${location.latitude}:${location.longitude}`);
  const selectWithKeyboard = (event: KeyboardEvent<SVGGElement>, location: NauticalWeatherMapLocation) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select(location);
  };

  return <article className="weather-map-card">
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={language === "de" ? `Interaktive Wetterkarte für ${time.slice(11, 16)} Uhr` : `Interactive weather map for ${time.slice(11, 16)}`}>
      <defs>
        <clipPath id="weather-map-clip"><rect width={WIDTH} height={HEIGHT} rx="15" /></clipPath>
        <pattern id="weather-map-land-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="8" height="8" className="weather-map-land-base"/><line x1="0" y1="0" x2="0" y2="8" className="weather-map-land-line"/></pattern>
        <filter id="weather-map-blur"><feGaussianBlur stdDeviation="13" /></filter>
      </defs>
      <g clipPath="url(#weather-map-clip)">
        <rect className="weather-map-water" width={WIDTH} height={HEIGHT} />
        <g className="weather-map-heat" filter="url(#weather-map-blur)">
          {samples.map(({ location, value }, index) => { const position = project(location.longitude, location.latitude); return <rect key={`${location.latitude}:${location.longitude}:${index}`} x={position.x - 48} y={position.y - 38} width="96" height="76" fill={palette(metric, value, minimum, maximum)} />; })}
        </g>
        <path className="weather-map-land" d={landPath} />
        <g className="weather-map-coast">
          {visibleSegments.map((segment, index) => { const start = project(segment[0], segment[1]); const end = project(segment[2], segment[3]); return <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />; })}
        </g>
        <g className="weather-map-labels" aria-hidden="true">{labels.map((label) => <text key={label.id} x={label.x} y={label.y}>{label.name}</text>)}</g>
        <g className="weather-map-vectors" aria-hidden="true">{vectorSamples.map(({ location }, index) => { const position = project(location.longitude, location.latitude); const direction = directionFor(metric, location, time); return direction === null ? null : <g key={`${location.latitude}:${location.longitude}:direction:${index}`} transform={`translate(${position.x} ${position.y}) rotate(${direction})`}><path d="M0-7V7M-4 2 0 7 4 2" /></g>; })}</g>
        <g className="weather-map-hit-areas">{samples.map(({ location, value }, index) => { const position = project(location.longitude, location.latitude); const key = `${location.latitude}:${location.longitude}`; return <g key={`${key}:hit:${index}`} role="button" tabIndex={0} aria-pressed={selectedLocation === key} aria-label={`${metricLabel} ${value.toFixed(digits)} ${unit}`} onClick={() => select(location)} onKeyDown={(event) => selectWithKeyboard(event, location)}><rect x={position.x - 25} y={position.y - 23} width="50" height="46" fill="transparent"/><circle className={selectedLocation === key ? "selected" : "focus-ring"} cx={position.x} cy={position.y} r="6"/></g>; })}</g>
        <g className="weather-map-boat" transform={`translate(${boat.x} ${boat.y})`}><circle r="11"/><path d="M0-12 7 9 0 6-7 9Z"/></g>
        <g className="weather-map-compass" transform="translate(332 27)"><circle r="16"/><path d="M0 8V-8M-4-3 0-8 4-3"/><text y="14">N</text></g>
        <g className="weather-map-scale" transform={`translate(13 ${HEIGHT - 12})`}><path d={`M0 0V-4M0 0H${scaleWidth}M${scaleWidth} 0V-4`}/><text y="-7">10 km</text></g>
      </g>
    </svg>
    {selected && <div className="weather-map-inspector">
      <span><small>{metricLabel}</small><strong>{selected.value.toFixed(digits)} {unit}</strong></span>
      <span><small>{selectedDistance < 2_500 ? (language === "de" ? "Am Boot" : "At the boat") : `${Math.round(selectedDistance / 1_000)} km`}</small><b>{selectedDirection === null ? (language === "de" ? "Punkt antippen" : "Tap a point") : compassLabel(selectedDirection, language)}</b></span>
    </div>}
    <footer><span><i style={{ background: palette(metric, minimum, minimum, maximum) }} />{minimum.toFixed(digits)} {unit}</span><time>{time.slice(11, 16)}</time><span>{maximum.toFixed(digits)} {unit}<i style={{ background: palette(metric, maximum, minimum, maximum) }} /></span></footer>
    {loading && <span className="weather-map-loading">{language === "de" ? "Kartenwerte werden aktualisiert" : "Updating map values"}</span>}
  </article>;
}
