import assert from "node:assert/strict";
import test from "node:test";
import {
  addAdjustment, addClip, addTitle, alignByAudio, clipFinish, clipLength, copyAttributes, createMulticam, followTrack, freezeFrame,
  fromTimeline, pasteAttributes, replaceClip, splitClip, toSnapshot, toggleReverse, tonePoints, trimEnd,
} from "../apps/desktop/src/timeline.ts";

const video = { assetId: 1, relativePath: "a.mp4", kind: "video", durationMs: 6000 };
const other = { assetId: 2, relativePath: "b.mp4", kind: "video", durationMs: 4000 };
const sticker = { assetId: 3, relativePath: "s.png", kind: "image", durationMs: null };
const song = { assetId: 4, relativePath: "c.wav", kind: "audio", durationMs: 9000 };

test("tone curve matches the native formula", () => {
  assert.equal(tonePoints({}), null);
  // timeline.rs Look::tone_points with exposure 100: doubled and clipped.
  assert.deepEqual(tonePoints({ exposure: 100 }), [0, 0.25, 0.5, 0.75, 1, 1, 1, 1, 1]);
  const lifted = tonePoints({ shadows: 50, blacks: 40 });
  assert.ok(lifted[0] > 0.05 && lifted[2] > 0.3 && lifted[8] === 1);
  const darker = tonePoints({ highlights: -100 });
  assert.ok(darker[6] < 0.75 - 0.1);
});

test("adjustment layers round-trip through the snapshot", () => {
  const clips = addAdjustment(addClip([], video), 1000, 0, { saturation: 0, exposure: 20 });
  const layer = clips[1];
  assert.deepEqual([layer.kind, layer.track, layer.positionMs, clipLength(layer)], ["adjustment", "text", 1000, 5000]);
  const snapshot = toSnapshot(clips);
  assert.deepEqual(snapshot.adjustments, [{ positionMs: 1000, durationMs: 5000, layer: 0, look: { saturation: 0, exposure: 20 } }]);
  assert.equal(snapshot.tracks[0].clips.length, 1);
  assert.equal(snapshot.titles, undefined);
  const reopened = fromTimeline({ version: 3, clips: [], titles: [], aspect: "source", lanes: [], adjustments: snapshot.adjustments });
  assert.deepEqual([reopened[0].kind, reopened[0].positionMs, clipLength(reopened[0])], ["adjustment", 1000, 5000]);
  const trimmed = trimEnd(clips, layer.key, -2000);
  assert.equal(clipLength(trimmed[1]), 3000);
  assert.equal(splitClip(clips, layer.key, 3000).length, 3);
});

test("attributes copy appearance only and paste onto matching clips", () => {
  let clips = addClip(addClip([], video), sticker, 6000);
  clips = clips.map((clip, index) => index === 0 ? { ...clip, look: { saturation: 40, hue: 30, lut: 7, speed: 200, multicam: 2, scale: 80 } } : clip);
  const copied = copyAttributes(clips[0]);
  assert.equal(copied.hue, 30);
  assert.equal(copied.lut, 7);
  assert.equal(copied.speed, undefined);
  assert.equal(copied.multicam, undefined);
  const pasted = pasteAttributes(clips, new Set([clips[1].key]), copied);
  assert.deepEqual([pasted[1].look.hue, pasted[1].look.saturation, pasted[1].look.scale, pasted[1].look.speed], [30, 40, 80, undefined]);
  const titled = addTitle(clips, 0, 0, { text: "A", size: 9, x: 0, y: 0, color: "white", colorHex: "#ff0000", font: "bold" });
  const style = copyAttributes(titled.at(-1));
  const second = addTitle(titled, 4000, 0, { text: "B", size: 5, x: 10, y: 10, color: "yellow" });
  const result = pasteAttributes(second, new Set([second.at(-1).key, second[0].key]), style);
  assert.deepEqual([result.at(-1).title.text, result.at(-1).title.colorHex, result.at(-1).title.font, result.at(-1).title.size], ["B", "#ff0000", "bold", 9]);
  assert.equal(result[0], second[0], "a title style does not land on a video clip");
});

test("replace keeps place and look, freeze inserts a still, reverse has limits", () => {
  const clips = addClip(addClip([], video), video);
  const graded = clips.map((clip, index) => index === 0 ? { ...clip, look: { saturation: 50 } } : clip);
  const replaced = replaceClip(graded, graded[0].key, other);
  assert.deepEqual([replaced[0].assetId, replaced[0].startMs, replaced[0].endMs, replaced[0].positionMs, replaced[0].look.saturation], [2, 0, 4000, 0, 50]);
  assert.throws(() => replaceClip(graded, graded[0].key, song), /cùng loại/);
  const still = replaceClip(graded, graded[0].key, sticker);
  assert.deepEqual([still[0].kind, clipLength(still[0])], ["image", 6000]);

  const frozen = freezeFrame(clips, clips[0].key, 2000);
  const [left, hold, right, next] = [...frozen].sort((a, b) => a.positionMs - b.positionMs);
  assert.deepEqual([left.endMs, hold.positionMs, clipLength(hold), hold.look.freezeAtMs, right.positionMs, right.startMs, next.positionMs], [2000, 2000, 3000, 2000, 5000, 2000, 9000]);
  assert.equal(toSnapshot(frozen).tracks[0].clips.find((clip) => clip.look?.freezeAtMs !== undefined).startMs, 0);
  assert.throws(() => freezeFrame(clips, clips[0].key, 9999), /playhead/);

  const reversed = toggleReverse(clips, clips[0].key);
  assert.equal(reversed[0].look.reverse, true);
  assert.equal(toggleReverse(reversed, clips[0].key)[0].look.reverse, undefined);
  const long = addClip([], { ...video, durationMs: 70_000 });
  assert.throws(() => toggleReverse(long, long[0].key), /60 giây/);
  assert.throws(() => toggleReverse(frozen, hold.key), /video hoặc âm thanh/);
});

test("multicam lines up by audio offset and tracking applies scale and rotation", () => {
  let angles = addClip(addClip([], video), other, 0, 1);
  angles = alignByAudio(angles, angles[0].key, { [angles[1].key]: 700 });
  assert.deepEqual([angles[1].positionMs, angles[1].startMs], [0, 700], "the later take starts 0.7 s into its source");
  const early = alignByAudio(addClip(addClip([], video, 2000), other, 0, 1), addClip(addClip([], video, 2000), other, 0, 1)[0].key, {});
  assert.equal(early.length, 2);
  const shifted = alignByAudio(angles, angles[0].key, { [angles[1].key]: -500 });
  assert.equal(shifted[1].positionMs, 500);
  const cam = createMulticam(shifted, new Set(shifted.map((clip) => clip.key)), true);
  assert.deepEqual(cam.map((clip) => clip.positionMs), [0, 500]);

  const clips = addClip(addClip([], video), sticker, 0, 1);
  const tracked = followTrack(clips, clips[0].key, clips[1].key, [
    { atMs: 0, x: 500, y: 500, scale: 1000, angle: 0 },
    { atMs: 1000, x: 600, y: 500, scale: 1500, angle: 30 },
  ]);
  const keys = tracked[1].look.keyframes;
  assert.deepEqual(keys.at(-1), { atMs: 1000, x: 10, y: 0, scale: 150, rotate: 30, opacity: 100, smooth: true });
  assert.ok(clipFinish(tracked[1]) > 1000);
});
