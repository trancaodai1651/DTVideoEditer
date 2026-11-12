import assert from "node:assert/strict";
import test from "node:test";
import { montageSnapshot } from "../apps/desktop/src/montage.ts";

const clip = (assetId, kind, startMs, endMs, positionMs = 0, layer = 0) => ({ key: `clip-${assetId}`, assetId, kind, startMs, endMs, positionMs, layer });
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
    "source", 6000, "dynamic", [{ clip: clip(3, "audio", 1000, 6500), levels }]);
  const [video, sound] = saved.tracks;
  assert.equal(video.clips[1].positionMs, 2000);
  assert.equal(video.clips[0].look.volume, 0);
  assert.deepEqual([sound.clips[0].startMs, sound.clips[0].endMs], [1000, 6500]);
  assert.equal(video.clips.reduce((total, item) => total + item.endMs - item.startMs, 0), 5500);
});

test("short audio without beats still includes the video and photo when both fit", () => {
  const saved = montageSnapshot([visual(1, 0, 6000, 800), { clip: clip(2, "image", 0, 3000), shots: [] }],
    "source", 30_000, "soft", [{ clip: clip(3, "audio", 0, 3000), levels: [] }]);
  assert.deepEqual(saved.tracks[0].clips.map(({ assetId, positionMs }) => [assetId, positionMs]), [[1, 0], [2, 1500]]);
  assert.equal(saved.tracks[1].clips[0].endMs, 3000);
});

test("a long high-scoring shot leaves time for the other videos, even if analysis failed", () => {
  const sources = [visual(1, 0, 6000, 800), { clip: clip(2, "video", 3500, 9000), shots: [] }, visual(3, 0, 5000, 400)];
  const timeline = montageSnapshot(sources, "source", 3200, "soft");
  const video = timeline.tracks[0].clips;
  assert.deepEqual(video.map(({ assetId }) => assetId), [1, 2, 3]);
  assert.equal(video[1].startMs, 3500);
  assert.equal(video[2].positionMs + video[2].endMs - video[2].startMs, 3200);
});

test("multiple soundtrack clips retain overlap, offsets and layers while the mix guides cuts", () => {
  const levels = Array(200).fill(10);
  levels[24] = 245;
  const timeline = montageSnapshot([visual(1, 0, 6000, 800), visual(2, 0, 5000, 400)], "source", 4500, "dynamic", [
    { clip: clip(3, "audio", 500, 3300, 700, 0), levels: [] },
    { clip: clip(4, "audio", 0, 3500, 1700, 1), levels },
    { clip: clip(5, "audio", 0, 2000, 4100, 0), levels: [] },
  ]);
  assert.equal(timeline.tracks[0].clips[1].positionMs, 2200);
  assert.deepEqual(timeline.tracks[1].clips.map(({ positionMs, endMs, layer }) => [positionMs, endMs, layer]),
    [[0, 3300, 0], [1000, 3500, 1], [3400, 2000, 0]]);
});

test("automatic highlight has no length cap, trims around peaks and merges neighbouring standout windows", () => {
  const shots = [];
  for (let index = 0; index < 60; index += 1) {
    const startMs = index * 4000;
    shots.push({ startMs, endMs: startMs + 4000, score: index % 3 === 0 ? 900 : 100, peakMs: startMs + 3000 });
  }
  shots[1].score = 880;
  const source = { clip: clip(1, "video", 0, 240_000), shots };
  const timeline = montageSnapshot([source, { clip: clip(2, "image", 0, 3000), shots: [] }], "source", null, "dynamic");
  const video = timeline.tracks[0].clips;
  const total = video.reduce((sum, item) => sum + item.endMs - item.startMs, 0);
  assert.ok(video.length >= 20, `${video.length} pieces`);
  assert.ok(total > 50_000, `${total} ms`);
  assert.deepEqual([video[0].startMs, video[0].endMs], [500, 6750]);
  const single = video.find((item) => item.assetId === 1 && item.startMs >= 12_000);
  assert.deepEqual([single.startMs, single.endMs], [13_500, 16_000]);
  assert.equal(video[video.length - 1].assetId, 2);
});

test("rhythm cut follows the full soundtrack length and walks through footage before repeating", () => {
  const timeline = montageSnapshot([visual(1, 0, 6000, 800), {
    clip: clip(2, "video", 0, 20_000), shots: [0, 5000, 10_000, 15_000].map((startMs) => ({ startMs, endMs: startMs + 5000, score: 500 })),
  }], "source", 30_000, "soft", [{ clip: clip(3, "audio", 0, 200_000), levels: [] }]);
  const video = timeline.tracks[0].clips;
  assert.equal(video.reduce((sum, item) => sum + item.endMs - item.startMs, 0), 200_000);
  assert.equal(timeline.tracks[1].clips[0].endMs, 200_000);
  const firstTen = video.slice(0, 10).map(({ assetId, startMs }) => `${assetId}:${startMs}`);
  for (let index = 1; index < firstTen.length; index += 1) assert.notEqual(firstTen[index], firstTen[index - 1]);
  assert.ok(new Set(video.filter(({ assetId }) => assetId === 2).slice(0, 4).map(({ startMs }) => Math.floor(startMs / 5000))).size >= 4);
});
