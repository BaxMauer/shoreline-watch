export type FrameScheduler = (callback: FrameRequestCallback) => number;
export type FrameCanceller = (identifier: number) => void;

export function createAnimationFrameLoop(
  schedule: FrameScheduler,
  cancel: FrameCanceller,
  render: FrameRequestCallback,
) {
  let active = false;
  let frameIdentifier: number | null = null;

  const tick: FrameRequestCallback = (timestamp) => {
    if (!active) return;
    frameIdentifier = null;
    render(timestamp);
    if (active && frameIdentifier === null) frameIdentifier = schedule(tick);
  };

  return {
    start() {
      if (active) return;
      active = true;
      frameIdentifier = schedule(tick);
    },
    stop() {
      active = false;
      if (frameIdentifier !== null) cancel(frameIdentifier);
      frameIdentifier = null;
    },
    isActive() {
      return active;
    },
  };
}
