import type { GeoPoint } from "./route-planning.ts";

export type NauticalConditionLevel = "good" | "caution" | "danger";

export type NauticalWeatherMetric =
  | "temperature"
  | "wind"
  | "gusts"
  | "waves"
  | "rain"
  | "visibility"
  | "pressure"
  | "seaTemperature"
  | "current";

export type NauticalWeatherHour = {
  time: string;
  temperatureCelsius: number | null;
  apparentTemperatureCelsius: number | null;
  weatherCode: number | null;
  precipitationProbabilityPercent: number | null;
  precipitationMillimetres: number | null;
  visibilityKilometres: number | null;
  pressureHpa: number | null;
  cloudCoverPercent: number | null;
  cape: number | null;
  windSpeedKnots: number | null;
  windDirectionDegrees: number | null;
  windGustKnots: number | null;
  waveHeightMetres: number | null;
  waveDirectionDegrees: number | null;
  wavePeriodSeconds: number | null;
  swellHeightMetres: number | null;
  swellDirectionDegrees: number | null;
  swellPeriodSeconds: number | null;
  seaSurfaceTemperatureCelsius: number | null;
  currentVelocityKnots: number | null;
  currentDirectionDegrees: number | null;
};

export type NauticalWeatherDay = {
  date: string;
  sunrise: string | null;
  sunset: string | null;
  temperatureMaxCelsius: number | null;
  temperatureMinCelsius: number | null;
  precipitationProbabilityMaxPercent: number | null;
  windSpeedMaxKnots: number | null;
  windGustMaxKnots: number | null;
  dominantWindDirectionDegrees: number | null;
  waveHeightMaxMetres: number | null;
  dominantWaveDirectionDegrees: number | null;
  wavePeriodMaxSeconds: number | null;
  hours: NauticalWeatherHour[];
};

export type NauticalWeatherForecast = {
  latitude: number;
  longitude: number;
  timezone: string;
  cellKey: string;
  fetchedAt: number;
  current: NauticalWeatherHour | null;
  days: NauticalWeatherDay[];
};

export type NauticalWeatherMapLocation = {
  latitude: number;
  longitude: number;
  hours: NauticalWeatherHour[];
};

export type NauticalWeatherMapForecast = {
  cellKey: string;
  fetchedAt: number;
  locations: NauticalWeatherMapLocation[];
};

export type WeatherChartPoint = {
  index: number;
  time: string;
  value: number;
  x: number;
  y: number;
};

export type WeatherChartModel = {
  points: WeatherChartPoint[];
  linePath: string;
  areaPath: string;
  minimum: number;
  maximum: number;
};

type RecordValue = Record<string, unknown>;

const WEATHER_HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "pressure_msl",
  "cloud_cover",
  "visibility",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cape",
].join(",");

const MARINE_HOURLY = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "sea_surface_temperature",
  "ocean_current_velocity",
  "ocean_current_direction",
].join(",");

const MAP_WEATHER_HOURLY = [
  "temperature_2m",
  "precipitation_probability",
  "pressure_msl",
  "visibility",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
].join(",");

const MAP_MARINE_HOURLY = [
  "wave_height",
  "wave_direction",
  "sea_surface_temperature",
  "ocean_current_velocity",
  "ocean_current_direction",
].join(",");

export function nauticalWeatherCellKey(point: GeoPoint) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return `${(Math.round(point.latitude * 50) / 50).toFixed(2)}:${(Math.round(point.longitude * 50) / 50).toFixed(2)}`;
}

export function buildNauticalWeatherRequestUrls(point: GeoPoint) {
  const shared = {
    latitude: point.latitude.toFixed(5),
    longitude: point.longitude.toFixed(5),
    timezone: "auto",
    forecast_days: "2",
    cell_selection: "sea",
  };
  const weather = new URLSearchParams({
    ...shared,
    current: WEATHER_HOURLY,
    hourly: WEATHER_HOURLY,
    daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
    wind_speed_unit: "kn",
  });
  const marine = new URLSearchParams({
    ...shared,
    current: MARINE_HOURLY,
    hourly: MARINE_HOURLY,
    daily: "wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max,swell_wave_direction_dominant,swell_wave_period_max",
    length_unit: "metric",
    velocity_unit: "kn",
  });
  return {
    weather: `https://api.open-meteo.com/v1/forecast?${weather}`,
    marine: `https://marine-api.open-meteo.com/v1/marine?${marine}`,
  };
}

export function buildNauticalWeatherMapGrid(point: GeoPoint) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return [];
  const latitudeStep = 0.06;
  const longitudeStep = 0.08;
  return Array.from({ length: 25 }, (_, index) => {
    const row = Math.floor(index / 5) - 2;
    const column = index % 5 - 2;
    return {
      latitude: Number((point.latitude + row * latitudeStep).toFixed(5)),
      longitude: Number((point.longitude + column * longitudeStep).toFixed(5)),
    };
  });
}

export function buildNauticalWeatherMapRequestUrls(point: GeoPoint) {
  const grid = buildNauticalWeatherMapGrid(point);
  if (!grid.length) return null;
  const shared = {
    latitude: grid.map((entry) => entry.latitude.toFixed(5)).join(","),
    longitude: grid.map((entry) => entry.longitude.toFixed(5)).join(","),
    timezone: "Europe/Zagreb",
    forecast_days: "2",
    cell_selection: "sea",
  };
  const weather = new URLSearchParams({ ...shared, hourly: MAP_WEATHER_HOURLY, wind_speed_unit: "kn" });
  const marine = new URLSearchParams({ ...shared, hourly: MAP_MARINE_HOURLY, length_unit: "metric", velocity_unit: "kn" });
  return {
    weather: `https://api.open-meteo.com/v1/forecast?${weather}`,
    marine: `https://marine-api.open-meteo.com/v1/marine?${marine}`,
  };
}

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" ? value as RecordValue : null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finite(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function at(values: RecordValue | null, key: string, index: number) {
  const list = values?.[key];
  return Array.isArray(list) ? finite(list[index]) : null;
}

function textAt(values: RecordValue | null, key: string, index: number) {
  const list = values?.[key];
  return Array.isArray(list) && typeof list[index] === "string" ? list[index] : null;
}

function normalizeDegrees(value: number | null) {
  return value === null ? null : ((value % 360) + 360) % 360;
}

function buildHour(time: string, weather: RecordValue | null, weatherIndex: number, marine: RecordValue | null, marineIndex: number): NauticalWeatherHour {
  return {
    time,
    temperatureCelsius: at(weather, "temperature_2m", weatherIndex),
    apparentTemperatureCelsius: at(weather, "apparent_temperature", weatherIndex),
    weatherCode: at(weather, "weather_code", weatherIndex),
    precipitationProbabilityPercent: at(weather, "precipitation_probability", weatherIndex),
    precipitationMillimetres: at(weather, "precipitation", weatherIndex),
    visibilityKilometres: (() => { const value = at(weather, "visibility", weatherIndex); return value === null ? null : value / 1_000; })(),
    pressureHpa: at(weather, "pressure_msl", weatherIndex),
    cloudCoverPercent: at(weather, "cloud_cover", weatherIndex),
    cape: at(weather, "cape", weatherIndex),
    windSpeedKnots: at(weather, "wind_speed_10m", weatherIndex),
    windDirectionDegrees: normalizeDegrees(at(weather, "wind_direction_10m", weatherIndex)),
    windGustKnots: at(weather, "wind_gusts_10m", weatherIndex),
    waveHeightMetres: at(marine, "wave_height", marineIndex),
    waveDirectionDegrees: normalizeDegrees(at(marine, "wave_direction", marineIndex)),
    wavePeriodSeconds: at(marine, "wave_period", marineIndex),
    swellHeightMetres: at(marine, "swell_wave_height", marineIndex),
    swellDirectionDegrees: normalizeDegrees(at(marine, "swell_wave_direction", marineIndex)),
    swellPeriodSeconds: at(marine, "swell_wave_period", marineIndex),
    seaSurfaceTemperatureCelsius: at(marine, "sea_surface_temperature", marineIndex),
    currentVelocityKnots: at(marine, "ocean_current_velocity", marineIndex),
    currentDirectionDegrees: normalizeDegrees(at(marine, "ocean_current_direction", marineIndex)),
  };
}

function buildCurrent(weather: RecordValue | null, marine: RecordValue | null): NauticalWeatherHour | null {
  const time = typeof weather?.time === "string" ? weather.time : typeof marine?.time === "string" ? marine.time : null;
  if (!time) return null;
  const currentWeather = Object.fromEntries(Object.entries(weather ?? {}).map(([key, value]) => [key, [value]]));
  const currentMarine = Object.fromEntries(Object.entries(marine ?? {}).map(([key, value]) => [key, [value]]));
  return buildHour(time, currentWeather, 0, currentMarine, 0);
}

export function parseNauticalWeatherForecast(weatherPayload: unknown, marinePayload: unknown, point: GeoPoint, fetchedAt = Date.now()): NauticalWeatherForecast | null {
  const weatherRoot = record(weatherPayload);
  const marineRoot = record(marinePayload);
  const weatherHourly = record(weatherRoot?.hourly);
  const marineHourly = record(marineRoot?.hourly);
  const weatherTimes = strings(weatherHourly?.time);
  if (weatherTimes.length === 0) return null;
  const marineTimes = strings(marineHourly?.time);
  const marineIndices = new Map(marineTimes.map((time, index) => [time, index]));
  const hours = weatherTimes.map((time, index) => buildHour(time, weatherHourly, index, marineHourly, marineIndices.get(time) ?? -1));
  const weatherDaily = record(weatherRoot?.daily);
  const marineDaily = record(marineRoot?.daily);
  const dates = strings(weatherDaily?.time).slice(0, 2);
  if (dates.length === 0) return null;
  const days = dates.map((date, index): NauticalWeatherDay => ({
    date,
    sunrise: textAt(weatherDaily, "sunrise", index),
    sunset: textAt(weatherDaily, "sunset", index),
    temperatureMaxCelsius: at(weatherDaily, "temperature_2m_max", index),
    temperatureMinCelsius: at(weatherDaily, "temperature_2m_min", index),
    precipitationProbabilityMaxPercent: at(weatherDaily, "precipitation_probability_max", index),
    windSpeedMaxKnots: at(weatherDaily, "wind_speed_10m_max", index),
    windGustMaxKnots: at(weatherDaily, "wind_gusts_10m_max", index),
    dominantWindDirectionDegrees: normalizeDegrees(at(weatherDaily, "wind_direction_10m_dominant", index)),
    waveHeightMaxMetres: at(marineDaily, "wave_height_max", index),
    dominantWaveDirectionDegrees: normalizeDegrees(at(marineDaily, "wave_direction_dominant", index)),
    wavePeriodMaxSeconds: at(marineDaily, "wave_period_max", index),
    hours: hours.filter((hour) => hour.time.startsWith(`${date}T`)),
  }));
  const key = nauticalWeatherCellKey(point);
  if (!key) return null;
  return {
    latitude: finite(weatherRoot?.latitude) ?? point.latitude,
    longitude: finite(weatherRoot?.longitude) ?? point.longitude,
    timezone: typeof weatherRoot?.timezone === "string" ? weatherRoot.timezone : "auto",
    cellKey: key,
    fetchedAt,
    current: buildCurrent(record(weatherRoot?.current), record(marineRoot?.current)),
    days,
  };
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((entry): entry is RecordValue => entry !== null) : record(value) ? [record(value) as RecordValue] : [];
}

export function parseNauticalWeatherMapForecast(weatherPayload: unknown, marinePayload: unknown, point: GeoPoint, fetchedAt = Date.now()): NauticalWeatherMapForecast | null {
  const weatherLocations = records(weatherPayload);
  const marineLocations = records(marinePayload);
  const key = nauticalWeatherCellKey(point);
  if (!key || weatherLocations.length === 0) return null;
  const locations = weatherLocations.flatMap((weatherRoot, locationIndex): NauticalWeatherMapLocation[] => {
    const weatherHourly = record(weatherRoot.hourly);
    const times = strings(weatherHourly?.time);
    if (!times.length) return [];
    const marineRoot = marineLocations[locationIndex] ?? null;
    const marineHourly = record(marineRoot?.hourly);
    const marineTimes = strings(marineHourly?.time);
    const marineIndices = new Map(marineTimes.map((time, index) => [time, index]));
    const latitude = finite(weatherRoot.latitude) ?? finite(marineRoot?.latitude);
    const longitude = finite(weatherRoot.longitude) ?? finite(marineRoot?.longitude);
    if (latitude === null || longitude === null) return [];
    return [{
      latitude,
      longitude,
      hours: times.map((time, index) => buildHour(time, weatherHourly, index, marineHourly, marineIndices.get(time) ?? -1)),
    }];
  });
  return locations.length ? { cellKey: key, fetchedAt, locations } : null;
}

export function nauticalWeatherMetricValue(hour: NauticalWeatherHour, metric: NauticalWeatherMetric) {
  switch (metric) {
    case "temperature": return hour.temperatureCelsius;
    case "wind": return hour.windSpeedKnots;
    case "gusts": return hour.windGustKnots;
    case "waves": return hour.waveHeightMetres;
    case "rain": return hour.precipitationProbabilityPercent;
    case "visibility": return hour.visibilityKilometres;
    case "pressure": return hour.pressureHpa;
    case "seaTemperature": return hour.seaSurfaceTemperatureCelsius;
    case "current": return hour.currentVelocityKnots;
  }
}

export function buildWeatherChartModel(hours: NauticalWeatherHour[], metric: NauticalWeatherMetric, width = 320, height = 132): WeatherChartModel | null {
  const values = hours.map((hour, index) => ({ index, time: hour.time, value: nauticalWeatherMetricValue(hour, metric) }))
    .filter((entry): entry is { index: number; time: string; value: number } => entry.value !== null && Number.isFinite(entry.value));
  if (!values.length || width <= 0 || height <= 0) return null;
  const rawMinimum = Math.min(...values.map((entry) => entry.value));
  const rawMaximum = Math.max(...values.map((entry) => entry.value));
  const span = Math.max(rawMaximum - rawMinimum, Math.max(Math.abs(rawMaximum), 1) * 0.08);
  const minimum = rawMinimum - span * 0.12;
  const maximum = rawMaximum + span * 0.12;
  const plotLeft = 10;
  const plotRight = width - 10;
  const plotTop = 10;
  const plotBottom = height - 18;
  const lastIndex = Math.max(hours.length - 1, 1);
  const points = values.map((entry) => ({
    ...entry,
    x: plotLeft + entry.index / lastIndex * (plotRight - plotLeft),
    y: plotBottom - (entry.value - minimum) / (maximum - minimum) * (plotBottom - plotTop),
  }));
  const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${points.at(-1)?.x.toFixed(2)},${plotBottom} L${points[0].x.toFixed(2)},${plotBottom} Z`;
  return { points, linePath, areaPath, minimum: rawMinimum, maximum: rawMaximum };
}

export function findWeatherMapHour(location: NauticalWeatherMapLocation, time: string) {
  return location.hours.find((hour) => hour.time === time) ?? null;
}

export function nauticalWeatherMapCanBeReused(forecast: NauticalWeatherMapForecast, cellKey: string | null, now = Date.now()) {
  return forecast.cellKey === cellKey && Number.isFinite(forecast.fetchedAt) && now >= forecast.fetchedAt && now - forecast.fetchedAt <= 3 * 60 * 60 * 1_000;
}

function max(values: Array<number | null>) {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finiteValues.length ? Math.max(...finiteValues) : null;
}

function min(values: Array<number | null>) {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finiteValues.length ? Math.min(...finiteValues) : null;
}

export function classifyNauticalConditions(hours: NauticalWeatherHour[]): NauticalConditionLevel {
  const gust = max(hours.map((hour) => hour.windGustKnots));
  const wind = max(hours.map((hour) => hour.windSpeedKnots));
  const wave = max(hours.map((hour) => hour.waveHeightMetres));
  const visibility = min(hours.map((hour) => hour.visibilityKilometres));
  const precipitation = max(hours.map((hour) => hour.precipitationProbabilityPercent));
  const thunderstorm = hours.some((hour) => hour.weatherCode !== null && hour.weatherCode >= 95);
  if (thunderstorm || (gust !== null && gust >= 30) || (wind !== null && wind >= 25) || (wave !== null && wave >= 1.5) || (visibility !== null && visibility < 2)) return "danger";
  if ((gust !== null && gust >= 20) || (wind !== null && wind >= 15) || (wave !== null && wave >= .8) || (visibility !== null && visibility < 5) || (precipitation !== null && precipitation >= 60)) return "caution";
  return "good";
}

export function getBestBoatingWindow(day: NauticalWeatherDay) {
  const sunriseHour = Number(day.sunrise?.slice(11, 13) ?? 6);
  const sunsetHour = Number(day.sunset?.slice(11, 13) ?? 21);
  const daylight = day.hours.filter((hour) => {
    const value = Number(hour.time.slice(11, 13));
    return value >= Math.max(6, sunriseHour) && value <= Math.min(20, sunsetHour - 1);
  });
  if (daylight.length < 3) return null;
  let best: { start: string; end: string; score: number; level: NauticalConditionLevel } | null = null;
  for (let index = 0; index <= daylight.length - 3; index += 1) {
    const hours = daylight.slice(index, index + 3);
    const level = classifyNauticalConditions(hours);
    const score = hours.reduce((sum, hour) => sum
      + (hour.windSpeedKnots ?? 8) * 1.2
      + (hour.windGustKnots ?? 10) * .7
      + (hour.waveHeightMetres ?? .35) * 20
      + (hour.precipitationProbabilityPercent ?? 20) * .18
      + (hour.weatherCode !== null && hour.weatherCode >= 95 ? 80 : 0), 0);
    if (!best || score < best.score) best = { start: hours[0].time, end: hours.at(-1)?.time ?? hours[0].time, score, level };
  }
  return best;
}

export function nauticalForecastCanBeReused(forecast: NauticalWeatherForecast, cellKey: string | null, now = Date.now()) {
  return forecast.cellKey === cellKey && Number.isFinite(forecast.fetchedAt) && now >= forecast.fetchedAt && now - forecast.fetchedAt <= 6 * 60 * 60 * 1_000;
}

export function compassLabel(directionDegrees: number | null, language: "de" | "en") {
  if (directionDegrees === null) return "—";
  const labels = language === "de" ? ["N", "NO", "O", "SO", "S", "SW", "W", "NW"] : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(directionDegrees / 45) % 8];
}
