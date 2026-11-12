import assert from "node:assert/strict";
import test from "node:test";
import {
  addClip, beatTimes, clipBeatMarkers, clipLength, clipLevelAt, clipsInBox, compoundBlocks, createCompound, createMulticam, curveSegments,
  detachAudio, followTrack, multicamAngles, releaseCompound, releaseMulticam, removeSilences, renameCompound, restoreAudio, setDisabled,
  setSpeed, silentRanges, trimClip, clipFinish, sourcePosition, speedCurvePresets, splitAtSourceTimes, splitClip, switchAngle, toSnapshot, validCurve,
} from "../apps/desktop/src/timeline.ts";

const video = { assetId: 1, relativePath: "a.mp4", kind: "video", durationMs: 6000 };
const second = { assetId: 4, relativePath: "b.mp4", kind: "video", durationMs: 6000 };
const sticker = { assetId: 2, relativePath: "s.png", kind: "image", durationMs: null };
const keys = (...clips) => new Set(clips.map((clip) => clip.key));

test("speed curves match the native segment maths and drive preview time", () => {
  const curve = [{ at: 0, speed: 100 }, { at: 500, speed: 400 }, { at: 1000, speed: 100 }];
  const base = addClip([], { ...video, durationMs: 4800 });
  const [curved] = setSpeed(base, base[0].key, 100, curve);
  // timeline.rs: speed_curves_fix_length_and_detached_audio_fits_audio_tracks
  assert.equal(curveSegments(4800, curve)[0][2], 112);
  assert.equal(clipLength(curved), 2213);
  assert.equal(curved.look.speed, 100);
  assert.deepEqual(sourcePosition(curved, 0), { offset: 0, rate: 1.12 });
  assert.equal(Math.round(sourcePosition(curved, clipLength(curved) - 1).offset), 4799);
  assert.ok(sourcePosition(curved, 1100).rate > 3);
  assert.throws(() => setSpeed(base, base[0].key, 100, [{ at: 0, speed: 5 }, { at: 1000, speed: 100 }]));
  assert.ok(speedCurvePresets.every((preset) => validCurve(preset.points)));
  const [slow] = setSpeed(base, base[0].key, 10);
  assert.equal(clipLength(slow), 48_000);
  const blocked = addClip(addClip([], video), video);
  const pushed = setSpeed(blocked, blocked[0].key, 50);
  assert.deepEqual(pushed.map((item) => [item.positionMs, clipLength(item)]), [[0, 12_000], [12_000, 6000]], "the next clip moves out of the way");
  assert.deepEqual(setSpeed(pushed, pushed[0].key, 200).map((item) => item.positionMs), [0, 3000], "and closes up again");

  const pieces = splitClip([curved], curved.key, 1000);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((piece) => validCurve(piece.look.speedCurve)));
  assert.equal(pieces[0].endMs, pieces[1].startMs);
  assert.ok(Math.abs(clipLength(pieces[0]) + clipLength(pieces[1]) - 2213) <= 40);
});

test("detached audio becomes its own clip and restores in one step", () => {
  const base = addClip(addClip([], video), { assetId: 3, relativePath: "c.wav", kind: "audio", durationMs: 3000 });
  const withGain = base.map((clip, index) => index === 0 ? { ...clip, look: { gainDb: -6, audioFadeInMs: 400 } } : clip);
  const detached = detachAudio(withGain, withGain[0].key);
  assert.equal(detached.length, 3);
  const sound = detached[2];
  assert.deepEqual([sound.track, sound.kind, sound.layer, sound.positionMs], ["audio", "video", 1, 0], "audio 1 is busy at 0 s");
  assert.deepEqual(sound.look, { gainDb: -6, audioFadeInMs: 400, audioLink: 1 });
  assert.equal(detached[0].look.audioDetached, true);
  assert.equal(detachAudio(detached, detached[0].key), detached, "detaching twice does nothing");
  const snapshot = toSnapshot(detached);
  assert.equal(snapshot.tracks[1].clips.find((clip) => clip.assetId === 1).look.audioLink, 1);
  const split = splitClip(detached, sound.key, 1000);
  const restored = restoreAudio(split, detached[0].key);
  assert.equal(restored.length, 2);
  assert.equal(restored[0].look.audioDetached, undefined);
  assert.equal(restored[0].look.audioLink, undefined);
});

test("disabled clips, compounds and multicam angles", () => {
  const two = addClip(addClip([], video), sticker, 6000);
  const off = setDisabled(two, keys(two[0]), true);
  assert.equal(off[0].look.disabled, true);
  assert.equal(setDisabled(off, keys(off[0]), false)[0].look.disabled, undefined);

  const compound = createCompound(two, keys(...two), " Mở đầu ");
  const [block] = compoundBlocks(compound);
  assert.deepEqual([block.name, block.start, block.end, block.keys.length, block.track, block.layer], ["Mở đầu", 0, 9000, 2, "video", 0]);
  assert.equal(createCompound(two, keys(two[0]), "Một"), two, "needs two clips");
  assert.equal(compoundBlocks(renameCompound(compound, block.id, "Đoạn A"))[0].name, "Đoạn A");
  assert.deepEqual(compoundBlocks(releaseCompound(compound, block.id)), []);

  let angles = addClip(addClip([], video), second, 500, 1);
  angles = createMulticam(angles, keys(...angles));
  assert.deepEqual(angles.map((clip) => [clip.positionMs, clip.look.multicam, clip.look.disabled]), [[0, 1, undefined], [0, 1, true]]);
  assert.deepEqual(multicamAngles(angles, 1), [0, 1]);
  const cut = switchAngle(angles, 1, 1, 2000);
  assert.equal(cut.length, 4);
  const at = (layer, time) => cut.find((clip) => (clip.layer ?? 0) === layer && clip.positionMs <= time && time < clip.positionMs + clipLength(clip));
  assert.equal(at(0, 1000).look.disabled, undefined);
  assert.equal(at(1, 1000).look.disabled, true);
  assert.equal(at(0, 3000).look.disabled, true);
  assert.equal(at(1, 3000).look.disabled, undefined);
  const back = switchAngle(cut, 1, 0, 4000);
  assert.equal(back.find((clip) => (clip.layer ?? 0) === 0 && clip.positionMs === 4000).look.disabled, undefined);
  assert.equal(back.find((clip) => (clip.layer ?? 0) === 0 && clip.positionMs === 2000).look.disabled, true, "earlier cuts stay");
  assert.ok(releaseMulticam(back, 1).every((clip) => clip.look.multicam === undefined));
  const sameLayer = addClip(addClip([], video), second);
  assert.throws(() => createMulticam(sameLayer, keys(...sameLayer)), /tầng video riêng/);
});

test("scene cuts, silences, beats and the level meter", () => {
  const base = addClip([], video);
  const scenes = splitAtSourceTimes(base, base[0].key, [4000, 1500, 9000]);
  assert.deepEqual(scenes.map((clip) => [clip.startMs, clip.endMs, clip.positionMs]), [[0, 1500, 0], [1500, 4000, 1500], [4000, 6000, 4000]]);

  // 6 s of levels: loud, 1.5 s quiet from 2 s, loud again.
  const levels = Array.from({ length: 120 }, (_, index) => index >= 40 && index < 70 ? 10 : 200);
  assert.deepEqual(silentRanges(levels, -42, 600), [[2000, 3500]]);
  const follower = addClip(base, sticker, 6000);
  const trimmed = removeSilences(follower, follower[0].key, levels);
  const pieces = trimmed.filter((clip) => clip.assetId === 1).sort((a, b) => a.positionMs - b.positionMs);
  assert.deepEqual(pieces.map((clip) => [clip.startMs, clip.endMs, clip.positionMs]), [[0, 2120, 0], [3380, 6000, 2120]]);
  assert.equal(trimmed.find((clip) => clip.assetId === 2).positionMs, 4740, "the next clip on the lane closes the gap");

  const pulse = Array.from({ length: 80 }, (_, index) => index % 10 === 0 ? 230 : 120);
  assert.deepEqual(beatTimes(pulse), [500, 1000, 1500, 2000, 2500, 3000, 3500]);
  assert.deepEqual(clipBeatMarkers({ ...base[0], startMs: 1000, positionMs: 2000 }, pulse), [2000, 2500, 3000, 3500, 4000, 4500]);
  assert.ok(Math.abs(clipLevelAt(base[0], levels, 100) - (200 * 60 / 255 - 60)) < 0.01);
  assert.equal(clipLevelAt(base[0], levels, 7000), null);
});

test("tracking points become smooth position keys on an overlay", () => {
  const clips = addClip(addClip([], video), sticker, 1000, 1);
  const points = Array.from({ length: 41 }, (_, index) => ({ atMs: index * 100, x: 300 + index * 10, y: 500 }));
  const tracked = followTrack(clips, clips[0].key, clips[1].key, points);
  const keysOn = tracked[1].look.keyframes;
  assert.ok(keysOn.length <= 32 && keysOn.length > 10);
  assert.deepEqual(keysOn[0], { atMs: 0, x: -10, y: 0, scale: 100, rotate: 0, opacity: 100, smooth: true });
  assert.equal(keysOn.at(-1).atMs, 3000);
  assert.equal(keysOn.at(-1).x, 20);
  assert.throws(() => followTrack(clips, clips[0].key, clips[1].key, [{ atMs: 5000, x: 1, y: 1 }]), /không trùng/);
  assert.deepEqual(clipsInBox(clips, 4500, 500, [{ track: "video", layer: 1 }]), [clips[1].key]);
});

test("Q and W delete before or after the playhead and close the gap", () => {
  const clips = addClip(addClip([], video), video);
  const left = trimClip(clips, clips[0].key, "start", 2000, true, true);
  assert.deepEqual(left.map((clip) => [clip.startMs, clip.endMs, clip.positionMs]), [[2000, 6000, 0], [0, 6000, 4000]]);
  const right = trimClip(clips, clips[0].key, "end", 2000 - clipFinish(clips[0]), true, true);
  assert.deepEqual(right.map((clip) => [clip.startMs, clip.endMs, clip.positionMs]), [[0, 2000, 0], [0, 6000, 2000]]);
});
