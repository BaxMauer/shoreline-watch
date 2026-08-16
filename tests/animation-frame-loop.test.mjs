import assert from "node:assert/strict";
import test from "node:test";
import { createAnimationFrameLoop } from "../lib/animation-frame-loop.ts";

function frameHarness() {
  let nextIdentifier = 1;
  const scheduled = new Map();
  const cancelled = [];
  return {
    schedule(callback) {
      const identifier = nextIdentifier++;
      scheduled.set(identifier, callback);
      return identifier;
    },
    cancel(identifier) {
      cancelled.push(identifier);
      scheduled.delete(identifier);
    },
    flush(timestamp) {
      const frames = [...scheduled.values()];
      scheduled.clear();
      for (const callback of frames) callback(timestamp);
    },
    scheduled,
    cancelled,
  };
}

test("animation loop has exactly one scheduled frame across repeated starts", () => {
  const harness = frameHarness();
  const rendered = [];
  const loop = createAnimationFrameLoop(harness.schedule, harness.cancel, (timestamp) => rendered.push(timestamp));
  loop.start();
  loop.start();
  loop.start();
  assert.equal(harness.scheduled.size, 1);
  harness.flush(16);
  assert.deepEqual(rendered, [16]);
  assert.equal(harness.scheduled.size, 1);
});

test("stopping the animation loop cancels all future work", () => {
  const harness = frameHarness();
  let renderCount = 0;
  const loop = createAnimationFrameLoop(harness.schedule, harness.cancel, () => { renderCount += 1; });
  loop.start();
  loop.stop();
  assert.equal(loop.isActive(), false);
  assert.equal(harness.scheduled.size, 0);
  harness.flush(16);
  assert.equal(renderCount, 0);
  loop.start();
  harness.flush(32);
  loop.stop();
  harness.flush(48);
  assert.equal(renderCount, 1);
  assert.ok(harness.cancelled.length >= 2);
});
