export type WarningTransition = "none" | "enter-distance" | "exit-distance" | "enter-speed";
export type WarningSound = "warning" | "safe" | null;
export type WarningVisual = "distance" | "speed" | "safe" | null;

export type WarningSoundGate = {
  sound: WarningSound;
  availableForDangerEpisode: boolean;
};

export function getWarningHysteresisMetres(distanceMetres: number) {
  return Math.min(50, Math.max(10, Math.round(Math.max(0, distanceMetres) * 0.05)));
}

export function classifyWarningZone(
  previousInside: boolean | null,
  distanceMetres: number,
  warningDistanceMetres: number,
  hysteresisMetres = getWarningHysteresisMetres(warningDistanceMetres),
) {
  const distance = Math.max(0, distanceMetres);
  const threshold = Math.max(0, warningDistanceMetres);
  const hysteresis = Math.max(0, hysteresisMetres);
  if (previousInside === null) return distance < threshold;
  if (previousInside) return distance < threshold + hysteresis;
  return distance <= Math.max(0, threshold - hysteresis);
}

export type WarningOutputOptions = {
  alertVolumePercent: number;
  warningSoundEnabled: boolean;
  safeSoundEnabled: boolean;
  visualAlertsEnabled: boolean;
  vibrationEnabled: boolean;
  speedWarningEnabled: boolean;
  speedKnown: boolean;
  speedViolation: boolean;
  suppressDistanceSoundAtSafeSpeed: boolean;
};

export function getWarningTransition(
  previousInside: boolean | null,
  inside: boolean,
  previousSpeedViolation: boolean | null,
  speedViolation: boolean,
): WarningTransition {
  // The first reliable GPS fix establishes state without sounding an alarm.
  if (previousInside === null) return "none";
  if (inside && previousInside !== true) return "enter-distance";
  if (!inside && previousInside === true) return "exit-distance";
  if (speedViolation && previousSpeedViolation !== true) return "enter-speed";
  return "none";
}

export function getWarningOutputPlan(transition: WarningTransition, options: WarningOutputOptions) {
  if (transition === "none") return { sound: null, visual: null, vibration: null } as const;
  const isSafe = transition === "exit-distance";
  const suppressDistanceSound = transition === "enter-distance"
    && options.suppressDistanceSoundAtSafeSpeed
    && options.speedWarningEnabled
    && options.speedKnown
    && !options.speedViolation;
  const sound: WarningSound = options.alertVolumePercent <= 0
    ? null
    : isSafe
      ? options.safeSoundEnabled ? "safe" : null
      : options.warningSoundEnabled && !suppressDistanceSound ? "warning" : null;
  const visual: WarningVisual = options.visualAlertsEnabled
    ? isSafe ? "safe" : transition === "enter-speed" ? "speed" : "distance"
    : null;
  return {
    sound,
    visual,
    vibration: options.vibrationEnabled ? isSafe ? "safe" : "danger" : null,
  } as const;
}

export function gateWarningSoundForDangerEpisode(
  sound: WarningSound,
  transition: WarningTransition,
  availableForDangerEpisode: boolean,
  previousInside: boolean | null,
  inside: boolean,
): WarningSoundGate {
  if (previousInside === null) {
    return { sound: null, availableForDangerEpisode: !inside };
  }
  if (transition === "exit-distance") {
    return { sound, availableForDangerEpisode: true };
  }
  if (sound !== "warning") {
    return { sound, availableForDangerEpisode };
  }
  if (!availableForDangerEpisode) {
    return { sound: null, availableForDangerEpisode: false };
  }
  return { sound, availableForDangerEpisode: false };
}
