#!/usr/bin/env tsx
// Runs install.sh (install.ps1 on Windows) against release files served over
// file://, the way `curl … | sh` runs it against a GitHub release.
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const dir = mkdtempSync(join(tmpdir(), "add-sg-mcp-install-"));
  tempDirs.push(dir);
  return dir;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const windows = process.platform === "win32";
const target = `${windows ? "windows" : process.platform}-${process.arch}`;
const archive = `add-sg-mcp-${target}.${windows ? "zip" : "tar.gz"}`;
const exe = windows ? "add-sg-mcp.exe" : "add-sg-mcp";
const { version } = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf-8"),
) as { version: string };

function mustRun(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** A directory laid out like a GitHub release: the archive plus SHA256SUMS. */
function buildRelease(): string {
  const release = createTempDir();
  const stage = createTempDir();
  mustRun("bun", ["run", "build:binary", "--outfile", join(stage, exe)]);
  // bsdtar (macOS, Windows) picks zip from the .zip suffix with -a.
  mustRun(
    "tar",
    windows
      ? ["-a", "-cf", join(release, archive), "-C", stage, exe]
      : ["-czf", join(release, archive), "-C", stage, exe],
  );
  const hash = createHash("sha256")
    .update(readFileSync(join(release, archive)))
    .digest("hex");
  writeFileSync(join(release, "SHA256SUMS"), `${hash}  ${archive}\n`);
  return release;
}

// ADD_SG_MCP_RELEASE_DIR holds real release files (the smoke test in
// .github/workflows/binaries.yml); otherwise one is built for this machine.
const release = process.env.ADD_SG_MCP_RELEASE_DIR
  ? resolve(process.env.ADD_SG_MCP_RELEASE_DIR)
  : buildRelease();

function runInstaller(
  from: string,
  installDir: string,
  args: string[],
  options: { env?: Record<string, string>; piped?: boolean } = {},
) {
  const spawnOptions = {
    cwd: createTempDir(),
    encoding: "utf-8" as const,
    env: {
      ...process.env,
      ADD_SG_MCP_DOWNLOAD_URL: pathToFileURL(from).href,
      ADD_SG_MCP_INSTALL_DIR: installDir,
      ADD_SG_MCP_VERSION: "",
      ADD_SG_MCP_NO_RUN: "",
      ...options.env,
    },
  };
  if (windows) {
    return spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(repoRoot, "install.ps1"),
        ...args,
      ],
      spawnOptions,
    );
  }
  const script = join(repoRoot, "install.sh");
  return options.piped
    ? spawnSync("sh", ["-s", "--", ...args], {
        ...spawnOptions,
        input: readFileSync(script, "utf-8"),
      })
    : spawnSync("sh", [script, ...args], spawnOptions);
}

function describe(result: ReturnType<typeof spawnSync>): string {
  return `exit ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
}

test("installs the binary for this machine and runs it with the given flags", () => {
  const installDir = join(createTempDir(), "bin");
  const result = runInstaller(release, installDir, ["--version"]);
  assert.strictEqual(result.status, 0, describe(result));
  assert.match(String(result.stdout), new RegExp(`^${version}$`, "m"));
  assert.ok(existsSync(join(installDir, exe)), "the binary is installed");
});

if (!windows) {
  test("piped into sh (curl | sh -s -- …) it passes the flags through", () => {
    const installDir = join(createTempDir(), "bin");
    const result = runInstaller(release, installDir, ["--version"], {
      piped: true,
    });
    assert.strictEqual(result.status, 0, describe(result));
    assert.match(String(result.stdout), new RegExp(`^${version}$`, "m"));
  });
}

test("ADD_SG_MCP_NO_RUN=1 installs without running add-sg-mcp", () => {
  const installDir = join(createTempDir(), "bin");
  const run = runInstaller(release, installDir, ["--not-a-real-flag"]);
  assert.notStrictEqual(run.status, 0, "an unknown flag fails when it runs");

  const installOnly = runInstaller(
    release,
    join(createTempDir(), "bin"),
    ["--not-a-real-flag"],
    { env: { ADD_SG_MCP_NO_RUN: "1" } },
  );
  assert.strictEqual(installOnly.status, 0, describe(installOnly));
});

test("a checksum mismatch aborts before anything is installed", () => {
  const tampered = createTempDir();
  cpSync(release, tampered, { recursive: true });
  writeFileSync(
    join(tampered, "SHA256SUMS"),
    `${"0".repeat(64)}  ${archive}\n`,
  );
  const installDir = join(createTempDir(), "bin");
  const result = runInstaller(tampered, installDir, ["--version"]);
  assert.notStrictEqual(result.status, 0, describe(result));
  assert.match(`${result.stdout}${result.stderr}`, /checksum mismatch/);
  assert.ok(!existsSync(join(installDir, exe)), "nothing is installed");
});

for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
