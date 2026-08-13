# Shoreline Watch

Shoreline Watch is an installable, offline-first web app for iPhone and other
modern browsers. It calculates live distance to the Croatian shoreline and can
plan a water-only route against the bundled coastline geometry. Position
processing, distance lookup, route calculation, speed-zone estimates, and
alarms run locally after the app and coastline pack have loaded.

Production: [boot.maxi-bauer.de](https://boot.maxi-bauer.de)

## Capabilities

- high-accuracy live GPS tracking through `watchPosition()`;
- roughly 270,000 indexed coastline segments across Croatia's seven coastal
  counties;
- conservative shoreline alarms that account for reported GPS accuracy and use
  hysteresis to avoid repeated threshold chatter;
- offline route planning up to 120 km, including shoreline-crossing rejection,
  preferred clearance, estimated time, and near-shore speed estimates;
- tap, coordinate, drag, pinch, wheel, keyboard, and recenter controls for the
  offline route map;
- audible and supported-device vibration alerts, screen Wake Lock, and a
  power-saving display mode;
- an installable service worker and cached application shell for offline use;
- German and English user interfaces plus a repeatable Murter demo.

## Safety boundary

This is a prototype aid, not an approved navigation chart. `GO`, `NO-GO`, route
clearance, and route readiness currently describe only the bundled shoreline
geometry and configured clearance. They do not establish safe depth or account
for rocks, traffic, buoys, channels, weather, temporary restrictions, or legal
requirements. See [OPEN_POINTS.md](OPEN_POINTS.md) for the remaining safety and
field-validation work.

## Local development

Requirements: Node.js 22.13 or newer and `curl`. Browser geolocation requires
HTTPS except on `localhost`.

```bash
npm ci
npm run dev
```

The bounded install and build helpers also work on macOS; they no longer depend
on Linux-only `flock`, GNU `timeout`, or `sha256sum` commands.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run audit:production
npm run audit:all
```

`npm test` creates and validates the production Sites artifact before running
the complete Node test suite. `npm run validate:artifact` can validate an
existing `dist` directory separately. The dependency policy and narrowly scoped
build-tool exceptions are documented in [SECURITY.md](SECURITY.md).

## CI and deployment

Delivery is deliberately split across GitHub and OpenAI Sites:

1. Pull requests run lint, typecheck, tests, artifact validation, and a blocking
   production dependency audit in GitHub Actions.
2. A successful `CI` run on `main` starts the `Production candidate` workflow.
   It checks out the exact verified commit, rebuilds it, and publishes immutable
   source/build archives plus a provenance manifest.
3. The Shoreline deployment watch accepts only the newest successful,
   non-superseded candidate from `main`, saves that exact source as a Sites
   version, deploys it to the existing Site, and verifies the terminal status.

The source gate and candidate packaging therefore run on GitHub. The final
production action is performed through Sites rather than a GitHub-hosted secret,
because Sites currently provides session-scoped source credentials instead of a
durable deployment credential suitable for repository secrets. Required
repository controls are listed in
[.github/REPOSITORY_SETTINGS.md](.github/REPOSITORY_SETTINGS.md).

## Refresh the coastline pack

```bash
node tools/build-coastline.mjs
```

The build tool downloads each coastal county from the Hydrographic Institute of
the Republic of Croatia (HHI), simplifies geometry to a three-metre tolerance,
indexes the segments, and writes `public/data/croatia-coastline.json`.

Source attribution: Coastline © Hydrographic Institute of the Republic of
Croatia (HHI). HHI states that its public coastline may be used without
restriction when the source is indicated.

## Structure

```text
app/shoreline-app.tsx          Live distance, alarms, GPS, and offline state
app/route-planner.tsx          Route planning and map interaction
lib/shoreline.ts               Indexed nearest-shoreline calculation
lib/route-planning.ts          Water-route search and validation
public/data/                   Generated offline coastline pack
public/sw.js                   Offline cache lifecycle
scripts/                       Portable CI, audit, packaging, and build helpers
tools/build-coastline.mjs      HHI data preparation
tests/                         Geometry, routing, PWA, UI, and delivery tests
```
