import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const output = new URL("../apps/desktop/src-tauri/assets/studio/", import.meta.url);
mkdirSync(output, { recursive: true });
const write = (name, data) => writeFileSync(new URL(name, output), data);

function wave(name, seconds, signal) {
  const rate = 24000;
  const count = Math.round(seconds * rate);
  const data = Buffer.alloc(44 + count * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36);
  data.writeUInt32LE(count * 2, 40);
  for (let sample = 0; sample < count; sample++) {
    const time = sample / rate;
    const edge = Math.min(1, time * 80, (seconds - time) * 80);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, signal(time))) * edge * 32767), 44 + sample * 2);
  }
  write(name, data);
}

const tone = (frequency, time) => Math.sin(2 * Math.PI * frequency * time);
const music = (notes, beat, bright) => (time) => {
  const step = Math.floor(time / beat);
  const elapsed = time - step * beat;
  const note = notes[step % notes.length];
  const envelope = Math.min(1, elapsed * 100) * Math.exp(-elapsed * 5);
  return envelope * (0.24 * tone(note, elapsed) + 0.08 * tone(note * 2, elapsed)
    + (bright ? 0.05 * tone(note * 3, elapsed) : 0.1 * tone(note / 2, elapsed)));
};
wave("soft-steps.wav", 8, music([261.63, 329.63, 392, 523.25, 220, 261.63, 329.63, 440], 0.5, false));
wave("city-pulse.wav", 8, music([220, 220, 329.63, 440, 196, 196, 293.66, 392], 0.25, true));
wave("bright-chime.wav", 0.75, (t) => (tone(659.25, t) + 0.45 * tone(987.77, t)) * Math.exp(-t * 6) * 0.42);
wave("pop-click.wav", 0.25, (t) => tone(430 - t * 600, t) * Math.exp(-t * 28) * 0.63);
wave("sweep.wav", 0.5, (t) => tone(140 + 1700 * t, t) * Math.sin(t * 2 * Math.PI) ** 2 * 0.35);

function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  const output = Buffer.alloc(bytes.length + 8);
  output.writeUInt32BE(data.length);
  bytes.copy(output, 4);
  output.writeUInt32BE(crc32(bytes), output.length - 4);
  return output;
}

const inside = (points, x, y) => points.reduce((hit, [px, py], index) => {
  const [qx, qy] = points[(index + 1) % points.length];
  return (py > y) !== (qy > y) && x < (qx - px) * (y - py) / (qy - py) + px ? !hit : hit;
}, false);
const polygon = (points) => (x, y) => inside(points, x, y);
const star = Array.from({ length: 10 }, (_, index) => {
  const angle = (index - 2.5) * Math.PI / 5;
  const radius = index % 2 === 0 ? 0.92 : 0.45;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
});

function sticker(name, color, shape) {
  const size = 192;
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = y * (1 + size * 4) + 1 + x * 4;
      const count = [0.25, 0.75].flatMap((dx) => [0.25, 0.75].map((dy) =>
        shape((x + dx) * 2 / size - 1, (y + dy) * 2 / size - 1))).filter(Boolean).length;
      rows[at] = color[0]; rows[at + 1] = color[1]; rows[at + 2] = color[2]; rows[at + 3] = Math.round(count * 255 / 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  write(name, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0)),
  ]));
}

sticker("gold-star.png", [255, 195, 74], polygon(star));
sticker("teal-arrow.png", [48, 228, 207], polygon([[-0.89, -0.22], [0.15, -0.22], [0.15, -0.69], [0.91, 0], [0.15, 0.69], [0.15, 0.22], [-0.89, 0.22]]));
sticker("pink-heart.png", [255, 119, 159], (x, y) => {
  const cx = x * 1.32; const cy = -(y - 0.12) * 1.5;
  return (cx * cx + cy * cy - 1) ** 3 - cx * cx * cy ** 3 < 0;
});
sticker("focus-ring.png", [139, 194, 255], (x, y) => Math.abs(Math.hypot(x, y) - 0.78) < 0.09);
sticker("violet-bubble.png", [171, 147, 250], (x, y) => (x * x / 0.86 ** 2 + (y + 0.13) ** 2 / 0.63 ** 2 < 1)
  || inside([[-0.50, 0.2], [-0.08, 0.35], [-0.51, 0.83]], x, y));
sticker("amber-spark.png", [252, 216, 130], (x, y) => Math.abs(x) ** 0.62 + Math.abs(y) ** 0.62 < 0.92);
sticker("mint-check.png", [87, 236, 163], polygon([[-.84, .04], [-.64, -.16], [-.29, .19], [.62, -.72], [.83, -.52], [-.29, .6]]));
sticker("coral-cross.png", [255, 105, 124], (x, y) => Math.hypot(x, y) < .87 && (Math.abs(x - y) < .24 || Math.abs(x + y) < .24));
sticker("lemon-bolt.png", [255, 226, 83], polygon([[.18, -.92], [-.68, .17], [-.08, .17], [-.25, .92], [.74, -.25], [.15, -.25]]));
sticker("blue-drop.png", [73, 181, 251], (x, y) => Math.hypot(x, y - .28) < .56 || inside([[0, -.92], [-.49, .04], [.49, .04]], x, y));
sticker("orange-pin.png", [255, 130, 75], (x, y) => Math.hypot(x, y + .24) >= .22 && (Math.hypot(x, y + .24) < .58 || inside([[-.51, .02], [.51, .02], [0, .92]], x, y)));
sticker("violet-play.png", [174, 141, 255], polygon([[-.49, -.76], [.84, 0], [-.49, .76]]));
sticker("red-record.png", [247, 82, 102], (x, y) => Math.hypot(x, y) < .54 || Math.abs(Math.hypot(x, y) - .82) < .06);
sticker("white-frame.png", [245, 252, 255], (x, y) => {
  const [a, b] = [Math.abs(x), Math.abs(y)];
  return Math.max(a, b) < .86 && Math.max(a, b) > .69 && Math.min(a, b) > .42;
});
sticker("pink-flower.png", [255, 132, 205], (x, y) => Math.hypot(x, y) < .56 ||
  Array.from({ length: 5 }, (_, index) => index * Math.PI * 2 / 5).some((angle) =>
    Math.hypot(x - .53 * Math.cos(angle), y - .53 * Math.sin(angle)) < .32));
sticker("aqua-wave.png", [83, 222, 231], (x, y) => Math.abs(x) < .86 && [-.42, 0, .42].some((line) => Math.abs(y - line - .15 * Math.sin(x * 5)) < .085));
sticker("lilac-crescent.png", [181, 157, 247], (x, y) => Math.hypot(x + .1, y) < .8 && Math.hypot(x - .3, y + .25) > .7);
sticker("mint-leaf.png", [117, 219, 127], (x, y) => {
  const u = (x - y) / Math.SQRT2;
  const v = (x + y) / Math.SQRT2;
  return (u / .88) ** 2 + (v / .45) ** 2 < 1 && !(Math.abs(v) < .04 && u < .65);
});
