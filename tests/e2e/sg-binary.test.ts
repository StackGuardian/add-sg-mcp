#!/usr/bin/env tsx
// Compiles the standalone executable (`bun run build:binary`) and runs it the
// way someone without Node would: no tsx, no node_modules, skills embedded.
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "add-sg-mcp-binary-"));
  tempDirs.push(dir);
  return dir;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// ADD_SG_MCP_BINARY points at a prebuilt executable (the release smoke test in
// .github/workflows/binaries.yml); otherwise one is compiled for this machine.
const prebuilt = process.env.ADD_SG_MCP_BINARY;
const binary = prebuilt
  ? resolve(prebuilt)
  : join(
      createTempDir(),
      process.platform === "win32" ? "add-sg-mcp.exe" : "add-sg-mcp",
    );
if (!prebuilt) {
  const build = spawnSync("bun", ["run", "build:binary", "--outfile", binary], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  if (build.status !== 0) {
    console.error(
      `bun run build:binary failed:\n${build.stdout}\n${build.stderr}`,
    );
    process.exit(1);
  }
}

function runBinary(args: string[], home: string) {
  const result = spawnSync(binary, args, {
    cwd: createTempDir(),
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      CODEX_HOME: join(home, ".codex"),
      NO_COLOR: "1",
      CI: "1",
      SG_API_KEY: "",
      SG_ORG: "",
      SG_API_BASE: "",
      SG_REGION: "",
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `binary failed (${result.status}).\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

test("the binary reports the package version", () => {
  const { version } = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf-8"),
  ) as { version: string };
  assert.strictEqual(runBinary(["--version"], createTempDir()).trim(), version);
});

test("the binary installs the server and the embedded skills", () => {
  const home = createTempDir();
  runBinary(
    [
      "--token",
      "sgu_testtesttest1234",
      "--org",
      "demo-org",
      "--region",
      "eu",
      "-y",
      "-a",
      "claude-code",
    ],
    home,
  );
  const claude = JSON.parse(
    readFileSync(join(home, ".claude.json"), "utf-8"),
  ) as { mcpServers: Record<string, { url: string }> };
  assert.strictEqual(
    claude.mcpServers["StackGuardian-demo-org"]?.url,
    "https://api.app.stackguardian.io/api/v1/orgs/demo-org/mcp/",
  );
  for (const skill of [
    "sg-create-workflow",
    "sg-update-workflow",
    "sg-upgrade-workflow",
  ]) {
    assert.strictEqual(
      readFileSync(join(home, ".claude", "skills", skill, "SKILL.md"), "utf-8"),
      readFileSync(join(repoRoot, "skills", skill, "SKILL.md"), "utf-8"),
      `${skill} matches the source`,
    );
  }
});

for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
