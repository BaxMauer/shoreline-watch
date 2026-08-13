import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sampleRate = 44_100;
const pattern = [
  { frequency: 880, duration: 0.34 },
  { frequency: 0, duration: 0.13 },
  { frequency: 880, duration: 0.34 },
  { frequency: 0, duration: 0.13 },
  { frequency: 1_040, duration: 0.5 },
  { frequency: 0, duration: 0.14 },
  { frequency: 1_040, duration: 0.5 },
];

const samples = [];
for (const part of pattern) {
  const count = Math.round(part.duration * sampleRate);
  for (let index = 0; index < count; index += 1) {
    if (part.frequency === 0) {
      samples.push(0);
      continue;
    }
    const edge = Math.min(index / (sampleRate * 0.018), (count - index - 1) / (sampleRate * 0.025), 1);
    const fundamental = Math.sin((2 * Math.PI * part.frequency * index) / sampleRate);
    const harmonic = Math.sin((2 * Math.PI * part.frequency * 2 * index) / sampleRate) * 0.18;
    samples.push(Math.max(-1, Math.min(1, (fundamental + harmonic) * edge * 0.78)));
  }
}

const dataSize = samples.length * 2;
const buffer = Buffer.alloc(44 + dataSize);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);
samples.forEach((sample, index) => buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2));

const output = resolve("public/audio/shoreline-alarm.wav");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, buffer);
console.log(`Generated ${output} (${samples.length / sampleRate}s)`);
