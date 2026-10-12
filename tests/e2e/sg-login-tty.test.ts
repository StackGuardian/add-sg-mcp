#!/usr/bin/env tsx
// Runs `login` inside a real terminal (a pty opened by python3) and answers
// its prompts, the way a person does after signing in.
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  const dir = mkdtempSync(join(tmpdir(), "add-sg-mcp-tty-"));
  tempDirs.push(dir);
  return dir;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const indexPath = join(repoRoot, "src", "index.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const TIMEOUT_MS = 60_000;

interface Answer {
  /** The prompt to wait for. */
  prompt: RegExp;
  /** The keys to press once it shows. */
  keys: string;
}

interface TtyResult {
  status: number | null;
  output: string;
}

// Runs argv on a pty, relaying this process's stdin and stdout, and exits with its status.
const PTY_RELAY =
  "import os, pty, sys; sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))";
// A new pty is zero columns wide, which wraps the prompts one character per line.
const SIZED_EXEC = 'stty rows 40 cols 200 && exec "$@"';

function runCliInTty(
  args: string[],
  cwd: string,
  homeDir: string,
  answers: Answer[],
): Promise<TtyResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: join(homeDir, ".config"),
    CODEX_HOME: join(homeDir, ".codex"),
    NO_COLOR: "1",
    SG_API_KEY: "",
    SG_ORG: "",
    SG_API_BASE: "",
    SG_REGION: "",
  };
  // CI switches the prompts off.
  delete env.CI;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "python3",
      [
        "-c",
        PTY_RELAY,
        "sh",
        "-c",
        SIZED_EXEC,
        "sh",
        tsxBin,
        indexPath,
        ...args,
      ],
      { cwd, env },
    );
    const pending = [...answers];
    let output = "";
    let unanswered = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out. Output so far:\n${output}`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = stripVTControlCharacters(chunk.toString("utf-8"));
      output += text;
      unanswered += text;
      const next = pending[0];
      if (next && next.prompt.test(unanswered)) {
        pending.shift();
        unanswered = "";
        child.stdin.write(next.keys);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolvePromise({ status, output });
    });
  });
}

const KEY = "sgu_testtesttest1234";
const TOKEN_ARGS = ["--token", KEY, "--org", "demo-org", "--region", "eu"];
const URL = "https://api.app.stackguardian.io/api/v1/orgs/demo-org/mcp/";
const NAME = "StackGuardian-demo-org";
const ENTER = "\r";

if (process.platform === "win32") {
  console.log("– skipped: python3 has no pty module on Windows");
  process.exit(0);
}

await test("login in a terminal goes on to pick agents and install", async () => {
  const home = createTempDir();
  const project = createTempDir();
  // Claude Code counts as installed, so the picker starts with it selected.
  mkdirSync(join(home, ".claude"));

  const result = await runCliInTty(["login", ...TOKEN_ARGS], project, home, [
    {
      prompt: /Which coding agents should get the StackGuardian server\?/,
      keys: ENTER,
    },
    { prompt: /Proceed with installation\?/, keys: ENTER },
  ]);

  assert.strictEqual(result.status, 0, result.output);
  assert.match(result.output, /Saved credentials for demo-org/);
  assert.match(result.output, /Skills \(user scope\)/);
  assert.match(result.output, /Next steps/);
  assert.doesNotMatch(result.output, /to install the server and skills/);

  const claude = JSON.parse(
    readFileSync(join(home, ".claude.json"), "utf-8"),
  ) as { mcpServers: Record<string, { url: string }> };
  assert.strictEqual(claude.mcpServers[NAME]?.url, URL);
});

for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
