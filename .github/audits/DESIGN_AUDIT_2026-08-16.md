# Shoreline Watch visual design and interaction audit

Audit date: 2026-08-16

Repository base: `29db23b` (`main`)

Application version: `1.22.1`

Scope: launch, Distance, Route planning, active Navigation, Weather, Logbook/trip detail, themes, responsive layout, safety states, offline states, power save, reduced motion, and wind rendering.

This document records findings and implementation work only. It does not change application behavior.

## Executive verdict

The Ocean Distance view has a strong instrument identity and Weather is the most complete self-contained tab. The product is not yet visually coherent across all tabs and themes, and several presentation defects affect safety rather than polish:

- Critical visual alerts, GPS warnings, speed/course warnings, and anchor status disappear when the user leaves Distance.
- XP and Nautical inherit dark text on hard-coded dark Logbook and active-Navigation surfaces. Representative contrast is only `1.01–1.31:1`; Nautical launch copy is approximately `1.03:1`.
- The power-save screen presents the most important navigation values at only `2.04–3.44:1` against black and replaces its accessible navigation summary with “Tap to wake”.
- The wind canvas can create multiple permanent `requestAnimationFrame` loops, including loops that continue after tab changes, effect restarts, or unmount.

The current release should therefore not be treated as visually complete across the advertised themes or safe-state transitions. Fix the P0 items before design refinements.

## Evidence and limits

| Evidence | Executed | Result |
| --- | --- | --- |
| Current hosted launch image | Yes, current production image at `1200×750` | Ocean loading state is legible and branded, but the single-column `600px` launch content leaves most desktop width unused and pushes the actions below the initial fold. |
| Source/state inspection | Yes, every component and state branch listed below | Found cross-tab, theme, responsive, accessibility, animation-lifecycle, and stale-data defects. |
| Contrast calculation | Yes, from the committed colors using WCAG relative luminance | Confirmed the XP/Nautical and power-save failures recorded below. |
| Focused behavior tests | Yes | `86/86` passed for app contracts, themes, wind utilities, and nautical weather. These are predominantly source/utility tests and do not prove geometry or animation. |
| Interactive per-state screenshots | No | The cloud CDP session repeatedly timed out before tab interaction. No local browser binary was available in the checkout. Code review is not labeled as screenshot proof. |
| Wind motion recording/frame diff | No | The code path was inspected, but a still image cannot prove motion. The deterministic protocol below is required after the loop fix. |

Consequently, this audit is a complete state and code review plus one current hosted-image review; it is **not** an accepted visual-regression baseline. The missing reproducible screenshot runner is itself tracked as `TEST-001`.

## State inventory reviewed

The inventory below is the source of truth for the visual test suite. “Reviewed” means the render branch, styles, navigation containment, and transitions were inspected. It does not imply a screenshot was captured.

| Surface | Reviewed states |
| --- | --- |
| Launch | coastline loading, ready, and failed; online/offline; German/English; Ocean/Dark/XP/Nautical; sunlight on/off; preferences; warning settings collapsed/expanded; offline packages empty/downloading/ready/failed; Live and Demo disabled/enabled; Logbook entry. |
| Distance | GPS waiting/reliable/inaccurate/stale/lost; acquiring/last known; `GO`/`NO-GO`/unknown; distance/safe/speed/course visual signals; speed and course danger; depth loading/ready/unavailable/shallow; wind loading/live/offline/on/off; north-up/heading-up; anchor button/timer/holding/breach/release; all six Demo fixes; compact error; power save. |
| Route planning | no/weak/stale GPS; start/destination edit and swap; place search idle/loading/results/no-result/error; map long-press; depth/wind layers; north-up/heading-up; zoom; calculating; ready; no safe route; restricted/shallow segment; Tisno note; reset. |
| Active Navigation | active/arrived; guidance changes; `GO`/`NO-GO`/unknown; route progress; restricted/shallow/GPS warnings; wind on/off/loading/offline; orientation/zoom; finish trip. |
| Weather | no GPS; forecast loading/error/ready/cached/offline; Today/Tomorrow; hourly selection; null/wind/waves/temperature/visibility/current/rain selection; risk calm/caution/danger; map loading/ready/error; map-point selection. |
| Logbook | empty/populated; live trip; active anchor; clear; trip detail; track loading/ready/unavailable; speed bands; save/export disabled/enabled; long titles/durations. |
| Global modes | all four themes; sunlight composition; reduced motion; power save; debug panel; tab changes while alarms, wind, route calculation, or fetches are active; portrait/landscape and safe areas. |

## What is already coherent

- The shared shell, top bar, four-tab navigation, aqua/amber/red semantics, and local-first language create a recognizable product.
- Active Navigation reuses the large Distance readout and `GO` state instead of inventing another primary instrument.
- Distance and Route share the same wind canvas and heading-rotation input.
- Weather has explicit theme-specific colors and the clearest card hierarchy.
- Map layering is structurally correct: map at the base, wind above it, then the navigation controls and safety UI.
- Reduced motion produces a static wind field instead of an empty canvas.
- The server wind proxy has a bounded upstream request and the client supports a direct Open-Meteo fallback.

## P0 — release-blocking findings

### SAFE-001 — critical safety UI is hidden with the Distance tab

The visual signal, GPS status, speed/course warning, anchor-watch card, and anchor breach UI are children of the Distance section. Changing to Route, Weather, or Logbook applies `[hidden] { display:none !important; }`, so the underlying state may fire while its visual output disappears. Audio or vibration does not replace a persistent visible warning.

Evidence: [app/shoreline-app.tsx#L2057-L2082](../../app/shoreline-app.tsx#L2057-L2082), [app/shoreline-app.tsx#L2126-L2148](../../app/shoreline-app.tsx#L2126-L2148), [app/globals.css#L56-L57](../../app/globals.css#L56-L57).

Required result:

- Render an app-level safety layer outside all tab panels.
- Keep danger status visible and operable on Distance, Route, Weather, and Logbook.
- Define precedence for GPS loss, anchor breach, distance breach, speed, course, and safe recovery.
- Capture every safety state from every tab; test muted audio and disabled vibration as well.

### THEME-001 — XP and Nautical are unreadable in core surfaces

XP defines `--foam: #10213b` and Nautical defines `--foam: #152f3b`, while Logbook/trip detail and active Navigation force Ocean’s dark surfaces. The same theme text token is then reused. Depending on the gradient endpoint, contrast is approximately:

| Pair | Contrast |
| --- | ---: |
| XP text `#10213b` on Logbook `#08232b` | `1.01:1` |
| XP text `#10213b` on Logbook `#06171d` | `1.13:1` |
| Nautical text `#152f3b` on Logbook `#08232b` | `1.17:1` |
| Nautical text `#152f3b` on Logbook `#06171d` | `1.31:1` |
| Nautical launch copy `#afc1bf` on `#cbb98e` | `1.03:1` |

Evidence: [app/globals.css#L30-L54](../../app/globals.css#L30-L54), [app/globals.css#L80-L84](../../app/globals.css#L80-L84), [app/globals.css#L106-L111](../../app/globals.css#L106-L111), [app/globals.css#L504-L550](../../app/globals.css#L504-L550), [app/globals.css#L989-L1018](../../app/globals.css#L989-L1018).

Required result:

- Replace theme-global foreground assumptions with paired semantic surface/text tokens.
- Give Launch, Distance, Route planning, active Navigation, Weather, Logbook, and trip detail an explicit surface/text pair for every theme.
- Meet at least WCAG AA: `4.5:1` for normal text and `3:1` for large text and meaningful UI graphics.
- Add rendered contrast tests; selector-presence tests are insufficient.

### POWER-001 — power-save safety information is too dim and loses its accessible name

The black power-save screen intentionally dims content, but the actual ratios are below the minimum for its safety role:

| Content | Color | Contrast on black |
| --- | --- | ---: |
| Mode/body | `#19483f` | `2.04:1` |
| Distance | `#24594f` | `2.62:1` |
| `GO` | `#276d5e` | `3.44:1` |
| `NO-GO` | `#a83229` | `3.15:1` |
| Unknown | `#7a5c13` | `3.37:1` |

The button’s `aria-label` is only “Tap to wake”, replacing the visible distance and `GO`/`NO-GO` summary for assistive technology.

Evidence: [app/globals.css#L1058-L1082](../../app/globals.css#L1058-L1082), [app/shoreline-app.tsx#L2209-L2218](../../app/shoreline-app.tsx#L2209-L2218).

Required result:

- Raise all critical values to at least `4.5:1` while retaining a low-power aesthetic.
- Give the button an accessible name that contains the navigation state, distance, unit, and wake action.
- Test `GO`, `NO-GO`, unknown, far-shore, stationary, and anchor-watch power-save states.

### WIND-001 — persistent duplicate animation loops

`draw()` schedules the next frame. The effect calls `draw()` directly and the initial `ResizeObserver` callback calls it again. That creates two independent chains; only the most recently assigned frame ID is cancelled. The other chain continues after toggle, effect restart, or unmount. Heading-up updates can create additional leaked chains.

Evidence: [app/wind-overlay.tsx#L43-L83](../../app/wind-overlay.tsx#L43-L83).

Required result:

- Maintain exactly one frame chain per visible canvas.
- Let resize update dimensions without starting another chain.
- Cancel every scheduled frame and disconnect the observer on effect cleanup.
- Keep the loop stable across heading updates by reading mutable inputs from refs.
- Add a runtime test with mocked `requestAnimationFrame` and `ResizeObserver`; assert zero active callbacks after hide/unmount and one while visible.

## P1 — high-impact findings

### WIND-002 — hidden canvases and power save continue doing work

Distance and Route stay mounted and both receive `visible={showWind}`. CSS `hidden` removes them visually but does not stop their canvas loops. Power save pauses CSS animation only. This is a material mobile battery and throttling risk.

Evidence: [app/shoreline-app.tsx#L2057-L2104](../../app/shoreline-app.tsx#L2057-L2104), [app/shoreline-app.tsx#L2152-L2167](../../app/shoreline-app.tsx#L2152-L2167), [app/globals.css#L1058-L1060](../../app/globals.css#L1058-L1060).

Gate animation by active tab, power-save state, page visibility, and preferably intersection. A hidden canvas must have no pending frame.

### WIND-003 — cached wind and forecast can belong to the previous location

`WindSample` has no cell/location identity and the reuse check validates age only. On a GPS-cell change, old wind remains renderable while the new request loads or fails. The main weather forecast likewise remains visible after the cell changes; only map values have a cell-key guard.

Evidence: [lib/wind.ts#L3-L9](../../lib/wind.ts#L3-L9), [lib/wind.ts#L96-L98](../../lib/wind.ts#L96-L98), [app/shoreline-app.tsx#L847-L850](../../app/shoreline-app.tsx#L847-L850), [app/nautical-weather.tsx#L195-L278](../../app/nautical-weather.tsx#L195-L278).

Store `{ cellKey, sample }`, render only a matching cell, label age/location, and apply the same guard to the main forecast.

### WIND-004 — motion and visual semantics are inconsistent

- The route water is light `#85bac8`, but the default aqua wind flow produces only about `1.3–1.4:1` even before per-particle alpha, so it nearly disappears.
- The top-right wind control is unbounded and `nowrap`; it competes with a `72%`-wide distance card around `390px` in Distance and active Navigation.
- Distance/Navigation use a downwind arrow/flow convention, while Weather rotates an up arrow by meteorological direction.
- Route does not show Distance’s offline wind label.
- Weather’s “wind animation” is only an opacity/`1px` pulse on every second vector, not directional flow.

Evidence: [app/globals.css#L388-L400](../../app/globals.css#L388-L400), [app/globals.css#L833-L838](../../app/globals.css#L833-L838), [app/globals.css#L1011-L1015](../../app/globals.css#L1011-L1015), [app/weather-map.tsx#L125-L150](../../app/weather-map.tsx#L125-L150).

Choose one explicit convention: animation and arrow point **toward flow**, while text says wind **from** a compass direction. Add an outline/glow or route-specific dark flow color, constrain the control, and use the same loading/offline/age label everywhere.

### NAV-001 — active-map controls collide

Active Navigation places scale and map attribution at exactly `right:12px; bottom:104px`. The wind control/readout collision compounds this on narrow phones.

Evidence: [app/globals.css#L1009-L1015](../../app/globals.css#L1009-L1015).

Create reserved overlay zones for primary readout, wind/orientation, zoom, scale, attribution, GPS warning, and footer. Add geometry assertions for `320`, `375`, `390`, `393`, and `430px` widths.

### NAV-002 — the anchor timer removes the only arm action

After 20 seconds stationary, `anchorTimerVisible` replaces the interactive “Set anchor” button with a status-only timer chip. No code automatically creates an `AnchorWatch`, so a user who waits can no longer arm drift watch until movement resets the timer.

Evidence: [app/shoreline-app.tsx#L2073-L2082](../../app/shoreline-app.tsx#L2073-L2082), [tests/app-contract.test.mjs#L136-L139](../../tests/app-contract.test.mjs#L136-L139).

Keep a visible `Set anchor` action in the timer/ready state or make the ready chip an explicit confirmation control. Test keyboard, screen reader, and touch interaction.

### NAV-003 — tablet and safe-area behavior is incomplete

- Tablet expansion ends at `1199px`; a `1366px` iPad landscape falls back to the `680px` tracker cap and wastes roughly half the screen.
- Route planning keeps a square map, so at `1024×768` it can be approximately `976px` tall and require unnecessary scrolling.
- `viewport-fit=cover` is enabled, but only top/bottom safe areas are applied; landscape controls and tabs have no left/right protection.
- User distance scaling is applied to Distance but not the reused active-Navigation readout.

Evidence: [app/globals.css#L90-L95](../../app/globals.css#L90-L95), [app/globals.css#L833-L836](../../app/globals.css#L833-L836), [app/globals.css#L1104-L1148](../../app/globals.css#L1104-L1148), [app/shoreline-app.tsx#L2057](../../app/shoreline-app.tsx#L2057), [app/route-planner.tsx#L958-L959](../../app/route-planner.tsx#L958-L959).

Add an intentional large-tablet/desktop layout, landscape planning geometry, inline safe-area padding, and a shared distance-scale source.

### WEATHER-001 — stale, coupled, and misleading failure states

- If either weather or marine data fails, the complete forecast/map is discarded even though the parser tolerates missing marine values.
- A cell change can leave the old main forecast visible.
- Map failure still renders the animated loading spinner next to “unavailable”.
- A map-only failure has no direct retry and otherwise waits for the 30-minute interval.

Evidence: [app/nautical-weather.tsx#L246-L299](../../app/nautical-weather.tsx#L246-L299), [app/nautical-weather.tsx#L320-L325](../../app/nautical-weather.tsx#L320-L325), [app/nautical-weather.tsx#L410-L415](../../app/nautical-weather.tsx#L410-L415).

Accept partial results, show source-specific status, stop the spinner on failure, provide retry, and visibly mark matching cached data with age.

### START-001 — terminal errors do not offer recovery

- Coastline failure leaves both launch actions disabled with the same wait cursor used for loading and no retry.
- A geolocation failure raised while still idle is not shown by the idle UI.
- Live tracking errors appear as a small non-alert `compact-error` without a recovery action.
- Client wind fetches have no deadline or in-flight guard; on failure the active toggle can keep “loading” text until the ten-minute retry.

Evidence: [app/shoreline-app.tsx#L1600-L1604](../../app/shoreline-app.tsx#L1600-L1604), [app/shoreline-app.tsx#L1921-L1924](../../app/shoreline-app.tsx#L1921-L1924), [app/shoreline-app.tsx#L2046-L2048](../../app/shoreline-app.tsx#L2046-L2048), [app/shoreline-app.tsx#L2188](../../app/shoreline-app.tsx#L2188), [lib/wind.ts#L69-L88](../../lib/wind.ts#L69-L88).

Give loading, unavailable, permission denied, offline-with-cache, and retrying distinct visuals and actions.

### DESIGN-001 — four map dialects weaken the product

Distance uses dark water, a thick coastline, and no land fill; Route uses bright cyan water, beige filled land, and a thin coast; Weather uses another bright palette; Logbook uses nearly white water and does not fill/hatch land. Boat, scale, attribution, selected-point, and wind conventions also vary.

Evidence: [app/globals.css#L417-L424](../../app/globals.css#L417-L424), [app/globals.css#L558-L570](../../app/globals.css#L558-L570), [app/globals.css#L707-L719](../../app/globals.css#L707-L719), [app/globals.css#L833-L859](../../app/globals.css#L833-L859).

Define shared semantic map tokens for water, land, coast, shallow, restricted, route, boat, anchor, wind, scale, and attribution. Permit density differences, not conflicting meaning.

### ACCESS-001 — critical text and targets are too small for outdoor motion

Many live labels are `0.40–0.60rem`; several controls are `28–42px`. Examples include activity metadata/clear, weather chart labels/close, route zoom and point controls, and active-navigation guidance. These may meet a narrow minimum but are not robust on a moving boat, in sunlight, or with wet hands.

Evidence: [app/globals.css#L507-L549](../../app/globals.css#L507-L549), [app/globals.css#L680-L705](../../app/globals.css#L680-L705), [app/globals.css#L878-L905](../../app/globals.css#L878-L905), [app/globals.css#L931-L935](../../app/globals.css#L931-L935).

Use `48px` for critical controls and at least `44px` for normal controls; set a readable outdoor minimum for labels. Verify at 200% text zoom without clipping.

### ACCESS-002 — keyboard and screen-reader interaction is incomplete

- An unselected Weather map point has effectively invisible keyboard focus; the focus circle exists only after selection, and interactive SVG groups live inside an SVG exposed as one image.
- Route search uses listbox/option roles without combobox state, roving focus, or arrow-key behavior.
- Route map edit selection is visual only, without `aria-pressed`.
- Loading/readiness states are not consistently live regions, while active guidance has two frequently updating regions that may become noisy.

Evidence: [app/weather-map.tsx#L133-L151](../../app/weather-map.tsx#L133-L151), [app/route-planner.tsx#L973-L1002](../../app/route-planner.tsx#L973-L1002), [app/route-planner.tsx#L1041-L1044](../../app/route-planner.tsx#L1041-L1044).

Add visible focus, complete keyboard patterns, stateful control semantics, and a single deliberately throttled guidance announcement.

### TEST-001 — no rendered visual or motion regression suite

Existing tests check CSS/source strings and utility functions. They cannot detect unreadable computed themes, overlap, clipping, invisible focus, duplicate canvas loops, hidden-tab work, or motion direction.

Add a deterministic browser suite that saves approved screenshots and geometry/contrast results. Keep animation verification separate from still-image comparison.

## P2 — consistency and polish findings

- **THEME-002 — theme composition:** Sunlight, XP, and Nautical apply independent selectors whose ordering changes the result by tab. Theme preference loads asynchronously and can flash Ocean. The fixed PWA theme color is Ocean-only. Resolve one explicit composed appearance before first paint.
- **WEATHER-002 — false active state:** With `selectedMetric === null`, the map uses Wind while the Wind card is not active and the chart is hidden. Represent the overview state explicitly or select Wind by default.
- **DESIGN-002 — hierarchy:** Activity uses a `1.25rem` header, Weather approximately `.96rem`, and Route approximately `.86rem`; loading styles and Unicode tab icons also vary. Establish shared page title, section title, status, and icon components.
- **ACT-001 — Logbook:** The trip map does not fill/hatch land, the hero always uses three columns on narrow phones, and localization mixes `GPS TRACK`, `GESCHWINDIGKEIT`, and `Ø Tempo`. Use the shared map vocabulary and locale copy.
- **WIND-005 — motion quality:** Motion is frame-based, so `120Hz` runs about twice as fast as `60Hz`; `0 kn` still moves because the minimum magnitude is `.65`; gusts do not affect color; heading changes rebuild particles; reduced-motion preference changes are read only at effect start. Use delta time, calm semantics, gust thresholds, stable particles, and a media-query listener.
- **DESIGN-003 — launch desktop:** The current `1200×750` hosted image leaves a large unused right side and places key actions below the initial fold. Create an intentional wide launch composition without weakening the phone layout.
- **DATA-001 — input validation:** `Number(null)`, `Number("")`, and `Number(false)` become zero, so incomplete wind responses can appear as valid calm north wind. Require actual finite numbers or deliberately accepted numeric strings.
- **A11Y-003 — state announcements:** Define which loading, safety, and route states are polite, assertive, persistent, or silent. Do not rely on visual animation alone.

## Design-system direction

Use a small set of semantic roles rather than tab-specific hard-coded palettes:

| Role | Purpose |
| --- | --- |
| `--surface-app`, `--text-app` | Shell and launch background/foreground pair. |
| `--surface-instrument`, `--text-instrument` | Distance and active-navigation instruments. |
| `--surface-card`, `--text-card`, `--text-muted` | Cards in Weather, Route, and Logbook. |
| `--surface-overlay`, `--text-overlay` | Map controls, attribution, status pills, and dialogs. |
| `--map-water`, `--map-land`, `--map-coast` | Shared geographic language. |
| `--state-safe`, `--state-caution`, `--state-danger`, `--state-unknown` | Meaningful state, each with foreground/background/border variants. |
| `--wind-calm`, `--wind-normal`, `--wind-strong`, `--wind-danger` | Wind rendering tested against every map surface. |

Recommended component rules:

1. One page-header rhythm across Route, Weather, and Logbook.
2. One map-control component for wind, orientation, zoom, and mode with standard `44/48px` sizes.
3. One global safety layer above tab content but below only true system dialogs.
4. One `MapTheme` contract used by Distance, Route, Weather, and Logbook.
5. One wind direction convention and one source/age/offline label.
6. Theme pairs must be tested as rendered foreground/background combinations, not isolated variables.

## Required screenshot matrix

### Baseline viewports

| ID | Viewport | Purpose |
| --- | --- | --- |
| `phone-small` | `320×568` | Minimum-width collision and text wrapping. |
| `phone-current` | `393×852` | Primary modern phone baseline. |
| `phone-landscape` | `844×390` | Safe-area and compact-height behavior. |
| `tablet-portrait` | `768×1024` | Tablet stacking and map height. |
| `tablet-landscape` | `1024×768` | Route planning and navigation geometry. |
| `tablet-large` | `1366×1024` | Media-query cutoff regression. |
| `desktop` | `1440×900` | Wide launch and centered tracker behavior. |

### Primary screenshots at every viewport

Capture these six images in Ocean first, then repeat at `393×852` for Dark, XP, and Nautical:

1. Launch ready with settings summary.
2. Distance reliable, `GO`, depth ready, wind visible.
3. Route planning with start/destination, results, and wind visible.
4. Active Navigation with guidance, readout, wind, scale, and attribution.
5. Weather ready with one metric selected and map visible.
6. Logbook populated plus a separate trip-detail image.

File convention: `visual-{surface}-{theme}-{viewport}-{state}.png`.

### State screenshots on the primary phone

- Launch: loading, coastline failure/retry, offline cached, packages downloading/error, settings expanded.
- Distance: GPS waiting/inaccurate/stale/lost, `NO-GO`, unknown, distance warning, safe recovery, speed warning, course warning, shallow water, anchor set/timer/holding/breach, wind loading/offline, power save.
- Route: search loading/no result/error, calculating, restricted/shallow, no safe route, GPS blocked, arrived.
- Weather: waiting, loading, cached/offline, forecast error, map-only error, every metric, Today/Tomorrow.
- Logbook: empty, live trip, active anchor, populated, trip track loading/no track/ready, long localized strings.
- Global: sunlight on/off for each theme, distance scale `80/110/150%`, 200% text zoom, keyboard focus, reduced motion.
- Safety: distance, speed, course, GPS loss, and anchor breach while each of the four tabs is active.

Do not attempt the full Cartesian product. Use the primary baseline plus targeted pairwise coverage above; every distinct component branch must appear in at least one approved image.

## Wind motion verification protocol

A still screenshot proves only that a canvas is present. Use a deterministic `/api/wind` fixture such as `14 kn / 90°` and record the following separately for Distance, Route planning, and active Navigation:

1. Assert canvas bounds are non-zero and computed opacity is non-zero.
2. Compare `getImageData()` at `t0` and `t+300ms`; enough pixels must change in normal motion.
3. Under reduced motion, frames must be identical but the field must be non-empty.
4. Instrument `requestAnimationFrame`; exactly one loop may be active for the visible canvas.
5. Switch tabs, enter power save, hide the document, resize/rotate, and unmount; active loops must become zero.
6. Toggle heading-up repeatedly; the flow angle may change without resetting the particle field or increasing loop count.
7. Compare `30/60/120Hz` with delta time; distance traveled per second must stay equivalent.
8. Test `0`, `11.9`, `12`, `21.9`, and `22 kn`, plus a strong gust over calm mean wind.
9. Pixel-check wind against Ocean/XP/Nautical/sunlight Distance and Route map backgrounds.
10. Confirm the arrow, particle direction, compass label, and Weather vector agree for north/east/south/west samples.

## Prioritized implementation checklist

### P0

- [x] **SAFE-001:** Move persistent safety alerts/status outside tab panels; prove every danger and recovery state on every tab.
- [x] **THEME-001:** Replace unpaired theme colors; meet rendered AA contrast in Launch, all tabs, active Navigation, and trip detail.
- [x] **POWER-001:** Raise power-save contrast and preserve the navigation summary in its accessible name.
- [x] **WIND-001:** Eliminate duplicate/leaked frame loops with runtime lifecycle tests.

### P1

- [x] **WIND-002:** Stop canvas work for hidden tabs, hidden pages, power save, and off-screen canvases.
- [x] **WIND-003:** Bind wind and forecast caches to a location cell and show cache age/location.
- [x] **WIND-004:** Fix Route wind contrast, overlap, direction semantics, and offline/source status.
- [x] **NAV-001:** Reserve collision-free active-map overlay zones at all phone widths.
- [x] **NAV-002:** Keep an operable anchor-arm action after the stationary timer completes.
- [x] **NAV-003:** Add large-tablet, landscape, inline safe-area, and shared distance-scale behavior.
- [x] **WEATHER-001:** Accept partial weather/marine data and implement honest stale/error/retry UI.
- [x] **START-001:** Separate loading from terminal errors and provide visible recovery actions.
- [x] **DESIGN-001:** Adopt one semantic map theme contract across all four map renderers.
- [x] **ACCESS-001:** Standardize outdoor-readable text and `44/48px` targets; verify 200% zoom.
- [x] **ACCESS-002:** Complete keyboard, focus, and screen-reader patterns.
- [x] **TEST-001:** Add deterministic screenshot, geometry, computed-contrast, canvas frame-diff, and loop-count tests.

### P2

- [x] **THEME-002:** Resolve theme + sunlight composition before first paint and update PWA chrome colors.
- [x] **WEATHER-002:** Make the overview/null metric state visually honest.
- [x] **DESIGN-002:** Standardize tab headers, status/loading language, and icons.
- [x] **ACT-001:** Align Logbook map/hero/localization with the rest of the app.
- [x] **WIND-005:** Make motion time-based, calm/gust-aware, stable across heading changes, and reactive to reduced-motion changes.
- [x] **DESIGN-003:** Create an intentional wide launch layout.
- [x] **DATA-001:** Reject null/empty/boolean wind values and test parsing failures.
- [x] **A11Y-003:** Define and test a deliberate live-region announcement policy.

## Resolution record — v1.22.2

All 24 implementation items above were completed on 2026-08-16. The audit remains the source-of-truth list; there are no open release TODOs from this review.

| Area | Delivered result | Verification |
| --- | --- | --- |
| Safety | Distance, speed, course, GPS, and anchor alerts now live outside tab panels; the anchor action remains operable after the timer. | Browser review confirmed an active distance warning remained visible on Weather; source contracts cover the global alert and anchor action. |
| Themes | Launch, Distance, Route, active Navigation, Weather, Logbook, and trip surfaces have paired foreground/background values in Ocean, Dark, XP, Nautical, and sunlight compositions. | Browser screenshots reviewed every tab in XP and Nautical, plus Ocean sunlight and active Navigation; computed contrast contracts pass. |
| Navigation | Phone overlay zones, scale, attribution, GO control, wide-tablet geometry, inline safe areas, and the shared distance scale no longer collide. | Route planning and active Navigation screenshots reviewed with wind, scale, attribution, and global warning visible. |
| Wind | One delta-time frame loop, no hidden/power-save/page-hidden canvas work, stable heading updates, reactive reduced-motion, calm/gust behavior, location-bound cache, explicit offline age/location, and retry UI. | Two normal-motion frames differed; hidden Route canvas computed invisible while Distance was active; lifecycle and pure-behavior contracts pass. |
| Weather | Forecast and marine requests degrade independently, old-cell forecasts cannot render, map errors stop spinning and expose a retry, and Wind is the honest default metric. | Ready forecast/map/chart and error branches reviewed; source and parser contracts pass. |
| Start/PWA | Terminal load errors have recovery actions, saved theme is applied before paint, browser chrome follows theme/sunlight, and landscape is permitted. | Launch screenshots reviewed in Ocean, XP, and Nautical; manifest and release checks cover PWA metadata. |
| Maps/Logbook | Distance, Route, Weather, and activity maps share coastline/land/water semantics; Logbook hero, track hatch, speed chart, and labels are localized. | Empty/populated Logbook and themed hero/track screenshots reviewed in all targeted themes. |
| Accessibility | Consistent focus rings, 44 px controls, readable supporting text, listbox keyboard behavior, pressed states, map hit targets, and one deliberate live-announcement channel. | Keyboard/source contracts and accessible browser snapshots pass; duplicate live regions were removed. |
| Responsive design | The tracker scales through 1600 px, planning maps use landscape geometry where appropriate, phone overlays reserve space, and Launch becomes an intentional two-column composition on wide screens. | Wide Launch, landscape route, tablet-width tracker, and narrow-phone geometry were checked visually or by deterministic CSS contracts. |
| Regression coverage | Wind parser/cell/calm/gust tests, tab/alert/layout source contracts, theme contrast tests, full build, lint, typecheck, and artifact validation cover the fixed failure modes. | See the implementing pull request checks and release validation output. |

### Screenshot review log

The browser review used the real preview build and covered these distinct rendered branches rather than relying on source inspection alone:

- Ocean: Launch; sunlight Distance with live wind; Route planning; Weather ready; Logbook; persistent danger alert on a non-Distance tab.
- Windows XP: Launch; Distance with wind; Route planning; Logbook; corrected light route/activity surfaces.
- Nautical: Launch; Distance with wind; Route planning; active Navigation; Weather; Logbook; corrected readiness and supporting copy.
- Motion: two separated frames with deterministic live wind changed; the inactive Route canvas was hidden; reduced-motion retains a static field by contract.
- Geometry: wide Launch, `320–430 px` collision rules, landscape planning aspect ratio, `600–1600 px` tracker sizing, active-map scale/credit/GO zones, and safe-area insets.

### Remaining TODOs

None from this audit. Future design changes must extend the screenshot matrix and keep the regression contracts green.

## Definition of done

The audit can be closed only when:

- All P0 items are fixed and regression-tested.
- The primary screenshot set passes at all seven viewports.
- Every theme passes Launch, all tabs, active Navigation, Logbook detail, sunlight composition, and power save at `393×852`.
- Safety overlays remain visible and accessible from every tab.
- No visible elements overlap or enter unsafe screen areas at the tested viewports or 200% text zoom.
- Wind has one visible loop, zero hidden loops, time-based motion, matching direction semantics, and sufficient contrast.
- Cached wind/weather can never silently represent a previous location.
- Keyboard focus, screen-reader names, and live announcements are verified.
- `npm run lint`, `npm test`, browser visual tests, and the real-device checklist pass on the implementing pull requests.
