import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { repairUnfinalizedWavHeader } from "../lib/wav.js";

function chunk(id, data, declaredSize = data.length) {
  const padding = data.length % 2;
  const result = Buffer.alloc(8 + data.length + padding);
  result.write(id, 0, 4, "ascii");
  result.writeUInt32LE(declaredSize, 4);
  data.copy(result, 8);
  return result;
}

function wav(chunks, declaredRiffSize) {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(declaredRiffSize ?? body.length + 4, 4);
  header.write("WAVE", 8, 4, "ascii");
  return Buffer.concat([header, body]);
}

function withTempFile(data, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-voice-wav-"));
  const file = path.join(dir, "recording.wav");
  try {
    fs.writeFileSync(file, data);
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("repairs oversized RIFF and data sizes from an interrupted recorder", () => {
  const fmt = chunk("fmt ", Buffer.alloc(16));
  const pcm = Buffer.alloc(32000, 0x2a);
  const recording = wav([fmt, chunk("data", pcm, 0x80000000)], 0x80000024);

  withTempFile(recording, (file) => {
    assert.equal(repairUnfinalizedWavHeader(file), true);
    const repaired = fs.readFileSync(file);
    assert.equal(repaired.readUInt32LE(4), repaired.length - 8);
    assert.equal(repaired.readUInt32LE(40), pcm.length);
    assert.deepEqual(repaired.subarray(44), pcm);
  });
});

test("walks unknown and word-padded chunks before data", () => {
  const fmt = chunk("fmt ", Buffer.alloc(16));
  const custom = chunk("abcd", Buffer.from([1, 2, 3]));
  const pcm = Buffer.alloc(64, 0x7f);
  const recording = wav([fmt, custom, chunk("data", pcm, 0x80000000)], 0x80000024);

  withTempFile(recording, (file) => {
    assert.equal(repairUnfinalizedWavHeader(file), true);
    const repaired = fs.readFileSync(file);
    const dataSizeOffset = 12 + fmt.length + custom.length + 4;
    assert.equal(repaired.readUInt32LE(dataSizeOffset), pcm.length);
  });
});

test("does not rewrite a valid WAV with trailing bytes outside its RIFF form", () => {
  const fmt = chunk("fmt ", Buffer.alloc(16));
  const pcm = Buffer.alloc(64, 0x19);
  const recording = Buffer.concat([wav([fmt, chunk("data", pcm)]), Buffer.from("trailing")]);

  withTempFile(recording, (file) => {
    const before = fs.readFileSync(file);
    assert.equal(repairUnfinalizedWavHeader(file), false);
    assert.deepEqual(fs.readFileSync(file), before);
  });
});

test("leaves malformed and non-WAV files untouched", () => {
  const malformed = wav([chunk("broken", Buffer.alloc(0), 4096)], 0x80000024);

  for (const input of [Buffer.from("not a wave file"), malformed]) {
    withTempFile(input, (file) => {
      const before = fs.readFileSync(file);
      assert.equal(repairUnfinalizedWavHeader(file), false);
      assert.deepEqual(fs.readFileSync(file), before);
    });
  }
});
