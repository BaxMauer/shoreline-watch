export const ALERT_REFERENCE_PEAK = 0.82;

export function getAlertVolumeMultiplier(volumePercent: number) {
  if (!Number.isFinite(volumePercent)) return 1;
  return Math.min(200, Math.max(0, volumePercent)) / 100;
}

export function getGeneratedAlertPeak(volumePercent: number) {
  return ALERT_REFERENCE_PEAK * getAlertVolumeMultiplier(volumePercent);
}
