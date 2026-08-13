export type WarningTransition = "none" | "enter-distance" | "exit-distance" | "enter-speed";
export type WarningSound = "warning" | "safe" | null;
export type WarningVisual = "distance" | "speed" | "safe" | null;

export type WarningOutputOptions = {
  alertVolumePercent: number;
  warningSoundEnabled: boolean;
  safeSoundEnabled: boolean;
  visualAlertsEnabled: boolean;
  vibrationEnabled: boolean;
};

export function getWarningTransition(
  previousInside: boolean | null,
  inside: boolean,
  previousSpeedViolation: boolean | null,
  speedViolation: boolean,
): WarningTransition {
  if (inside && previousInside !== true) return "enter-distance";
  if (!inside && previousInside === true) return "exit-distance";
  if (speedViolation && previousSpeedViolation !== true) return "enter-speed";
  return "none";
}

export function getWarningOutputPlan(transition: WarningTransition, options: WarningOutputOptions) {
  if (transition === "none") return { sound: null, visual: null, vibration: null } as const;
  const isSafe = transition === "exit-distance";
  const sound: WarningSound = options.alertVolumePercent <= 0
    ? null
    : isSafe
      ? options.safeSoundEnabled ? "safe" : null
      : options.warningSoundEnabled ? "warning" : null;
  const visual: WarningVisual = options.visualAlertsEnabled
    ? isSafe ? "safe" : transition === "enter-speed" ? "speed" : "distance"
    : null;
  return {
    sound,
    visual,
    vibration: options.vibrationEnabled ? isSafe ? "safe" : "danger" : null,
  } as const;
}
