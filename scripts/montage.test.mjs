import assert from "node:assert/strict";
import test from "node:test";
import { montageSnapshot } from "../apps/desktop/src/montage.ts";

const clip = (assetId, kind, startMs, endMs) => ({ assetId, kind, startMs, endMs });
const visual = (id, startMs, endMs, score) => ({ clip: clip(id, "video", startMs, endMs), shots: [{ startMs, endMs, score }] });

test("highlight keeps chosen source ranges and adds editable joins and photo animation", () => {
  const inputs = [visual(1, 3000, 4800, 450), { clip: clip(2, "image", 0, 3000), shots: [] }, visual(3, 6000, 7700, 800)];
  const saved = montageSnapshot(inputs, "portrait", 5500, "dynamic");
  assert.equal(saved.aspect, "portrait");
  const [video, sound] = saved.tracks;
  assert.deepEqual(video.clips.map(({ assetId, startMs, endMs, positionMs }) => [assetId, startMs, endMs, positionMs]),
    [[1, 3000, 4800, 0], [2, 0, 2000, 1800], [3, 6000, 7700, 3800]]);
  assert.equal(video.clips[1].look.keyframes[1].atMs, 2000);
  assert.equal(video.clips[2].look.transition.fromAssetId, 2);
  assert.equal(sound.clips.length, 0);
});

test("soundtrack uses trim offset for beats and remains exactly as long as the pictures", () => {
  const levels = Array(200).fill(8);
  levels[60] = 200;
  const saved = montageSnapshot([visual(1, 0, 6000, 800), { clip: clip(2, "image", 0, 3000), shots: [] }],
    "source", 6000, "dynamic", { clip: clip(3, "audio", 1000, 6500), levels });
  const [video, sound] = saved.tracks;
  assert.equal(video.clips[1].positionMs, 2000);
  assert.equal(video.clips[0].look.volume, 0);
  assert.deepEqual([sound.clips[0].startMs, sound.clips[0].endMs], [1000, 6500]);
  assert.equal(video.clips.reduce((total, item) => total + item.endMs - item.startMs, 0), 5500);
});

test("short audio without beats still includes the video and photo when both fit", () => {
  const saved = montageSnapshot([visual(1, 0, 6000, 800), { clip: clip(2, "image", 0, 3000), shots: [] }],
    "source", 30_000, "soft", { clip: clip(3, "audio", 0, 3000), levels: [] });
  assert.deepEqual(saved.tracks[0].clips.map(({ assetId, positionMs }) => [assetId, positionMs]), [[1, 0], [2, 1500]]);
  assert.equal(saved.tracks[1].clips[0].endMs, 3000);
});
