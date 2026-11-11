import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TIMELINE_MS, addCaptions, addClip, addTitle, changeLayer, clipFinish, clipLength, clipsAt, commit, moveClip, newHistory, offsetVisual, place, redo, removeClip, snap, splitClip, subtitleCues, updateAppearance,
  deleteSelection, groupSelection, lookAt, moveSelection, pasteSelection, setTransformKey,
  toSnapshot, totalMs, transitionBetween, trimClip, trimEnd, trimStart, undo,
} from "../apps/desktop/src/timeline.ts";

const video = { assetId: 1, relativePath: "a.mp4", kind: "video", durationMs: 6000 };
const image = { assetId: 2, relativePath: "b.png", kind: "image", durationMs: null };
const audio = { assetId: 3, relativePath: "c.wav", kind: "audio", durationMs: 3000 };
const points = (clips) => clips.map((clip) => [clip.track, clip.startMs, clip.endMs, clip.positionMs]);

test("main track magnet and linkage move following clips independently", () => {
  const clips = addTitle(addClip(addClip([], video), video), 6200, 0);
  const first = clips[0].key;
  const starts = (edits) => edits.map((clip) => clip.positionMs);
  assert.deepEqual(starts(trimClip(clips, first, "end", -200, false, true)), [0, 6000, 6200]);
  assert.deepEqual(starts(trimClip(clips, first, "end", -200, true, false)), [0, 5800, 6200]);
  assert.deepEqual(starts(trimClip(clips, first, "end", -200, true, true)), [0, 5800, 6000]);
  assert.deepEqual(starts(deleteSelection(clips, new Set([first]), true, true)), [0, 200]);
});

test("moving and pasting groups preserve each lane and relative start", () => {
  const base = addTitle(addClip([], video), 300, 0);
  const keys = new Set(base.map((clip) => clip.key));
  const group = groupSelection(base, keys);
  const snapshot = toSnapshot(group);
  const groupId = snapshot.tracks[0].clips[0].look.editGroup;
  assert.ok(groupId > 0);
  assert.equal(snapshot.titles[0].editGroup, groupId);
  const moved = moveSelection(group, keys, 1500);
  assert.deepEqual(moved.map((clip) => clip.positionMs), [1500, 1800]);
  const pasted = pasteSelection(group, group, 7200);
  assert.deepEqual(pasted.slice(2).map((clip) => clip.positionMs), [7200, 7500]);
  assert.notEqual(toSnapshot(pasted).titles[1].editGroup, groupId);
});

test("interpolates transform keyframes and preserves the split boundary", () => {
  const [base] = addClip([], video);
  const first = setTransformKey(base, 0, { x: 0, scale: 100 });
  const animated = setTransformKey(first, 2000, { x: 40, scale: 200 });
  assert.equal(lookAt(animated, 1000).x, 20);
  assert.equal(lookAt(animated, 1000).scale, 150);
  const [left, right] = splitClip([animated], animated.key, 1000);
  assert.equal(lookAt(left, 1000).scale, 150);
  assert.equal(lookAt(right, 0).scale, 150);
  assert.equal(lookAt(right, 1000).x, 40);
});

test("a join disappears across a gap and returns after undo", () => {
  const [left, right] = addClip(addClip([], video), image);
  const joined = [left, { ...right, look: { transition: {
    kind: "dissolve", durationMs: 400, fromAssetId: left.assetId, fromStartMs: left.startMs,
  } } }];
  assert.equal(transitionBetween(...joined)?.durationMs, 400);
  const gap = trimClip(joined, left.key, "end", -200, false, false);
  assert.equal(transitionBetween(...gap), undefined);
  assert.equal(transitionBetween(...undo(commit(commit(newHistory(), joined), gap)).present)?.kind, "dissolve");
});

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

test("moving between layers uses the destination lane and preserves the source range", () => {
  const clips = addClip(addClip([], video), image, 1500, 1);
  const [clip] = clips;
  const moved = moveClip(clips, clip.key, 1000, 1);
  assert.deepEqual([moved[0].layer, moved[0].positionMs], [1, 4500]);
  assert.deepEqual([moved[0].startMs, moved[0].endMs], [clip.startMs, clip.endMs]);
  assert.equal(moveClip(clips, clip.key, 0, -1), clips);
  const atLimit = moveClip(clips, clip.key, MAX_TIMELINE_MS + 1000, 1);
  assert.equal(clipFinish(atLimit[0]), MAX_TIMELINE_MS);
});

test("dragged overlays save position in the render snapshot and undo in one step", () => {
  const clips = addTitle(addClip([], image), 0, 0);
  const base = commit(newHistory(), clips);
  const moved = offsetVisual(clips[0], 22.5, -140);
  const history = commit(base, updateAppearance(clips, moved));
  const snapshot = toSnapshot(history.present);
  assert.deepEqual([snapshot.tracks[0].clips[0].look.x, snapshot.tracks[0].clips[0].look.y], [23, -100]);
  assert.equal(undo(history).present, clips);
  assert.equal(offsetVisual(moved, 0, -20), moved);
  assert.equal(offsetVisual(clips[1], 0, -10).title.y, 56);
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
    version: 3,
    tracks: [
      { kind: "video", clips: [
        { assetId: 1, startMs: 0, endMs: 6000, positionMs: 0 },
        { assetId: 2, startMs: 0, endMs: 3000, positionMs: 6000 },
      ] },
      { kind: "audio", clips: [{ assetId: 3, startMs: 0, endMs: 3000, positionMs: 0 }] },
    ],
  });
});

test("overlaps independent video/audio layers and round-trips editable titles", () => {
  let clips = addClip(addClip([], video, 0), image, 0, 1);
  clips = addClip(addClip(clips, audio, 0), audio, 0, 2);
  clips = addTitle(clips, 100, 1);
  assert.equal(clipsAt(clips, 200).length, 5);
  const saved = toSnapshot(clips, "portrait");
  assert.equal(saved.tracks[0].clips[1].layer, 1);
  assert.equal(saved.tracks[1].clips[1].layer, 2);
  assert.equal(saved.aspect, "portrait");
  assert.equal(saved.titles[0].positionMs, 100);
  clips = changeLayer(clips, clips[1].key, 0);
  assert.equal(clips[1].positionMs, 6000);
});

test("retimes source ranges and splits without shifting the following clip", () => {
  let clips = addClip([], video);
  clips = updateAppearance(clips, { ...clips[0], look: { speed: 150 } });
  clips = addClip(clips, image);
  assert.equal(clips[1].positionMs, 4000);
  const split = splitClip(clips, clips[0].key, 1750);
  assert.equal(split[0].endMs, 2625);
  assert.equal(split[1].positionMs, 1750);
  assert.equal(clipFinish(split[1]), 4000);
  assert.equal(trimStart(clips, clips[0].key, 1000)[0].startMs, 1500);
  assert.equal(trimEnd(clips, clips[0].key, -1000)[0].endMs, 4500);
});

test("imports overlapping captions in separate lanes and exports their exact times", () => {
  const cues = [{ startMs: 0, endMs: 1200, text: "Một" }, { startMs: 900, endMs: 1800, text: "Hai" }];
  const edited = addCaptions([], cues, 500);
  assert.deepEqual(edited.map((clip) => clip.layer), [0, 1]);
  assert.equal(toSnapshot(edited).titles[1].background, true);
  assert.deepEqual(subtitleCues(edited), cues.map((cue) => ({
    ...cue, startMs: cue.startMs + 500, endMs: cue.endMs + 500,
  })));
});
