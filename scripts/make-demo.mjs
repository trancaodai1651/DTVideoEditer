import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "studio-demo-"));

function generate(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg exited with status ${result.status}`);
}

try {
  generate([
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac",
    "-movflags", "+faststart", join(folder, "Video mẫu.mp4"),
  ]);
  generate(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "pcm_s16le", join(folder, "Âm thanh mẫu.wav")]);
  copyFileSync(new URL("../apps/desktop/src-tauri/icons/icon.png", import.meta.url), join(folder, "Ảnh mẫu.png"));
  console.log(folder);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
