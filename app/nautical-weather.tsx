"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  buildNauticalWeatherRequestUrls,
  classifyNauticalConditions,
  compassLabel,
  getBestBoatingWindow,
  nauticalForecastCanBeReused,
  nauticalWeatherCellKey,
  parseNauticalWeatherForecast,
  type NauticalConditionLevel,
  type NauticalWeatherDay,
  type NauticalWeatherForecast,
  type NauticalWeatherHour,
} from "../lib/nautical-weather";
import type { GeoPoint } from "../lib/route-planning";

const STORAGE_KEY = "shoreline-nautical-weather-v1";

type Props = {
  point: GeoPoint | null;
  active: boolean;
  language: "de" | "en";
  online: boolean;
};

const TEXT = {
  de: {
    title: "Nautisches Wetter",
    local: "GPS-lokal · Heute & morgen",
    today: "Heute",
    tomorrow: "Morgen",
    waiting: "Warte auf GPS-Position",
    waitingDetail: "Für das lokale Seewetter wird deine aktuelle Position benötigt.",
    loading: "Lokales Seewetter wird geladen",
    unavailable: "Seewetter momentan nicht verfügbar",
    retry: "Erneut laden",
    offline: "Offline-Prognose",
    updated: "Aktualisiert",
    good: "Gute Bedingungen",
    caution: "Mit Vorsicht",
    danger: "Besser im Hafen bleiben",
    goodDetail: "Ruhige Bedingungen im betrachteten Tagesfenster.",
    cautionDetail: "Mindestens ein Wetterfaktor verlangt erhöhte Aufmerksamkeit.",
    dangerDetail: "Starker Wind, hohe Wellen, Gewitter oder schlechte Sicht möglich.",
    wind: "Wind",
    gusts: "Böen",
    waves: "Wellen",
    period: "Periode",
    air: "Luft",
    sea: "Wasser",
    visibility: "Sicht",
    pressure: "Luftdruck",
    bestWindow: "Bestes Fahrfenster",
    windowDetail: "Niedrigster kombinierter Wert aus Wind, Wellen und Regen",
    hourly: "Stündlicher Verlauf",
    rain: "Regen",
    swell: "Dünung",
    current: "Strömung",
    clouds: "Wolken",
    sunrise: "Sonnenaufgang",
    sunset: "Sonnenuntergang",
    dayRange: "Tagesspanne",
    max: "Maximum",
    calm: "ruhig",
    noMarine: "Kein küstennaher Wellenwert verfügbar",
    source: "GPS-lokale Modellprognose · Open-Meteo Wetter & Marine",
    scope: "Wellenraster ca. 5–9 km; Küsteneffekte können lokal abweichen.",
    thunder: "Gewitterrisiko",
    rainRisk: "Regenrisiko",
    highGusts: "kräftige Böen",
    highWaves: "höhere Wellen",
    lowVisibility: "eingeschränkte Sicht",
  },
  en: {
    title: "Nautical weather",
    local: "GPS-local · Today & tomorrow",
    today: "Today",
    tomorrow: "Tomorrow",
    waiting: "Waiting for GPS position",
    waitingDetail: "Your current position is needed for local marine weather.",
    loading: "Loading local marine weather",
    unavailable: "Marine weather is currently unavailable",
    retry: "Try again",
    offline: "Offline forecast",
    updated: "Updated",
    good: "Good conditions",
    caution: "Use caution",
    danger: "Better stay in harbour",
    goodDetail: "Calm conditions across the selected daylight period.",
    cautionDetail: "At least one weather factor needs extra attention.",
    dangerDetail: "Strong wind, high waves, thunderstorms, or poor visibility possible.",
    wind: "Wind",
    gusts: "Gusts",
    waves: "Waves",
    period: "Period",
    air: "Air",
    sea: "Water",
    visibility: "Visibility",
    pressure: "Pressure",
    bestWindow: "Best boating window",
    windowDetail: "Lowest combined wind, wave, and rain score",
    hourly: "Hourly outlook",
    rain: "Rain",
    swell: "Swell",
    current: "Current",
    clouds: "Clouds",
    sunrise: "Sunrise",
    sunset: "Sunset",
    dayRange: "Daily range",
    max: "Maximum",
    calm: "calm",
    noMarine: "No near-coast wave value available",
    source: "GPS-local model forecast · Open-Meteo Weather & Marine",
    scope: "Wave grid approx. 5–9 km; local coastal effects may differ.",
    thunder: "Thunderstorm risk",
    rainRisk: "Rain risk",
    highGusts: "strong gusts",
    highWaves: "higher waves",
    lowVisibility: "reduced visibility",
  },
};

function value(value: number | null, digits = 0) {
  return value === null ? "—" : value.toFixed(digits);
}

function time(value: string | null) {
  return value?.slice(11, 16) ?? "—";
}

function weatherSymbol(code: number | null) {
  if (code === null) return "◌";
  if (code >= 95) return "ϟ";
  if (code >= 80) return "☂";
  if (code >= 51) return "☔";
  if (code >= 45) return "≋";
  if (code >= 2) return "☁";
  return "☀";
}

function dayRiskHours(day: NauticalWeatherDay) {
  const daylight = day.hours.filter((hour) => {
    const hourOfDay = Number(hour.time.slice(11, 13));
    return hourOfDay >= 6 && hourOfDay <= 21;
  });
  return daylight.length ? daylight : day.hours;
}

function maxOf(hours: NauticalWeatherHour[], read: (hour: NauticalWeatherHour) => number | null) {
  const values = hours.map(read).filter((entry): entry is number => entry !== null);
  return values.length ? Math.max(...values) : null;
}

function minOf(hours: NauticalWeatherHour[], read: (hour: NauticalWeatherHour) => number | null) {
  const values = hours.map(read).filter((entry): entry is number => entry !== null);
  return values.length ? Math.min(...values) : null;
}

function riskCopy(level: NauticalConditionLevel, copy: { good: string; caution: string; danger: string; goodDetail: string; cautionDetail: string; dangerDetail: string }) {
  return level === "danger"
    ? { title: copy.danger, detail: copy.dangerDetail }
    : level === "caution"
      ? { title: copy.caution, detail: copy.cautionDetail }
      : { title: copy.good, detail: copy.goodDetail };
}

export default function NauticalWeather({ point, active, language, online }: Props) {
  const copy = TEXT[language];
  const [forecast, setForecast] = useState<NauticalWeatherForecast | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "offline" | "error">("idle");
  const [selectedDay, setSelectedDay] = useState(0);
  const [reloadSequence, setReloadSequence] = useState(0);
  const cellKey = point ? nauticalWeatherCellKey(point) : null;
  const queryPoint = useMemo<GeoPoint | null>(() => {
    if (!cellKey) return null;
    const [latitude, longitude] = cellKey.split(":").map(Number);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  }, [cellKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      try {
        const cached = JSON.parse(saved) as NauticalWeatherForecast;
        if (nauticalForecastCanBeReused(cached, cellKey)) {
          setForecast(cached);
          setState("offline");
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cellKey]);

  useEffect(() => {
    if (!active || !queryPoint || !cellKey) return;
    const controller = new AbortController();
    const load = async () => {
      setState((current) => current === "offline" ? current : "loading");
      const urls = buildNauticalWeatherRequestUrls(queryPoint);
      try {
        const [weatherResponse, marineResponse] = await Promise.all([
          fetch(urls.weather, { signal: controller.signal, cache: "no-store" }),
          fetch(urls.marine, { signal: controller.signal, cache: "no-store" }),
        ]);
        if (!weatherResponse.ok || !marineResponse.ok) throw new Error("Forecast unavailable");
        const parsed = parseNauticalWeatherForecast(await weatherResponse.json(), await marineResponse.json(), queryPoint);
        if (!parsed) throw new Error("Forecast invalid");
        if (controller.signal.aborted) return;
        setForecast(parsed);
        setState("ready");
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      } catch {
        if (controller.signal.aborted) return;
        try {
          const saved = window.localStorage.getItem(STORAGE_KEY);
          const cached = saved ? JSON.parse(saved) as NauticalWeatherForecast : null;
          if (cached && nauticalForecastCanBeReused(cached, cellKey)) {
            setForecast(cached);
            setState("offline");
            return;
          }
        } catch {
          window.localStorage.removeItem(STORAGE_KEY);
        }
        setState("error");
      }
    };
    const timer = window.setTimeout(load, 0);
    const interval = window.setInterval(load, 15 * 60 * 1_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); controller.abort(); };
  }, [active, cellKey, queryPoint, reloadSequence]);

  const day = forecast?.days[selectedDay] ?? null;
  const conditions = useMemo(() => day ? classifyNauticalConditions(dayRiskHours(day)) : "good", [day]);
  const conditionCopy = riskCopy(conditions, copy);
  const bestWindow = day ? getBestBoatingWindow(day) : null;
  const selectedCurrent = day
    ? selectedDay === 0 && forecast?.current
      ? forecast.current
      : day.hours.find((hour) => hour.time.endsWith("T12:00")) ?? day.hours[0] ?? null
    : null;
  const riskHours = day ? dayRiskHours(day) : [];
  const hourly = day?.hours.filter((hour, index) => {
    const hourOfDay = Number(hour.time.slice(11, 13));
    if (selectedDay === 0 && forecast?.current && hour.time < forecast.current.time.slice(0, 13) + ":00") return false;
    return index % 3 === 0 && hourOfDay >= 6 && hourOfDay <= 21;
  }) ?? [];
  const maxRain = maxOf(riskHours, (hour) => hour.precipitationProbabilityPercent);
  const minVisibility = minOf(riskHours, (hour) => hour.visibilityKilometres);
  const maxWave = day?.waveHeightMaxMetres ?? maxOf(riskHours, (hour) => hour.waveHeightMetres);
  const hasThunder = riskHours.some((hour) => hour.weatherCode !== null && hour.weatherCode >= 95);
  const reasons = [
    hasThunder ? copy.thunder : null,
    (day?.windGustMaxKnots ?? 0) >= 20 ? copy.highGusts : null,
    (maxWave ?? 0) >= .8 ? copy.highWaves : null,
    (minVisibility ?? 99) < 5 ? copy.lowVisibility : null,
  ].filter(Boolean);

  if (!point) return <section className="weather-panel weather-empty"><span className="weather-empty-symbol" aria-hidden="true">⌖</span><strong>{copy.waiting}</strong><p>{copy.waitingDetail}</p></section>;
  if (!forecast && state === "loading") return <section className="weather-panel weather-empty weather-loading"><span className="weather-loader" aria-hidden="true" /><strong>{copy.loading}</strong><small>{point.latitude.toFixed(4)}° N · {point.longitude.toFixed(4)}° E</small></section>;
  if (!forecast || !day || !selectedCurrent) return <section className="weather-panel weather-empty"><span className="weather-empty-symbol" aria-hidden="true">≋</span><strong>{copy.unavailable}</strong><button type="button" onClick={() => setReloadSequence((current) => current + 1)}>{copy.retry}</button></section>;

  return <section className={`weather-panel weather-${conditions}`}>
    <header className="weather-header">
      <span><strong>{copy.title}</strong><small>{copy.local}</small></span>
      <span className={`weather-freshness ${state}`}><i />{state === "offline" || !online ? copy.offline : `${copy.updated} ${new Date(forecast.fetchedAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}`}</span>
    </header>

    <div className="weather-day-switch" role="tablist" aria-label={copy.title}>
      {forecast.days.slice(0, 2).map((entry, index) => <button key={entry.date} type="button" role="tab" aria-selected={selectedDay === index} className={selectedDay === index ? "active" : ""} onClick={() => setSelectedDay(index)}>
        <span>{index === 0 ? copy.today : copy.tomorrow}</span>
        <small>{new Date(`${entry.date}T12:00:00`).toLocaleDateString(language, { weekday: "short", day: "2-digit", month: "2-digit" })}</small>
      </button>)}
    </div>

    <div className="weather-hero">
      <div className="weather-sky" aria-hidden="true"><span>{weatherSymbol(selectedCurrent.weatherCode)}</span><i /><i /></div>
      <div className="weather-condition-copy">
        <span className={`weather-condition-badge ${conditions}`}><i />{conditionCopy.title}</span>
        <strong>{value(selectedCurrent.temperatureCelsius)}°</strong>
        <p>{reasons.length ? reasons.join(" · ") : conditionCopy.detail}</p>
      </div>
      <div className="weather-hero-range"><small>{copy.dayRange}</small><b>{value(day.temperatureMinCelsius)}° / {value(day.temperatureMaxCelsius)}°</b></div>
    </div>

    <div className="weather-primary-grid">
      <article><span className="weather-metric-icon wind-direction" style={{ "--direction": `${selectedCurrent.windDirectionDegrees ?? 0}deg` } as CSSProperties}>↓</span><span><small>{copy.wind} {compassLabel(selectedCurrent.windDirectionDegrees, language)}</small><strong>{value(selectedCurrent.windSpeedKnots)} <em>kn</em></strong><b>{copy.gusts} {value(selectedCurrent.windGustKnots)} kn</b></span></article>
      <article><span className="weather-metric-icon wave-icon">≋</span><span><small>{copy.waves}</small><strong>{value(selectedCurrent.waveHeightMetres, 1)} <em>m</em></strong><b>{selectedCurrent.wavePeriodSeconds === null ? copy.noMarine : `${copy.period} ${value(selectedCurrent.wavePeriodSeconds)} s`}</b></span></article>
      <article><span className="weather-metric-icon">◉</span><span><small>{copy.air} / {copy.sea}</small><strong>{value(selectedCurrent.temperatureCelsius)}° <em>/ {value(selectedCurrent.seaSurfaceTemperatureCelsius)}°</em></strong><b>{value(selectedCurrent.apparentTemperatureCelsius)}° {language === "de" ? "gefühlt" : "feels"}</b></span></article>
      <article><span className="weather-metric-icon">◌</span><span><small>{copy.visibility}</small><strong>{value(selectedCurrent.visibilityKilometres, 1)} <em>km</em></strong><b>{copy.pressure} {value(selectedCurrent.pressureHpa)} hPa</b></span></article>
    </div>

    {bestWindow && <article className={`weather-window ${bestWindow.level}`}>
      <span className="weather-window-clock" aria-hidden="true">◷</span>
      <span><small>{copy.bestWindow}</small><strong>{time(bestWindow.start)}–{time(bestWindow.end)}</strong><p>{copy.windowDetail}</p></span>
      <i aria-hidden="true">→</i>
    </article>}

    <section className="weather-hourly-section">
      <div className="weather-section-title"><strong>{copy.hourly}</strong><small>{forecast.timezone}</small></div>
      <div className="weather-hourly-strip">
        {hourly.map((hour) => <article key={hour.time} className={`weather-hour ${classifyNauticalConditions([hour])}`}>
          <time>{time(hour.time)}</time>
          <span className="weather-hour-symbol" aria-hidden="true">{weatherSymbol(hour.weatherCode)}</span>
          <strong>{value(hour.temperatureCelsius)}°</strong>
          <span className="weather-hour-wind"><i style={{ transform: `rotate(${hour.windDirectionDegrees ?? 0}deg)` }}>↓</i>{value(hour.windSpeedKnots)} kn</span>
          <span className="weather-hour-wave">≋ {value(hour.waveHeightMetres, 1)} m</span>
          <span className="weather-hour-rain">⌁ {value(hour.precipitationProbabilityPercent)}%</span>
        </article>)}
      </div>
    </section>

    <section className="weather-details-grid">
      <article><small>{copy.swell}</small><strong>{value(selectedCurrent.swellHeightMetres, 1)} m</strong><span>{compassLabel(selectedCurrent.swellDirectionDegrees, language)} · {value(selectedCurrent.swellPeriodSeconds)} s</span></article>
      <article><small>{copy.current}</small><strong>{value(selectedCurrent.currentVelocityKnots, 1)} kn</strong><span>{compassLabel(selectedCurrent.currentDirectionDegrees, language)} · {selectedCurrent.currentVelocityKnots !== null && selectedCurrent.currentVelocityKnots < .2 ? copy.calm : ""}</span></article>
      <article><small>{hasThunder ? copy.thunder : copy.rainRisk}</small><strong>{value(maxRain)}%</strong><span>{value(maxOf(riskHours, (hour) => hour.precipitationMillimetres), 1)} mm/h {copy.max.toLowerCase()}</span></article>
      <article><small>{copy.sunrise} / {copy.sunset}</small><strong>{time(day.sunrise)}</strong><span>{time(day.sunset)}</span></article>
    </section>

    <footer className="weather-source"><span>{copy.source}</span><small>{forecast.latitude.toFixed(3)}°, {forecast.longitude.toFixed(3)}° · {copy.scope}</small></footer>
  </section>;
}
