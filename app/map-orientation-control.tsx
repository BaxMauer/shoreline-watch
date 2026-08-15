"use client";

import { getMapOrientation } from "../lib/map-orientation";

export default function MapOrientationControl({
  headingUp,
  heading,
  language,
  onToggle,
  className = "",
}: {
  headingUp: boolean;
  heading: number | null | undefined;
  language: "de" | "en";
  onToggle: () => void;
  className?: string;
}) {
  const { mapRotationDegrees } = getMapOrientation(heading, headingUp);
  const label = headingUp
    ? language === "de" ? "Karte nach Norden ausrichten" : "Set map to north up"
    : language === "de" ? "Karte in Fahrtrichtung drehen" : "Set map to heading up";

  return (
    <button
      type="button"
      className={`map-orientation-control ${headingUp ? "active" : ""} ${className}`.trim()}
      aria-label={label}
      aria-pressed={headingUp}
      title={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="11.5" />
        <g className="compass-needle" transform={`rotate(${mapRotationDegrees} 14 14)`}>
          <path className="compass-north" d="M14 4 18 15 14 12.5 10 15Z" />
          <path className="compass-south" d="M14 24 10 13 14 15.5 18 13Z" />
        </g>
        <circle className="compass-centre" cx="14" cy="14" r="2" />
      </svg>
    </button>
  );
}
