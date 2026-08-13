export type WarningTransition = "none" | "enter-distance" | "exit-distance" | "enter-speed";

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
