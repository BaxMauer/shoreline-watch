# Shoreline Watch open work

This is the prioritized working backlog. Check an item only when its acceptance
criteria are met on `main` and, where applicable, verified in production.

Last reviewed: 2026-08-13

## P0 — Delivery and safety baseline

- [ ] **CI is required before merge.**
  - Acceptance: every pull request runs lint, typecheck, tests, a production
    build, and artifact validation; failed or missing checks prevent merge.
  - Workflow complete: pull requests run all required validation plus a
    production dependency audit.
  - Blocked: GitHub must enforce the required check through the `main` ruleset;
    see `.github/REPOSITORY_SETTINGS.md`.
- [ ] **Successful `main` builds deploy automatically to the existing Site.**
  - Acceptance: a successful CI run on `main` creates an immutable production
    candidate, deploys it to Sites without manual source handling, and verifies
    the resulting production status and URL.
  - In progress: GitHub packages and marks the exact candidate with an immutable
    provenance manifest. The hourly Sites deployment watch now synchronizes the
    verified artifact into the Sites lifecycle checkout before checkpointing;
    acceptance remains open until a newer candidate has completed that path
    automatically in production.
- [ ] **Repository merge policy is enforced.**
  - Acceptance: required checks are configured, auto-merge is enabled, direct
    unverified changes to `main` are prevented, and merged branches are deleted.
  - Blocked: the installed GitHub integration cannot mutate repository settings,
    and the current private-repository plan rejects ruleset creation. The exact
    owner settings are recorded in `.github/REPOSITORY_SETTINGS.md`.
- [x] **Weak GPS accuracy cannot produce `GO`.**
  - Acceptance: fixes worse than the agreed accuracy threshold produce an
    explicit unknown/check state in both distance and route modes, with boundary
    tests around the threshold.
- [x] **Stale GPS cannot produce `ROUTE READY`.**
  - Acceptance: route calculation and readiness are gated by fresh, sufficiently
    accurate GPS, with stale/recovery regression tests.
- [x] **Navigation claims match the data model.**
  - Acceptance: `GO`, `NO-GO`, and route copy are explicitly limited to
    shoreline geometry and clearance; the UI does not imply knowledge of depth,
    rocks, traffic, buoys, channels, weather, or legal restrictions.
- [x] **All route lengths receive shoreline validation.**
  - Acceptance: short direct routes and generated detours use the same exact or
    conservatively sampled crossing and minimum-clearance checks.

## P1 — Reliable navigation on iPhone

- [ ] Move route computation off the UI thread, preferably into a Web Worker,
  and cover cancellation plus stale-result handling.
- [ ] Replace the first-point-ahead bearing heuristic with progress-aware route
  projection so guidance cannot point backward after a passed waypoint.
- [ ] Tighten start snapping: require trustworthy accuracy and remove the
  unconditional 120 m correction allowance.
- [ ] Make auto-rerouting independent of high-frequency GPS effect resets.
- [x] Reacquire Wake Lock after visibility changes or a system release.
- [ ] Replace forced service-worker activation/reload with a user-safe update
  flow that cannot interrupt an active trip.
- [ ] Make offline-ready status reflect actual service-worker registration,
  cache completion, and persistent-storage outcome.
- [ ] Prevent hidden route-map work while the distance tab is active.
- [ ] Reduce startup and render cost from the large coastline dataset; measure
  parse time, memory, and map interaction on representative iPhones.
- [ ] Review alarm state recovery after GPS loss and prevent clipped/distorted
  audio at the current 200% gain setting.

## P1 — Route confidence and test depth

- [ ] Build a golden route dataset across Croatian regions, harbors, island
  chains, and narrow passages, including expected rejection cases.
- [ ] Add property and boundary tests for crossings, minimum clearance, snapping,
  GPS freshness, accuracy, hysteresis, and route progress.
- [ ] Add browser E2E coverage for mobile WebKit, simulated GPS, offline install,
  cache/update behavior, and alarm recovery.
- [ ] Maintain a real-device field checklist for supported iPhone/iOS versions.
- [ ] Validate heading quality before presenting course-to-shore guidance.
- [ ] Ensure map simplification cannot visually hide relevant nearby coastline.

## P2 — Data and maintainability

- [ ] Make coastline refreshes reproducible with pinned source snapshots,
  checksums, retries, and per-region validation instead of relying only on live
  upstream services.
- [ ] Add a data schema/version/hash check between the service worker, cached
  assets, and application code.
- [ ] Replace atomic caching of the full large dataset with a resilient update
  strategy and test partial-download recovery.
- [x] Make build/test helpers portable to macOS or clearly separate Linux-only
  CI wrappers from developer commands.
- [x] Add dependency update and security scanning with an explicit policy for
  blocking vulnerabilities.
- [ ] Split the largest UI and routing modules after the safety behavior is
  covered by tests.
- [ ] Remove unused starter/auth/database/example assets and dependencies.
- [x] Update the README to describe routing, current safety scope, offline
  behavior, validation commands, CI, and deployment.
- [ ] Add repository metadata and make a deliberate code-license decision.
  - Metadata values are prepared in `.github/REPOSITORY_SETTINGS.md`, but the
    installed integration cannot apply them.
  - The source-code license remains an owner decision and is intentionally not
    inferred from the coastline data attribution.

## Working rule

For each item: create a focused branch, add or update tests where practical,
run the repository validation commands, open a pull request, allow merge only
after required checks pass, and verify production after deployment.
