import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { syncSkills } from "./sync-skills.mjs";

const name = "test-skill";
const source = `skills/catalog/${name}/SKILL.md`;
const codex = `.agents/skills/${name}/SKILL.md`;
const claude = `.claude/skills/${name}/SKILL.md`;
const skill = (body) => `---\nname: ${name}\ndescription: A skill fixture.\n---\n\n${body}\n`;

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "studio-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    write(path, content) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    },
    read: (path) => readFileSync(join(root, path), "utf8"),
  };
}

test("sync creates the mirrors, safely updates them and is idempotent", (t) => {
  const ws = workspace(t);
  ws.write(source, skill("First"));
  assert.throws(() => syncSkills(ws.root, "check"), /need sync/);
  assert.deepEqual(syncSkills(ws.root, "sync"), { skills: 1, updated: 3 });
  assert.equal(ws.read(codex), ws.read(source));
  ws.write(source, skill("Second"));
  assert.equal(syncSkills(ws.root, "sync").updated, 3);
  assert.equal(ws.read(claude), ws.read(source));
  assert.equal(syncSkills(ws.root, "check").updated, 0);
});

test("sync reports a conflict before modifying any mirror", (t) => {
  const ws = workspace(t);
  ws.write(source, skill("First"));
  syncSkills(ws.root, "sync");
  ws.write(source, skill("Second"));
  ws.write(claude, skill("Local changes"));
  assert.throws(() => syncSkills(ws.root, "sync"), /Conflict/);
  assert.equal(ws.read(codex), skill("First"));
  assert.equal(ws.read(claude), skill("Local changes"));
});

test("sync preserves unmanaged targets even when their content matches", (t) => {
  const ws = workspace(t);
  ws.write(source, skill("First"));
  ws.write(codex, skill("First"));
  assert.throws(() => syncSkills(ws.root, "sync"), /Conflict/);
  assert.equal(ws.read(codex), skill("First"));
});
