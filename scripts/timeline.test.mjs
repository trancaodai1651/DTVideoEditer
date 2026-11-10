import assert from "node:assert/strict";
import test from "node:test";
import {
  addClip, clipFinish, clipLength, clipsAt, commit, moveClip, newHistory, place, redo, removeClip, snap, splitClip,
  toSnapshot, totalMs, trimEnd, trimStart, undo,
} from "../apps/desktop/src/timeline.ts";

const video = { assetId: 1, relativePath: "a.mp4", kind: "video", durationMs: 6000 };
const image = { assetId: 2, relativePath: "b.png", kind: "image", durationMs: null };
const audio = { assetId: 3, relativePath: "c.wav", kind: "audio", durationMs: 3000 };
const points = (clips) => clips.map((clip) => [clip.track, clip.startMs, clip.endMs, clip.positionMs]);

test("adds clips to the matching track without overlap", () => {
  let clips = addClip([], video);
  clips = addClip(clips, image);
  clips = addClip(clips, audio);
  assert.deepEqual(points(clips), [["video", 0, 6000, 0], ["video", 0, 3000, 6000], ["audio", 0, 3000, 0]]);
  // A drop onto an occupied range lands in the nearest free spot.
  clips = addClip(clips, image, 5500);
  assert.equal(clips.at(-1).positionMs, 9000);
  assert.equal(addClip([], { ...video, durationMs: null }), null);
  assert.equal(addClip([], { ...video, durationMs: 50 }), null);
  assert.equal(totalMs(clips), 12000);
});

test("trims within the source and neighbouring clips", () => {
  let clips = addClip(addClip([], video), video);
  const [first, second] = clips.map((clip) => clip.key);
  clips = trimStart(clips, first, 1500);
  assert.deepEqual(points(clips)[0], ["video", 1500, 6000, 1500]);
  clips = trimStart(clips, first, -9000);
  assert.deepEqual(points(clips)[0], ["video", 0, 6000, 0], "cannot extend before the source start");
  clips = trimEnd(clips, first, -2000);
  assert.deepEqual(points(clips)[0], ["video", 0, 4000, 0]);
  clips = trimEnd(clips, first, 9000);
  assert.deepEqual(points(clips)[0], ["video", 0, 6000, 0], "cannot extend past the source or the next clip");
  clips = trimEnd(clips, second, -99999);
  assert.equal(clipLength(clips[1]), 100, "keeps the minimum length");
  const unchanged = trimEnd(clips, second, -500);
  assert.equal(unchanged, clips, "a no-op returns the same array for history");

  let stills = addClip([], image, 2000);
  stills = trimStart(stills, stills[0].key, -1500);
  assert.deepEqual(points(stills)[0], ["video", 0, 4500, 500], "a still grows left and keeps its source at zero");
  stills = trimEnd(stills, stills[0].key, 10_000_000);
  assert.equal(clipLength(stills[0]), 600_000);
});

test("splits at the playhead and keeps source ranges continuous", () => {
  const base = addClip([], video);
  const split = splitClip(base, base[0].key, 2500);
  assert.deepEqual(points(split), [["video", 0, 2500, 0], ["video", 2500, 6000, 2500]]);
  assert.notEqual(split[0].key, split[1].key);
  assert.equal(splitClip(base, base[0].key, 50), null);
  assert.equal(splitClip(base, base[0].key, 5950), null);
  assert.equal(splitClip(base, "missing", 2500), null);

  const still = addClip([], image, 1000);
  assert.deepEqual(points(splitClip(still, still[0].key, 2000)), [["video", 0, 1000, 1000], ["video", 0, 2000, 2000]]);
  assert.deepEqual(clipsAt(split, 2500).map((clip) => clip.startMs), [2500]);
  assert.equal(removeClip(split, split[0].key).length, 1);
});

test("moves clips to free space and snaps to edges", () => {
  let clips = addClip(addClip([], video), image);
  const [first, second] = clips.map((clip) => clip.key);
  clips = moveClip(clips, second, 7000);
  assert.equal(clips[1].positionMs, 7000);
  clips = moveClip(clips, second, 5000);
  assert.equal(clips[1].positionMs, 6000, "an overlap resolves to the closest free edge");
  clips = moveClip(clips, first, -400);
  assert.equal(clips[0].positionMs, 0);
  assert.equal(place(clips, "video", 1000, 2000), 9000);
  assert.equal(place(clips, "audio", 1000, 2000), 2000);
  assert.equal(clipFinish(clips[1]), 9000);
  assert.equal(snap(5950, [0, 6000], 80), 6000);
  assert.equal(snap(5800, [0, 6000], 80), 5800);
  assert.equal(snap(5800, [], 80), 5800);
});

test("undo and redo walk committed edits", () => {
  const base = addClip([], video);
  const trimmed = trimEnd(base, base[0].key, -1000);
  const split = splitClip(trimmed, trimmed[0].key, 2000);
  let history = commit(commit(commit(newHistory(), base), trimmed), split);
  assert.equal(commit(history, split), history, "an unchanged edit adds no history");
  history = undo(history);
  assert.equal(history.present, trimmed);
  history = undo(undo(undo(undo(history))));
  assert.deepEqual(history.present, []);
  history = redo(redo(history));
  assert.equal(history.present, trimmed);
  history = commit(history, base);
  assert.equal(redo(history), history, "a new edit clears the redo stack");
});

test("snapshot matches the versioned native contract", () => {
  const clips = moveClip(addClip(addClip(addClip([], video), audio), image), addClip([], video)[0].key, 0);
  assert.deepEqual(toSnapshot(clips), {
    version: 2,
    tracks: [
      { kind: "video", clips: [
        { assetId: 1, startMs: 0, endMs: 6000, positionMs: 0 },
        { assetId: 2, startMs: 0, endMs: 3000, positionMs: 6000 },
      ] },
      { kind: "audio", clips: [{ assetId: 3, startMs: 0, endMs: 3000, positionMs: 0 }] },
    ],
  });
});
