import assert from "node:assert/strict";
import test from "node:test";
import { channelPoints } from "../apps/desktop/src/timeline.ts";

// Same look and expected values as `channel_points_match_the_preview` in timeline.rs.
export const sample = {
  wheels: { lift: { hue: 220, amount: 40, luma: 0 }, gamma: { hue: 0, amount: 0, luma: 20 }, gain: { hue: 40, amount: 30, luma: -10 } },
  rgbCurves: { g: [0, 200, 500, 800, 1000] },
};

test("neutral wheels and straight curves add no filter", () => {
  assert.equal(channelPoints({}), null);
  assert.equal(channelPoints({ wheels: { lift: { hue: 90, amount: 0, luma: 0 } }, rgbCurves: { r: [0, 250, 500, 750, 1000] } }), null);
});

test("colour wheels push hue per channel and keep curves inside 0–1", () => {
  const [r, g, b] = channelPoints(sample);
  for (const channel of [r, g, b]) {
    assert.equal(channel.length, 17);
    assert.ok(channel.every((value) => value >= 0 && value <= 1));
  }
  // A blue lift raises blue shadows more than red ones; the warm gain lifts red highlights.
  assert.ok(b[2] > r[2]);
  assert.ok(r[14] > b[14]);
  assert.deepEqual([r[0], r[8], r[16], g[4], g[8], b[0], b[8], b[16]],
    [0, 0.5434, 1, 0.2344, 0.5309, 0.1033, 0.4785, 0.809]);
});
