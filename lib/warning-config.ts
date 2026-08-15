export type WarningConfig = {
  settingsVersion: 3;
  distanceMetres: number;
  distanceTextScalePercent: number;
  speedWarningEnabled: boolean;
  maxSpeedKnots: number;
  courseWarningEnabled: boolean;
  suppressDistanceSoundAtSafeSpeed: boolean;
  alertVolumePercent: number;
  warningSoundEnabled: boolean;
  safeSoundEnabled: boolean;
  visualAlertsEnabled: boolean;
  vibrationEnabled: boolean;
  shallowWaterEnabled: boolean;
  shallowWaterMetres: number;
  powerSaveEnabled: boolean;
  powerSaveDistanceMetres: number;
  powerSaveStationaryMinutes: number;
  powerSaveAnchorRadiusMetres: number;
};

export const CROATIA_WARNING_CONFIG: WarningConfig = {
  settingsVersion: 3,
  distanceMetres: 300,
  distanceTextScalePercent: 110,
  speedWarningEnabled: true,
  maxSpeedKnots: 8,
  courseWarningEnabled: false,
  suppressDistanceSoundAtSafeSpeed: true,
  alertVolumePercent: 100,
  warningSoundEnabled: true,
  safeSoundEnabled: true,
  visualAlertsEnabled: true,
  vibrationEnabled: true,
  shallowWaterEnabled: true,
  shallowWaterMetres: 3,
  powerSaveEnabled: true,
  powerSaveDistanceMetres: 2_000,
  powerSaveStationaryMinutes: 1,
  powerSaveAnchorRadiusMetres: 30,
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
  const distanceTextScalePercent = typeof candidate.distanceTextScalePercent === "number" && Number.isFinite(candidate.distanceTextScalePercent)
    ? Math.min(150, Math.max(80, Math.round(candidate.distanceTextScalePercent / 5) * 5))
    : CROATIA_WARNING_CONFIG.distanceTextScalePercent;
  const powerSaveDistanceMetres = typeof candidate.powerSaveDistanceMetres === "number" && Number.isFinite(candidate.powerSaveDistanceMetres)
    ? Math.min(20_000, Math.max(500, Math.round(candidate.powerSaveDistanceMetres / 100) * 100))
    : CROATIA_WARNING_CONFIG.powerSaveDistanceMetres;
  const powerSaveStationaryMinutes = typeof candidate.powerSaveStationaryMinutes === "number" && Number.isFinite(candidate.powerSaveStationaryMinutes)
    ? Math.min(30, Math.max(1, Math.round(candidate.powerSaveStationaryMinutes)))
    : CROATIA_WARNING_CONFIG.powerSaveStationaryMinutes;
  const powerSaveAnchorRadiusMetres = typeof candidate.powerSaveAnchorRadiusMetres === "number" && Number.isFinite(candidate.powerSaveAnchorRadiusMetres)
    ? Math.min(200, Math.max(10, Math.round(candidate.powerSaveAnchorRadiusMetres / 5) * 5))
    : CROATIA_WARNING_CONFIG.powerSaveAnchorRadiusMetres;
  const shallowWaterMetres = typeof candidate.shallowWaterMetres === "number" && Number.isFinite(candidate.shallowWaterMetres)
    ? Math.min(20, Math.max(1, Math.round(candidate.shallowWaterMetres * 2) / 2))
    : CROATIA_WARNING_CONFIG.shallowWaterMetres;

  return {
    settingsVersion: 3,
    distanceMetres,
    maxSpeedKnots,
    alertVolumePercent,
    distanceTextScalePercent,
    powerSaveDistanceMetres,
    powerSaveStationaryMinutes,
    powerSaveAnchorRadiusMetres,
    shallowWaterMetres,
    speedWarningEnabled: typeof candidate.speedWarningEnabled === "boolean" ? candidate.speedWarningEnabled : CROATIA_WARNING_CONFIG.speedWarningEnabled,
    courseWarningEnabled: typeof candidate.courseWarningEnabled === "boolean" ? candidate.courseWarningEnabled : CROATIA_WARNING_CONFIG.courseWarningEnabled,
    suppressDistanceSoundAtSafeSpeed: typeof candidate.suppressDistanceSoundAtSafeSpeed === "boolean" ? candidate.suppressDistanceSoundAtSafeSpeed : CROATIA_WARNING_CONFIG.suppressDistanceSoundAtSafeSpeed,
    warningSoundEnabled: typeof candidate.warningSoundEnabled === "boolean" ? candidate.warningSoundEnabled : CROATIA_WARNING_CONFIG.warningSoundEnabled,
    safeSoundEnabled: typeof candidate.safeSoundEnabled === "boolean" ? candidate.safeSoundEnabled : CROATIA_WARNING_CONFIG.safeSoundEnabled,
    visualAlertsEnabled: typeof candidate.visualAlertsEnabled === "boolean" ? candidate.visualAlertsEnabled : CROATIA_WARNING_CONFIG.visualAlertsEnabled,
    vibrationEnabled: typeof candidate.vibrationEnabled === "boolean" ? candidate.vibrationEnabled : CROATIA_WARNING_CONFIG.vibrationEnabled,
    shallowWaterEnabled: typeof candidate.shallowWaterEnabled === "boolean" ? candidate.shallowWaterEnabled : CROATIA_WARNING_CONFIG.shallowWaterEnabled,
    powerSaveEnabled: typeof candidate.powerSaveEnabled === "boolean" ? candidate.powerSaveEnabled : CROATIA_WARNING_CONFIG.powerSaveEnabled,
  };
}

export function migrateWarningConfig(value: unknown): WarningConfig {
  const sanitized = sanitizeWarningConfig(value);
  if (value && typeof value === "object") {
    const version = (value as { settingsVersion?: unknown }).settingsVersion;
    if (version === 3 || version === 2) return sanitized;
  }

  return {
    ...sanitized,
    courseWarningEnabled: CROATIA_WARNING_CONFIG.courseWarningEnabled,
    powerSaveStationaryMinutes: CROATIA_WARNING_CONFIG.powerSaveStationaryMinutes,
  };
}
