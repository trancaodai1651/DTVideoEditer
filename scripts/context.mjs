import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const memory = "docs/memory";
const summary = ["PROJECT_INDEX", "CURRENT_STATE", "HANDOFF"];
const files = [
  ...summary, "ARCHITECTURE", "FEATURE_MAP", "TASK_BACKLOG", "DECISIONS", "CHANGELOG", "API_INTEGRATIONS", "SECURITY",
  "modules/desktop", "modules/media-library", "modules/persistence", "modules/workflows",
].map((name) => `${memory}/${name}.md`);
const entries = ["AGENTS.md", "CLAUDE.md", "README.md"];
const load = (path) => readFileSync(join(root, path), "utf8");
const mode = process.argv[2];

try {
  if (mode === "summary") {
    for (const name of summary) console.log(load(`${memory}/${name}.md`));
  } else if (mode === "check") {
    const modules = readdirSync(join(root, memory, "modules")).filter((name) => name.endsWith(".md"))
      .map((name) => `${memory}/modules/${name}`);
    for (const path of new Set([...entries, ...files, ...modules])) {
      const text = load(path);
      for (const [, href] of text.matchAll(/\]\(([^\s)]+)\)/g)) {
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
        const target = resolve(root, dirname(path), decodeURIComponent(href.split("#", 1)[0]));
        if (!existsSync(target)) throw new Error(`Broken relative link in ${path}: ${href}`);
      }
    }
    for (const path of ["AGENTS.md", "CLAUDE.md"]) {
      if (summary.some((name) => !load(path).includes(`${memory}/${name}.md`))) {
        throw new Error(`Incomplete reading map: ${path}`);
      }
    }
    if (load(`${memory}/PROJECT_INDEX.md`).split(/\r?\n/).length > 150) throw new Error("PROJECT_INDEX.md exceeds 150 lines.");
    const snapshots = ["CURRENT_STATE", "HANDOFF", "CHANGELOG"].map((name) =>
      load(`${memory}/${name}.md`).match(/^Snapshot: (\S+)\s*$/m)?.[1],
    );
    if (!snapshots[0] || snapshots.some((value) => value !== snapshots[0])) {
      throw new Error("CURRENT_STATE, HANDOFF and CHANGELOG have inconsistent snapshot IDs.");
    }
    const active = load(`${memory}/CURRENT_STATE.md`).match(/^Next task: ([\w-]+)\s*$/m)?.[1];
    if (!active || !load(`${memory}/TASK_BACKLOG.md`).includes(`| ${active} |`)
      || !load(`${memory}/HANDOFF.md`).includes(active)) {
      throw new Error("The next task must match a backlog entry and the handoff.");
    }
    console.log(`Shared context verified (${snapshots[0]}).`);
  } else {
    throw new Error("Use 'check' or 'summary'.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
