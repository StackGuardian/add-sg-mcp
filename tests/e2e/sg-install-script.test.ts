#!/usr/bin/env tsx
// Runs install.sh (install.ps1 on Windows) against release files served over
// file://, the way `curl … | sh` runs it against dl.stackguardian.io.
import assert from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

let passed = 0;
let failed = 0;
const tempDirs: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
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
const installScript = join(repoRoot, windows ? "install.ps1" : "install.sh");
const downloads = "https://dl.stackguardian.io/add-sg-mcp";
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

/** A directory laid out like one release: the archive plus SHA256SUMS. */
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

/**
 * A directory laid out like dl.stackguardian.io/add-sg-mcp: the release under
 * `v<version>/` and a `latest` file with the given content.
 */
function buildDownloads(latest: string): string {
  const root = createTempDir();
  const versionDir = join(root, `v${version}`);
  mkdirSync(versionDir);
  for (const file of [archive, "SHA256SUMS"]) {
    cpSync(join(release, file), join(versionDir, file));
  }
  writeFileSync(join(root, "latest"), latest);
  return root;
}

/** A copy of the install script that downloads from `root`, not dl.stackguardian.io. */
function installScriptFor(root: string): string {
  const source = readFileSync(installScript, "utf-8");
  assert.ok(source.includes(downloads), `${installScript} uses ${downloads}`);
  const copy = join(createTempDir(), basename(installScript));
  writeFileSync(copy, source.replaceAll(downloads, pathToFileURL(root).href));
  return copy;
}

function installerEnv(from: string, installDir: string) {
  return {
    ...process.env,
    ADD_SG_MCP_DOWNLOAD_URL: pathToFileURL(from).href,
    ADD_SG_MCP_INSTALL_DIR: installDir,
    ADD_SG_MCP_VERSION: "",
    ADD_SG_MCP_NO_RUN: "",
  };
}

function runInstaller(
  from: string,
  installDir: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    piped?: boolean;
    script?: string;
  } = {},
) {
  const spawnOptions = {
    cwd: createTempDir(),
    encoding: "utf-8" as const,
    env: { ...installerEnv(from, installDir), ...options.env },
  };
  if (windows) {
    return spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        options.script ?? installScript,
        ...args,
      ],
      spawnOptions,
    );
  }
  const script = options.script ?? installScript;
  return options.piped
    ? spawnSync("sh", ["-s", "--", ...args], {
        ...spawnOptions,
        input: readFileSync(script, "utf-8"),
      })
    : spawnSync("sh", [script, ...args], spawnOptions);
}

/**
 * Runs `sh -s < install.sh` in a pseudo-terminal from script(1), the way
 * `curl … | sh` runs in a terminal: stdin is the script, the terminal is not.
 */
function runInstallerInTerminal(
  from: string,
  installDir: string,
  env: Record<string, string> = {},
) {
  // A new pty is 0 columns wide, which wraps every prompt character.
  const command = `stty cols 100 rows 30; sh -s < '${installScript}'`;
  // macOS script(1) rejects a socket as stdin, so `cat` hands it a pipe.
  const script =
    process.platform === "darwin"
      ? 'cat | script -q /dev/null sh -c "$1"'
      : 'cat | script -q -e -c "$1" /dev/null';
  // Detached, so the whole process group can be killed afterwards. CI is
  // cleared because add-sg-mcp skips its prompts when it is set, and this
  // test is about the prompts.
  return spawn("sh", ["-c", script, "sh", command], {
    cwd: createTempDir(),
    env: { ...installerEnv(from, installDir), CI: "", ...env },
    detached: true,
  });
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
  return true;
}

function describe(result: ReturnType<typeof spawnSync>): string {
  return `exit ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
}

await test("installs the binary for this machine and runs it with the given flags", () => {
  const installDir = join(createTempDir(), "bin");
  const result = runInstaller(release, installDir, ["--version"]);
  assert.strictEqual(result.status, 0, describe(result));
  assert.match(String(result.stdout), new RegExp(`^${version}$`, "m"));
  assert.ok(existsSync(join(installDir, exe)), "the binary is installed");
});

if (!windows) {
  await test("piped into sh (curl | sh -s -- …) it passes the flags through", () => {
    const installDir = join(createTempDir(), "bin");
    const result = runInstaller(release, installDir, ["--version"], {
      piped: true,
    });
    assert.strictEqual(result.status, 0, describe(result));
    assert.match(String(result.stdout), new RegExp(`^${version}$`, "m"));
  });

  await test("piped into sh in a terminal, the prompts read the keyboard", async () => {
    const child = runInstallerInTerminal(release, join(createTempDir(), "bin"));
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const screen = () => stripVTControlCharacters(output);
    try {
      // A key typed while the download runs is waiting when the prompt starts.
      child.stdin.write("a");
      assert.ok(
        await waitFor(() => screen().includes("Where is your"), 30_000),
        `no region prompt:\n${screen()}`,
      );
      child.stdin.write("\x1b");
      assert.ok(
        await waitFor(() => screen().includes("Cancelled"), 10_000),
        `Esc did not cancel the prompt:\n${screen()}`,
      );
    } finally {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // ESRCH: everything already exited.
      }
    }
  });
}

if (!windows && spawnSync("curl", ["--version"]).status === 0) {
  await test("the download shows progress in a terminal and stays quiet when piped", async () => {
    const child = runInstallerInTerminal(
      release,
      join(createTempDir(), "bin"),
      {
        ADD_SG_MCP_NO_RUN: "1",
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const screen = () => stripVTControlCharacters(output);
    try {
      assert.ok(
        await waitFor(() => screen().includes("installed"), 30_000),
        `the install did not finish:\n${screen()}`,
      );
      assert.match(screen(), /100\.0%/, "curl draws its progress bar");
    } finally {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // ESRCH: everything already exited.
      }
    }

    const piped = runInstaller(release, join(createTempDir(), "bin"), [], {
      env: { ADD_SG_MCP_NO_RUN: "1" },
    });
    assert.strictEqual(piped.status, 0, describe(piped));
    assert.doesNotMatch(String(piped.stderr), /%/);
  });
}

await test("with no version set, it installs the release that `latest` names", () => {
  const root = buildDownloads(`v${version}\n`);
  const installDir = join(createTempDir(), "bin");
  const result = runInstaller(root, installDir, ["--version"], {
    script: installScriptFor(root),
    env: { ADD_SG_MCP_DOWNLOAD_URL: "" },
  });
  assert.strictEqual(result.status, 0, describe(result));
  assert.match(String(result.stdout), new RegExp(`^${version}$`, "m"));
});

await test("ADD_SG_MCP_VERSION installs that release without reading `latest`", () => {
  const root = buildDownloads("v0.0.0\n");
  for (const pinned of [version, `v${version}`]) {
    const result = runInstaller(
      root,
      join(createTempDir(), "bin"),
      ["--version"],
      {
        script: installScriptFor(root),
        env: { ADD_SG_MCP_DOWNLOAD_URL: "", ADD_SG_MCP_VERSION: pinned },
      },
    );
    assert.strictEqual(result.status, 0, describe(result));
    assert.match(String(result.stdout), new RegExp(`^${version}$`, "m"));
  }
});

await test("a `latest` that does not name a version aborts before anything is installed", () => {
  const root = buildDownloads("<html>Not found</html>\n");
  const installDir = join(createTempDir(), "bin");
  const result = runInstaller(root, installDir, ["--version"], {
    script: installScriptFor(root),
    env: { ADD_SG_MCP_DOWNLOAD_URL: "" },
  });
  assert.notStrictEqual(result.status, 0, describe(result));
  assert.match(`${result.stdout}${result.stderr}`, /latest version/);
  assert.ok(!existsSync(join(installDir, exe)), "nothing is installed");
});

await test("ADD_SG_MCP_NO_RUN=1 installs without running add-sg-mcp", () => {
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

await test("a checksum mismatch aborts before anything is installed", () => {
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
