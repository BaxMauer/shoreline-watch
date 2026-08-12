# Shoreline Watch

An installable, frontend-only web app that calculates the live distance from a phone's GPS position to the nearest Croatian shoreline. Once loaded, the position processing, coastline lookup, speed-zone check, and alarms run locally on the device.

## Current prototype

- high-accuracy live GPS tracking through `watchPosition()`
- official Croatian coastline data from the Hydrographic Institute of the Republic of Croatia (HHI)
- 270,000 indexed coastline segments covering all seven coastal counties
- conservative warnings that subtract reported GPS accuracy from measured distance
- Croatian vessel-distance presets: under 15 m, 15–30 m, and 30 m+
- 8-knot coastal-zone warning inside 300 m
- audio and supported-device vibration alerts
- screen wake lock request during live tracking
- service-worker caching for offline use
- an eight-step Murter demo that exercises safe, speed, proximity, and critical states

This is a prototype aid, not an approved navigation chart. It does not infer ports, anchorages, designated bathing zones, constrained channels, or regulatory exceptions.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Browser geolocation requires HTTPS except on `localhost`.

## Build and test

```bash
npm run lint
npm test
```

## Refresh the coastline pack

```bash
node tools/build-coastline.mjs
```

The build tool downloads each coastal county from HHI's public WFS or feature service, simplifies the geometry to a three-metre tolerance, divides segments into a small spatial grid, and writes `public/data/croatia-coastline.json`.

Source attribution: Coastline © Hydrographic Institute of the Republic of Croatia (HHI). HHI states that its public coastline may be used without restriction when the source is indicated.

## Structure

```text
app/shoreline-app.tsx          Live interface and warning state
lib/shoreline.ts               Nearest-segment calculation
tools/build-coastline.mjs      HHI data preparation
public/data/                   Generated offline coastline pack
public/sw.js                   Offline cache
tests/shoreline.test.mjs       Geometry and dataset checks
```
