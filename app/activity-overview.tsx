"use client";

import { activityTotals, type ActivityRecord, type TripDraft } from "../lib/activity-log";
import type { AnchorWatch } from "../lib/anchor-watch";

type Props = {
  language: "de" | "en";
  records: ActivityRecord[];
  currentTrip: TripDraft | null;
  currentAnchor: AnchorWatch | null;
  now: number;
  onBack?: () => void;
  onClear: () => void;
};

function duration(milliseconds: number, language: "de" | "en") {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} ${language === "de" ? "Min." : "min"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function distance(metres: number) {
  return metres >= 1_000 ? `${(metres / 1_000).toFixed(metres >= 10_000 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

export default function ActivityOverview({ language, records, currentTrip, currentAnchor, now, onBack, onClear }: Props) {
  const de = language === "de";
  const totals = activityTotals(records);
  const hasLive = Boolean(currentTrip || currentAnchor);
  return (
    <section className="activity-overview" aria-label={de ? "Aktivitäten" : "Activities"}>
      <header className="activity-header">
        <span>
          <small>{de ? "LOKALES LOGBUCH" : "LOCAL LOGBOOK"}</small>
          <strong>{de ? "Aktivitäten" : "Activities"}</strong>
        </span>
        {onBack && <button type="button" onClick={onBack}>{de ? "Zurück" : "Back"}</button>}
      </header>

      <div className="activity-hero">
        <div className="activity-radar" aria-hidden="true"><i /><b>⌁</b></div>
        <span><small>{de ? "Gesamtstrecke" : "Total distance"}</small><strong>{distance(totals.distanceMetres)}</strong><em>{totals.trips} {de ? "Fahrten" : "trips"}</em></span>
        <span><small>{de ? "Bestwert" : "Top speed"}</small><strong>{totals.maxSpeedKnots.toFixed(1)}</strong><em>kn</em></span>
        <span><small>{de ? "Ankerzeit" : "Anchor time"}</small><strong>{duration(totals.anchorDurationMs, language)}</strong><em>{totals.driftAlarms} {de ? "Driftalarme" : "drift alarms"}</em></span>
      </div>

      {hasLive && <div className="activity-live">
        <i aria-hidden="true" />
        <span><small>{de ? "JETZT AKTIV" : "ACTIVE NOW"}</small><strong>{currentAnchor ? (de ? "Ankerwache" : "Anchor watch") : (de ? "Fahrt läuft" : "Trip underway")}</strong></span>
        <b>{currentAnchor ? duration(now - currentAnchor.setAt, language) : duration(now - (currentTrip?.startedAt ?? now), language)}</b>
      </div>}

      <div className="activity-timeline">
        {records.length === 0 ? <div className="activity-empty">
          <span aria-hidden="true">⌁</span>
          <strong>{de ? "Noch keine Einträge" : "No entries yet"}</strong>
          <p>{de ? "Fahrten und Ankerzeiten werden automatisch auf diesem Gerät gespeichert." : "Trips and anchor sessions are saved automatically on this device."}</p>
        </div> : records.map((record, index) => {
          const date = new Intl.DateTimeFormat(language, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(record.startedAt);
          const isTrip = record.kind === "trip";
          const place = !isTrip ? [record.bayName, record.islandName].filter(Boolean).join(" · ") : "";
          return <article className={`activity-row ${record.kind}`} key={record.id} style={{ "--activity-index": index } as React.CSSProperties}>
            <span className="activity-icon" aria-hidden="true">{isTrip ? "↗" : "⚓"}</span>
            <div className="activity-row-main">
              <small>{date}</small>
              <strong>{isTrip ? (de ? "Fahrt" : "Trip") : (place || (de ? "Ankern" : "Anchored"))}</strong>
              <span>{isTrip
                ? `${distance(record.distanceMetres)} · Ø ${record.averageSpeedKnots.toFixed(1)} kn · max ${record.maxSpeedKnots.toFixed(1)} kn`
                : `${duration(record.durationMs, language)} · max ${Math.round(record.maxDriftMetres)} m ${de ? "Drift" : "drift"}`}</span>
              <div className="activity-meter"><i style={{ width: `${Math.min(100, isTrip ? record.maxSpeedKnots * 4 : record.maxDriftMetres / Math.max(1, record.radiusMetres) * 100)}%` }} /></div>
            </div>
            <b>{duration(record.durationMs, language)}</b>
          </article>;
        })}
      </div>

      <footer className="activity-privacy">
        <span>⌂</span><p><strong>{de ? "Nur auf diesem Gerät" : "Only on this device"}</strong><small>{de ? "Keine GPS- oder Logbuchdaten werden übertragen. Maximal 200 Einträge." : "No GPS or logbook data is transmitted. Maximum 200 entries."}</small></p>
        {records.length > 0 && <button type="button" onClick={onClear}>{de ? "Löschen" : "Clear"}</button>}
      </footer>
    </section>
  );
}
