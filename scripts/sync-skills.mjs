import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG = "skills/catalog";
const LOCK = "skills/sync-lock.json";
const TARGETS = [".agents/skills", ".claude/skills"];
const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function regularPath(root, name) {
  let full = root;
  for (const part of name.split("/")) {
    full = join(full, part);
    const stat = lstatSync(full, { throwIfNoEntry: false });
    if (!stat) return undefined;
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${name}`);
  }
  return full;
}

function read(root, path) {
  const full = regularPath(root, path);
  if (!full) return undefined;
  if (!lstatSync(full).isFile()) throw new Error(`Expected a regular file: ${path}`);
  return readFileSync(full);
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function validate(name, content) {
  const markdown = content.toString("utf8").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(markdown);
  const names = match?.[1].match(/^name: ([a-z0-9-]+)$/gm);
  const descriptions = match?.[1].match(/^description: \S.*$/gm);
  if (names?.length !== 1 || names[0] !== `name: ${name}` || descriptions?.length !== 1 || !match[2].trim()) {
    throw new Error(`Invalid frontmatter or empty body: ${CATALOG}/${name}/SKILL.md`);
  }
}

function save(root, { path, content, previous }) {
  const current = read(root, path);
  if ((current && digest(current)) !== previous) throw new Error(`File changed during sync: ${path}`);
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  if (!current) {
    writeFileSync(full, content, { flag: "wx" });
    return;
  }
  const temp = `${full}.${randomUUID()}.tmp`;
  writeFileSync(temp, content, { flag: "wx" });
  try {
    renameSync(temp, full);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function syncSkills(root, mode) {
  if (!["check", "sync"].includes(mode)) throw new Error("Use 'check' or 'sync'.");
  const catalog = regularPath(root, CATALOG);
  if (!catalog) throw new Error("Missing skills catalog.");
  const names = readdirSync(catalog, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name).sort();
  if (!names.length) throw new Error("Empty skills catalog.");
  const lock = read(root, LOCK);
  const previous = lock ? JSON.parse(lock.toString("utf8")) : { version: 1, catalog: CATALOG, managed: {} };
  if (previous.version !== 1 || previous.catalog !== CATALOG || !previous.managed
    || Object.entries(previous.managed).some(([name, value]) => !validName.test(name) || !/^[a-f0-9]{64}$/.test(value))) {
    throw new Error("Invalid skill provenance lock.");
  }
  const managed = Object.fromEntries(names.map((name) => [name, ""]));
  const changes = [];
  for (const name of Object.keys(previous.managed)) {
    if (!Object.hasOwn(managed, name)) throw new Error(`Review obsolete managed skill before removing it: ${name}`);
  }
  for (const name of names) {
    if (!validName.test(name) || name.length > 64) throw new Error(`Invalid skill name: ${name}`);
    const source = read(root, `${CATALOG}/${name}/SKILL.md`);
    if (!source) throw new Error(`Missing SKILL.md for ${name}`);
    validate(name, source);
    const hash = digest(source);
    managed[name] = hash;
    for (const target of TARGETS) {
      const path = `${target}/${name}/SKILL.md`;
      const current = read(root, path);
      const currentHash = current && digest(current);
      if (current && currentHash !== previous.managed[name]) {
        throw new Error(`Conflict with a local skill: ${path}. Review the file and its provenance before syncing.`);
      }
      if (currentHash !== hash) changes.push({ path, content: source, previous: currentHash });
    }
  }
  const lockContent = Buffer.from(JSON.stringify({ version: 1, catalog: CATALOG, managed }, null, 2) + "\n");
  if (!lock?.equals(lockContent)) changes.push({ path: LOCK, content: lockContent, previous: lock && digest(lock) });
  if (mode === "check" && changes.length) {
    throw new Error(`Skills need sync: ${changes.map(({ path }) => path).join(", ")}`);
  }
  for (const change of changes) save(root, change);
  return { skills: names.length, updated: changes.length };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && relative(self, process.argv[1]) === "") {
  try {
    const root = resolve(dirname(self), "..");
    const { skills, updated } = syncSkills(root, process.argv[2]);
    console.log(`Skills: ${skills} catalog entries, ${updated} files updated.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
