import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNauticalWeatherRequestUrls,
  classifyNauticalConditions,
  compassLabel,
  getBestBoatingWindow,
  nauticalForecastCanBeReused,
  nauticalWeatherCellKey,
  parseNauticalWeatherForecast,
} from "../lib/nautical-weather.ts";

const times = Array.from({ length: 48 }, (_, index) => `2026-08-${index < 24 ? "15" : "16"}T${String(index % 24).padStart(2, "0")}:00`);
const constant = (value) => times.map(() => value);

const weatherPayload = {
  latitude: 43.8,
  longitude: 15.6,
  timezone: "Europe/Zagreb",
  current: {
    time: "2026-08-15T12:00",
    temperature_2m: 29,
    apparent_temperature: 31,
    precipitation_probability: 10,
    precipitation: 0,
    weather_code: 1,
    pressure_msl: 1014,
    cloud_cover: 12,
    visibility: 24000,
    wind_speed_10m: 9,
    wind_direction_10m: 315,
    wind_gusts_10m: 13,
    cape: 50,
  },
  hourly: {
    time: times,
    temperature_2m: constant(28),
    apparent_temperature: constant(30),
    precipitation_probability: constant(12),
    precipitation: constant(0),
    weather_code: constant(1),
    pressure_msl: constant(1014),
    cloud_cover: constant(15),
    visibility: constant(20000),
    wind_speed_10m: constant(8),
    wind_direction_10m: constant(315),
    wind_gusts_10m: constant(12),
    cape: constant(80),
  },
  daily: {
    time: ["2026-08-15", "2026-08-16"],
    sunrise: ["2026-08-15T05:59", "2026-08-16T06:00"],
    sunset: ["2026-08-15T19:59", "2026-08-16T19:57"],
    temperature_2m_max: [31, 30],
    temperature_2m_min: [23, 22],
    precipitation_probability_max: [20, 25],
    wind_speed_10m_max: [12, 13],
    wind_gusts_10m_max: [18, 19],
    wind_direction_10m_dominant: [320, 310],
  },
};

const marinePayload = {
  current: {
    time: "2026-08-15T12:00",
    wave_height: .35,
    wave_direction: 300,
    wave_period: 3.5,
    swell_wave_height: .15,
    swell_wave_direction: 280,
    swell_wave_period: 5,
    sea_surface_temperature: 25.8,
    ocean_current_velocity: .12,
    ocean_current_direction: 140,
  },
  hourly: {
    time: times,
    wave_height: constant(.35),
    wave_direction: constant(300),
    wave_period: constant(3.5),
    swell_wave_height: constant(.15),
    swell_wave_direction: constant(280),
    swell_wave_period: constant(5),
    sea_surface_temperature: constant(25.8),
    ocean_current_velocity: constant(.12),
    ocean_current_direction: constant(140),
  },
  daily: {
    time: ["2026-08-15", "2026-08-16"],
    wave_height_max: [.5, .6],
    wave_direction_dominant: [300, 290],
    wave_period_max: [4, 4.5],
  },
};

test("nautical requests target the local sea cell for exactly two days", () => {
  const urls = buildNauticalWeatherRequestUrls({ latitude: 43.803, longitude: 15.551 });
  const weather = new URL(urls.weather);
  const marine = new URL(urls.marine);
  assert.equal(weather.hostname, "api.open-meteo.com");
  assert.equal(marine.hostname, "marine-api.open-meteo.com");
  assert.equal(weather.searchParams.get("forecast_days"), "2");
  assert.equal(weather.searchParams.get("cell_selection"), "sea");
  assert.equal(weather.searchParams.get("wind_speed_unit"), "kn");
  assert.match(weather.searchParams.get("hourly"), /visibility/);
  assert.match(marine.searchParams.get("hourly"), /wave_height/);
  assert.match(marine.searchParams.get("hourly"), /ocean_current_velocity/);
});

test("weather and marine series are aligned into today and tomorrow", () => {
  const forecast = parseNauticalWeatherForecast(weatherPayload, marinePayload, { latitude: 43.803, longitude: 15.551 }, 1000);
  assert.ok(forecast);
  assert.equal(forecast.days.length, 2);
  assert.equal(forecast.days[0].hours.length, 24);
  assert.equal(forecast.days[1].hours.length, 24);
  assert.equal(forecast.current.windSpeedKnots, 9);
  assert.equal(forecast.current.waveHeightMetres, .35);
  assert.equal(forecast.current.visibilityKilometres, 24);
  assert.equal(forecast.current.seaSurfaceTemperatureCelsius, 25.8);
});

test("boating condition thresholds fail safely for gusts, waves, storms, and visibility", () => {
  const forecast = parseNauticalWeatherForecast(weatherPayload, marinePayload, { latitude: 43.8, longitude: 15.6 });
  const base = forecast.days[0].hours[12];
  assert.equal(classifyNauticalConditions([base]), "good");
  assert.equal(classifyNauticalConditions([{ ...base, windGustKnots: 22 }]), "caution");
  assert.equal(classifyNauticalConditions([{ ...base, waveHeightMetres: 1.6 }]), "danger");
  assert.equal(classifyNauticalConditions([{ ...base, weatherCode: 95 }]), "danger");
  assert.equal(classifyNauticalConditions([{ ...base, visibilityKilometres: 1.8 }]), "danger");
});

test("best boating window remains inside daylight and cached data stays local", () => {
  const forecast = parseNauticalWeatherForecast(weatherPayload, marinePayload, { latitude: 43.803, longitude: 15.551 }, 1_000);
  const window = getBestBoatingWindow(forecast.days[0]);
  assert.ok(window);
  assert.ok(Number(window.start.slice(11, 13)) >= 6);
  assert.ok(Number(window.end.slice(11, 13)) <= 19);
  assert.equal(nauticalForecastCanBeReused(forecast, forecast.cellKey, 1_000 + 6 * 60 * 60 * 1_000), true);
  assert.equal(nauticalForecastCanBeReused(forecast, forecast.cellKey, 1_001 + 6 * 60 * 60 * 1_000), false);
  assert.equal(nauticalForecastCanBeReused(forecast, "43.90:15.60", 2_000), false);
  assert.equal(nauticalWeatherCellKey({ latitude: 43.803, longitude: 15.551 }), "43.80:15.56");
});

test("compass labels are localized", () => {
  assert.equal(compassLabel(45, "de"), "NO");
  assert.equal(compassLabel(45, "en"), "NE");
  assert.equal(compassLabel(null, "de"), "—");
});
