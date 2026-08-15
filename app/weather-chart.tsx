"use client";

import { useMemo, type PointerEvent } from "react";
import { buildWeatherChartModel, nauticalWeatherMetricValue, type NauticalWeatherHour, type NauticalWeatherMetric } from "../lib/nautical-weather";

type Props = {
  hours: NauticalWeatherHour[];
  metric: NauticalWeatherMetric;
  label: string;
  unit: string;
  digits: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  language: "de" | "en";
};

function format(value: number | null, digits: number, unit: string) {
  return value === null ? `— ${unit}` : `${value.toFixed(digits)} ${unit}`;
}

export default function WeatherChart({ hours, metric, label, unit, digits, selectedIndex, onSelect, language }: Props) {
  const model = useMemo(() => buildWeatherChartModel(hours, metric), [hours, metric]);
  const selectedHour = hours[selectedIndex] ?? hours[0] ?? null;
  const selectedValue = selectedHour ? nauticalWeatherMetricValue(selectedHour, metric) : null;
  const selectedPoint = model?.points.reduce((nearest, point) => Math.abs(point.index - selectedIndex) < Math.abs(nearest.index - selectedIndex) ? point : nearest, model.points[0]) ?? null;
  const selectFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || hours.length < 2) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    onSelect(Math.round(ratio * (hours.length - 1)));
  };

  if (!model || !selectedHour) return null;
  const ticks = [0, 6, 12, 18, 23].filter((index) => index < hours.length);
  return <article className="weather-chart-card">
    <header>
      <span><small>{label}</small><strong>{format(selectedValue, digits, unit)}</strong></span>
      <time>{selectedHour.time.slice(11, 16)}</time>
    </header>
    <svg className="weather-chart" viewBox="0 0 320 150" role="img" aria-label={`${label}: ${format(selectedValue, digits, unit)} ${language === "de" ? "um" : "at"} ${selectedHour.time.slice(11, 16)}`} onPointerDown={selectFromPointer}>
      <defs>
        <linearGradient id="weather-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".38"/><stop offset="1" stopColor="currentColor" stopOpacity=".02"/></linearGradient>
      </defs>
      {[34, 70, 106].map((y) => <line key={y} className="weather-chart-grid" x1="10" x2="310" y1={y} y2={y} />)}
      <path className="weather-chart-area" d={model.areaPath} />
      <path className="weather-chart-line" d={model.linePath} pathLength="1" />
      {selectedPoint && <g className="weather-chart-cursor"><line x1={selectedPoint.x} x2={selectedPoint.x} y1="8" y2="114"/><circle cx={selectedPoint.x} cy={selectedPoint.y} r="5"/></g>}
      {ticks.map((index) => <text key={index} x={10 + index / Math.max(hours.length - 1, 1) * 300} y="143" textAnchor={index === 0 ? "start" : index === hours.length - 1 ? "end" : "middle"}>{hours[index].time.slice(11, 13)}</text>)}
      <text className="weather-chart-extreme" x="310" y="18" textAnchor="end">{model.maximum.toFixed(digits)} {unit}</text>
      <text className="weather-chart-extreme" x="310" y="112" textAnchor="end">{model.minimum.toFixed(digits)} {unit}</text>
    </svg>
    <input type="range" min="0" max={Math.max(hours.length - 1, 0)} value={selectedIndex} onChange={(event) => onSelect(Number(event.target.value))} aria-label={language === "de" ? `Uhrzeit für ${label}` : `Time for ${label}`} />
  </article>;
}
