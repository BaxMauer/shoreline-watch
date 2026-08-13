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
  assert.equal(getAlertVolumeMultiplier(Number.POSITIVE_INFINITY), 1);
});

test("generated alert gain scales monotonically from mute to boost", () => {
  const peaks = [0, 25, 50, 100, 150, 200].map(getGeneratedAlertPeak);
  assert.equal(peaks[0], 0);
  for (let index = 1; index < peaks.length; index += 1) assert.ok(peaks[index] > peaks[index - 1]);
});

test("alarm asset is PCM WAV with a useful duration and sample rate", async () => {
  const wav = await readFile(new URL("../public/audio/shoreline-alarm.wav", import.meta.url));
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 44_100);
  const dataOffset = wav.indexOf(Buffer.from("data"));
  const durationSeconds = wav.readUInt32LE(dataOffset + 4) / (44_100 * 2);
  assert.ok(durationSeconds >= 1.5 && durationSeconds <= 3);
});
