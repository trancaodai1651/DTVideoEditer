import type { Aspect, Asset, ClipEdit, ClipLook, TimelineSnapshot } from "./desktop";
import { MAX_IMAGE_MS, MIN_CLIP_MS, TIMELINE_VERSION, defaultTitle } from "./timeline.ts";

interface Options {
  aspect: Aspect;
  scenes: number[];
  visuals: Asset[];
  audio: (Asset | undefined)[];
  look: Partial<ClipLook>;
  title: string;
  keepSound: boolean;
}

/** Fills an exact slot with source ranges. Short media repeats from its in point. */
function fill(asset: Asset, duration: number, at: number, layer: number, look: Partial<ClipLook>, loop: boolean): ClipEdit[] {
  const available = asset.kind === "image" ? MAX_IMAGE_MS : asset.durationMs ?? 0;
  if (available < MIN_CLIP_MS) throw new Error("Một tệp nguồn chưa có thời lượng hợp lệ.");
  const count = loop ? Math.ceil(duration / available) : 1;
  if (count > 200) throw new Error("Một tệp quá ngắn để lặp trong đoạn mẫu. Hãy chọn nguồn dài hơn.");
  const edits: ClipEdit[] = [];
  let remaining = duration;
  for (let index = 0; index < count; index++) {
    let length = Math.min(available, remaining);
    if (remaining > length && remaining - length < MIN_CLIP_MS && length >= 2 * MIN_CLIP_MS) {
      length -= MIN_CLIP_MS - (remaining - length);
    }
    if (length < MIN_CLIP_MS) {
      // Two short adjacent source ranges can share the slot more evenly.
      const previous = edits.at(-1);
      if (!previous || previous.endMs - (MIN_CLIP_MS - length) < MIN_CLIP_MS) {
        throw new Error("Tệp nguồn quá ngắn cho điểm cắt này. Hãy chọn nguồn khác.");
      }
      const shift = MIN_CLIP_MS - length;
      previous.endMs -= shift;
      at -= shift;
      length = MIN_CLIP_MS;
    }
    edits.push({ assetId: asset.id, startMs: 0, endMs: length, positionMs: at, layer, look });
    at += length;
    remaining -= length;
  }
  return edits;
}

export function buildTemplate({ aspect, scenes, visuals, audio, look, title, keepSound }: Options): TimelineSnapshot {
  let cursor = 0;
  const video = scenes.flatMap((duration, index) => {
    const asset = visuals[index];
    if (!asset || asset.kind === "audio") throw new Error("Chọn video hoặc ảnh cho từng đoạn.");
    const clips = fill(asset, duration, cursor, 0, { ...look, volume: keepSound ? 100 : 0 }, true);
    cursor += duration;
    return clips;
  });
  const sound = audio.flatMap((asset, layer) => asset ? fill(asset, cursor, 0, layer, {
    volume: layer === 0 ? 30 : 100, fadeMs: layer === 0 ? 250 : 0,
  }, layer === 0) : []);
  if (video.length > 200) throw new Error("Mẫu tạo quá nhiều đoạn lặp. Hãy chọn tệp nguồn dài hơn.");
  return {
    version: TIMELINE_VERSION, aspect,
    tracks: [{ kind: "video", clips: video }, { kind: "audio", clips: sound }],
    titles: title.trim() ? [{ ...defaultTitle, text: title.trim(), positionMs: 0, durationMs: Math.min(cursor, 3000), layer: 0 }] : [],
  };
}
