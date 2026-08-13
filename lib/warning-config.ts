export type WarningConfig = {
  distanceMetres: number;
  speedWarningEnabled: boolean;
  maxSpeedKnots: number;
  alertVolumePercent: number;
  warningSoundEnabled: boolean;
  safeSoundEnabled: boolean;
  visualAlertsEnabled: boolean;
  vibrationEnabled: boolean;
};

export const CROATIA_WARNING_CONFIG: WarningConfig = {
  distanceMetres: 300,
  speedWarningEnabled: true,
  maxSpeedKnots: 8,
  alertVolumePercent: 100,
  warningSoundEnabled: true,
  safeSoundEnabled: true,
  visualAlertsEnabled: true,
  vibrationEnabled: true,
};

export function sanitizeWarningConfig(value: unknown): WarningConfig {
  if (!value || typeof value !== "object") return CROATIA_WARNING_CONFIG;
  const candidate = value as Partial<WarningConfig>;
  const distanceMetres = typeof candidate.distanceMetres === "number" && Number.isFinite(candidate.distanceMetres)
    ? Math.min(2_000, Math.max(50, Math.round(candidate.distanceMetres / 10) * 10))
    : CROATIA_WARNING_CONFIG.distanceMetres;
  const maxSpeedKnots = typeof candidate.maxSpeedKnots === "number" && Number.isFinite(candidate.maxSpeedKnots)
    ? Math.min(40, Math.max(1, Math.round(candidate.maxSpeedKnots * 10) / 10))
    : CROATIA_WARNING_CONFIG.maxSpeedKnots;
  const alertVolumePercent = typeof candidate.alertVolumePercent === "number" && Number.isFinite(candidate.alertVolumePercent)
    ? Math.min(200, Math.max(0, Math.round(candidate.alertVolumePercent / 5) * 5))
    : CROATIA_WARNING_CONFIG.alertVolumePercent;

  return {
    distanceMetres,
    maxSpeedKnots,
    alertVolumePercent,
    speedWarningEnabled: typeof candidate.speedWarningEnabled === "boolean" ? candidate.speedWarningEnabled : CROATIA_WARNING_CONFIG.speedWarningEnabled,
    warningSoundEnabled: typeof candidate.warningSoundEnabled === "boolean" ? candidate.warningSoundEnabled : CROATIA_WARNING_CONFIG.warningSoundEnabled,
    safeSoundEnabled: typeof candidate.safeSoundEnabled === "boolean" ? candidate.safeSoundEnabled : CROATIA_WARNING_CONFIG.safeSoundEnabled,
    visualAlertsEnabled: typeof candidate.visualAlertsEnabled === "boolean" ? candidate.visualAlertsEnabled : CROATIA_WARNING_CONFIG.visualAlertsEnabled,
    vibrationEnabled: typeof candidate.vibrationEnabled === "boolean" ? candidate.vibrationEnabled : CROATIA_WARNING_CONFIG.vibrationEnabled,
  };
}
