#!/usr/bin/env tsx
import assert from "node:assert";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
  SG_SKILL_NAMES,
  bundledSkillsDir,
  extractEmbeddedSkills,
  canonicalSkillsDir,
  agentSkillsDir,
  installSkills,
  removeSkills,
  skillsStatus,
} from "../src/sg/skills.js";

let passed = 0;
let failed = 0;
const tempDirs: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
    failed++;
  }
}

function sandbox(): { home: string; cwd: string } {
  const home = mkdtempSync(join(tmpdir(), "add-sg-mcp-skills-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "add-sg-mcp-skills-cwd-"));
  tempDirs.push(home, cwd);
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  delete process.env.CODEX_HOME;
  return { home, cwd };
}

test("bundled skills exist and their frontmatter names match the directory", () => {
  const dir = bundledSkillsDir();
  assert.deepStrictEqual(
    [...SG_SKILL_NAMES],
    ["sg-create-workflow", "sg-update-workflow", "sg-upgrade-workflow"],
  );
  for (const name of SG_SKILL_NAMES) {
    const skill = readFileSync(join(dir, name, "SKILL.md"), "utf-8");
    assert.match(
      skill,
      new RegExp(`^---\\nname: ${name}\\n`),
      `${name} frontmatter`,
    );
    assert.ok(
      !/\b(?<!sg-)(create|update|upgrade)-workflow\b/.test(skill),
      `${name} still references an unprefixed skill`,
    );
  }
});

test("canonical and agent directories follow the spec table", () => {
  const { home, cwd } = sandbox();
  assert.strictEqual(
    canonicalSkillsDir("global", cwd, home),
    join(home, ".agents", "skills"),
  );
  assert.strictEqual(
    canonicalSkillsDir("local", cwd, home),
    join(cwd, ".agents", "skills"),
  );
  assert.strictEqual(
    agentSkillsDir("claude-code", "global", cwd, home),
    join(home, ".claude", "skills"),
  );
  assert.strictEqual(
    agentSkillsDir("claude-code", "local", cwd, home),
    join(cwd, ".claude", "skills"),
  );
  assert.strictEqual(
    agentSkillsDir("codex", "global", cwd, home),
    join(home, ".codex", "skills"),
  );
  assert.strictEqual(
    agentSkillsDir("codex", "local", cwd, home),
    join(cwd, ".agents", "skills"),
  );
  assert.strictEqual(
    agentSkillsDir("cline", "global", cwd, home),
    join(home, ".agents", "skills"),
  );
  assert.strictEqual(
    agentSkillsDir("windsurf", "global", cwd, home),
    join(home, ".codeium", "windsurf", "skills"),
  );
  assert.strictEqual(
    agentSkillsDir("mastracode", "global", cwd, home),
    undefined,
  );
  process.env.CODEX_HOME = join(home, "codex-home");
  assert.strictEqual(
    agentSkillsDir("codex", "global", cwd, home),
    join(home, "codex-home", "skills"),
  );
  delete process.env.CODEX_HOME;
});

test("global install copies canonically and symlinks relatively into agent dirs", () => {
  const { home, cwd } = sandbox();
  const results = installSkills(
    ["claude-code", "codex", "cline", "mastracode"],
    "global",
    cwd,
    { home },
  );
  const canonical = join(
    home,
    ".agents",
    "skills",
    "sg-create-workflow",
    "SKILL.md",
  );
  assert.ok(existsSync(canonical), "canonical copy exists");
  const link = join(home, ".claude", "skills", "sg-create-workflow");
  assert.ok(lstatSync(link).isSymbolicLink(), "claude link is a symlink");
  assert.ok(!isAbsolute(readlinkSync(link)), "symlink is relative");
  assert.ok(existsSync(join(link, "SKILL.md")), "symlink resolves");
  assert.ok(
    lstatSync(
      join(home, ".codex", "skills", "sg-update-workflow"),
    ).isSymbolicLink(),
  );
  const cline = results.filter((r) => r.agent === "cline");
  assert.ok(
    cline.every((r) => r.mode === "canonical-only"),
    "cline uses the canonical dir directly",
  );
  const mastra = results.filter((r) => r.agent === "mastracode");
  assert.ok(
    mastra.every((r) => r.mode === "skipped"),
    "agents without skills are skipped",
  );
  assert.ok(
    results.every((r) => !r.error),
    JSON.stringify(results.filter((r) => r.error)),
  );
  const manifest = JSON.parse(
    readFileSync(join(home, ".config", "add-sg-mcp", "skills.json"), "utf-8"),
  ) as { entries: unknown[] };
  assert.ok(manifest.entries.length >= 6);
});

test("re-running is idempotent and repairs a broken link", () => {
  const { home, cwd } = sandbox();
  installSkills(["claude-code"], "global", cwd, { home });
  const link = join(home, ".claude", "skills", "sg-upgrade-workflow");
  unlinkSync(link);
  writeFileSync(link, "not a link");
  const results = installSkills(["claude-code"], "global", cwd, { home });
  const r = results.find((x) => x.skill === "sg-upgrade-workflow");
  assert.ok(r && r.error, "a foreign file in the way is reported, not deleted");
  assert.strictEqual(readFileSync(link, "utf-8"), "not a link");
  unlinkSync(link);
  const again = installSkills(["claude-code"], "global", cwd, { home });
  assert.ok(again.every((x) => !x.error));
  assert.ok(lstatSync(link).isSymbolicLink());
});

test("project scope writes under the cwd and falls back to copying when symlinks fail", () => {
  const { home, cwd } = sandbox();
  const results = installSkills(["claude-code", "gemini-cli"], "local", cwd, {
    home,
    symlink: () => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    },
  });
  assert.ok(
    existsSync(
      join(cwd, ".agents", "skills", "sg-create-workflow", "SKILL.md"),
    ),
  );
  const claude = join(cwd, ".claude", "skills", "sg-create-workflow");
  assert.ok(
    lstatSync(claude).isDirectory() && !lstatSync(claude).isSymbolicLink(),
  );
  assert.ok(
    results
      .filter((r) => r.agent === "claude-code")
      .every((r) => r.mode === "copy"),
  );
  assert.ok(
    results
      .filter((r) => r.agent === "gemini-cli")
      .every((r) => r.mode === "canonical-only"),
  );
});

test("skillsStatus reports per-agent presence and removeSkills only touches our entries", () => {
  const { home, cwd } = sandbox();
  installSkills(["claude-code", "codex"], "global", cwd, { home });
  const foreign = join(home, ".claude", "skills", "my-own-skill");
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, "SKILL.md"), "---\nname: my-own-skill\n---\n");
  const status = skillsStatus(
    ["claude-code", "codex", "cursor"],
    "global",
    cwd,
    { home },
  );
  assert.deepStrictEqual(status.get("claude-code"), [...SG_SKILL_NAMES]);
  assert.deepStrictEqual(status.get("cursor"), []);
  const removed = removeSkills(["claude-code"], "global", cwd, { home });
  assert.strictEqual(removed.errors.length, 0);
  assert.ok(!existsSync(join(home, ".claude", "skills", "sg-create-workflow")));
  assert.ok(existsSync(join(foreign, "SKILL.md")), "foreign skill untouched");
  assert.ok(
    existsSync(join(home, ".agents", "skills", "sg-create-workflow")),
    "canonical kept while codex still uses it",
  );
  removeSkills(["codex"], "global", cwd, { home });
  assert.ok(
    !existsSync(join(home, ".agents", "skills", "sg-create-workflow")),
    "canonical removed with the last user",
  );
  assert.ok(!existsSync(join(home, ".codex", "skills", "sg-create-workflow")));
});

for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
test("embedded skills are extracted to a private directory mirroring skills/", () => {
  const root = mkdtempSync(join(tmpdir(), "add-sg-mcp-embedded-root-"));
  tempDirs.push(root);
  mkdirSync(join(root, "skills", "sg-create-workflow", "references"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "skills", "sg-create-workflow", "SKILL.md"),
    "# create ✓\n",
  );
  writeFileSync(
    join(root, "skills", "sg-create-workflow", "references", "inputs.md"),
    "inputs\n",
  );
  writeFileSync(join(root, "index.js"), "bundle");

  const dir = extractEmbeddedSkills(root, [
    "index.js",
    "skills/sg-create-workflow/SKILL.md",
    "skills/sg-create-workflow/references/inputs.md",
  ]);
  assert.ok(dir, "a directory is returned");
  tempDirs.push(dir);
  assert.notStrictEqual(dir, join(root, "skills"));
  assert.strictEqual(
    readFileSync(join(dir, "sg-create-workflow", "SKILL.md"), "utf-8"),
    "# create ✓\n",
  );
  assert.strictEqual(
    readFileSync(
      join(dir, "sg-create-workflow", "references", "inputs.md"),
      "utf-8",
    ),
    "inputs\n",
  );
  assert.ok(!existsSync(join(dir, "index.js")), "non-skill files are ignored");
  if (process.platform !== "win32") {
    assert.strictEqual(lstatSync(dir).mode & 0o777, 0o700);
  }
});

test("without embedded skills nothing is extracted", () => {
  assert.strictEqual(extractEmbeddedSkills(tmpdir(), []), undefined);
  assert.strictEqual(extractEmbeddedSkills(tmpdir(), ["index.js"]), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
