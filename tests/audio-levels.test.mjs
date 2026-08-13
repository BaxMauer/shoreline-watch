import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ALERT_REFERENCE_PEAK, getAlertVolumeMultiplier, getGeneratedAlertPeak } from "../lib/audio-levels.ts";

test("warning fallback and safe chime share one full-scale reference peak", () => {
  assert.equal(getGeneratedAlertPeak(100), ALERT_REFERENCE_PEAK);
  assert.equal(getGeneratedAlertPeak(100), 0.82);
});

test("generated warning and safe tones match the measured WAV alarm peak", async () => {
  const wav = await readFile(new URL("../public/audio/shoreline-alarm.wav", import.meta.url));
  const dataOffset = wav.indexOf(Buffer.from("data"));
  assert.ok(dataOffset >= 0, "WAV data chunk missing");
  const byteLength = wav.readUInt32LE(dataOffset + 4);
  let samplePeak = 0;
  for (let offset = dataOffset + 8; offset < dataOffset + 8 + byteLength; offset += 2) {
    samplePeak = Math.max(samplePeak, Math.abs(wav.readInt16LE(offset)) / 32_768);
  }
  assert.ok(Math.abs(samplePeak - getGeneratedAlertPeak(100)) < 0.02, `${samplePeak} does not match ${ALERT_REFERENCE_PEAK}`);
});

test("audio gain supports mute through 200 percent without an unbounded value", () => {
  assert.equal(getAlertVolumeMultiplier(-10), 0);
  assert.equal(getAlertVolumeMultiplier(175), 1.75);
  assert.equal(getAlertVolumeMultiplier(250), 2);
  assert.equal(getGeneratedAlertPeak(200), 1.64);
});

test("invalid audio preference falls back to the reference level", () => {
  assert.equal(getAlertVolumeMultiplier(Number.NaN), 1);
});
