import assert from "node:assert/strict";
import test from "node:test";
import { buildTemplate } from "../apps/desktop/src/template.ts";

test("fills reference cuts exactly and maps music, sound and voice to separate layers", () => {
  const video = { id: 1, kind: "video", durationMs: 1000 };
  const image = { id: 2, kind: "image", durationMs: null };
  const audio = { id: 3, kind: "audio", durationMs: 750 };
  const output = buildTemplate({
    aspect: "portrait", scenes: [1050, 1200], visuals: [video, image], audio: [audio, audio, audio],
    look: { saturation: 0, motion: "slide", fadeMs: 200 }, title: "Thử mẫu %", keepSound: false,
  });
  assert.deepEqual(output.tracks[0].clips.map(({ positionMs, endMs }) => [positionMs, endMs]), [[0, 950], [950, 100], [1050, 1200]]);
  assert.deepEqual(output.tracks[1].clips.map(({ layer }) => layer), [0, 0, 0, 1, 2]);
  assert.equal(output.tracks[0].clips[0].look.volume, 0);
  assert.equal(output.titles[0].durationMs, 2250);
});
