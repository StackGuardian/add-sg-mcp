#!/usr/bin/env tsx
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
let tempDirs: string[] = [];

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
  const dir = mkdtempSync(join(tmpdir(), "add-sg-mcp-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tempDirs = [];
}

const testFileDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testFileDir, "..", "..");
const indexPath = join(repoRoot, "src", "index.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

function runCli(args: string[], cwd: string, homeDir: string) {
  return spawnSync(tsxBin, [indexPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: join(homeDir, ".config"),
      CODEX_HOME: join(homeDir, ".codex"),
      NO_COLOR: "1",
      CI: "1",
      SG_API_KEY: "",
      SG_ORG: "",
      SG_API_BASE: "",
      SG_REGION: "",
    },
  });
}

function expectOk(result: ReturnType<typeof runCli>) {
  if (result.status !== 0) {
    throw new Error(
      `CLI failed (${result.status}).\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

const KEY = "sgu_testtesttest1234";
const TOKEN_ARGS = ["--token", KEY, "--org", "demo-org", "--region", "eu"];
const URL = "https://api.app.stackguardian.io/api/v1/orgs/demo-org/mcp/";
const NAME = "StackGuardian-demo-org";

test("connect with --token -y --all writes every supported agent and the skills", () => {
  const home = createTempDir();
  const project = createTempDir();
  const output = expectOk(
    runCli([...TOKEN_ARGS, "-y", "--all"], project, home),
  );
  assert.match(output, /Installed to 20 agents/);
  assert.ok(!output.includes("fx:"), "fx must not be installed");
  assert.ok(
    !output.includes("Claude Desktop"),
    "Claude Desktop must not be installed",
  );
  assert.match(output, /Skills \(user scope\)/);

  const claude = JSON.parse(
    readFileSync(join(home, ".claude.json"), "utf-8"),
  ) as {
    mcpServers: Record<
      string,
      { type: string; url: string; headers: Record<string, string> }
    >;
  };
  assert.deepStrictEqual(claude.mcpServers[NAME], {
    type: "http",
    url: URL,
    headers: { Authorization: `apikey ${KEY}` },
  });

  const codex = readFileSync(join(home, ".codex", "config.toml"), "utf-8");
  assert.match(codex, /\[mcp_servers\.("?)StackGuardian-demo-org\1\]/);
  assert.match(
    codex,
    /\[mcp_servers\.("?)StackGuardian-demo-org\1\.http_headers\]/,
  );
  assert.match(codex, new RegExp(`Authorization = "apikey ${KEY}"`));

  for (const file of [
    join(home, ".cursor", "mcp.json"),
    join(home, ".gemini", "settings.json"),
    join(home, ".kiro", "settings", "mcp.json"),
    join(home, ".codeium", "windsurf", "mcp_config.json"),
    join(home, ".config", "opencode", "opencode.jsonc"),
    join(home, ".config", "goose", "config.yaml"),
  ]) {
    assert.ok(existsSync(file), `${file} should exist`);
    assert.ok(
      readFileSync(file, "utf-8").includes(URL),
      `${file} should hold the MCP URL`,
    );
  }

  const creds = join(home, ".config", "add-sg-mcp", "credentials.json");
  assert.ok(existsSync(creds));
  if (process.platform !== "win32") {
    assert.strictEqual(statSync(creds).mode & 0o777, 0o600);
  }
  assert.ok(!output.includes(KEY), "the key must not be echoed unmasked");

  const link = join(home, ".claude", "skills", "sg-create-workflow");
  assert.ok(lstatSync(link).isSymbolicLink(), "Claude Code skill is a symlink");
  assert.ok(existsSync(join(link, "SKILL.md")));
  assert.ok(
    existsSync(
      join(home, ".codex", "skills", "sg-update-workflow", "SKILL.md"),
    ),
  );
  assert.ok(
    existsSync(
      join(home, ".agents", "skills", "sg-upgrade-workflow", "SKILL.md"),
    ),
  );
  assert.strictEqual(
    existsSync(join(project, ".mcp.json")),
    false,
    "nothing in the project by default",
  );
});

test("status reports the masked credential and installed agents; remove and logout undo it", () => {
  const home = createTempDir();
  const project = createTempDir();
  expectOk(
    runCli(
      [...TOKEN_ARGS, "-y", "-a", "claude-code", "-a", "codex"],
      project,
      home,
    ),
  );

  const status = expectOk(runCli(["status"], project, home));
  assert.match(status, /Organization: demo-org/);
  assert.match(status, /sgu_…1234/);
  assert.ok(!status.includes(KEY));
  assert.match(status, /Claude Code \(user\): StackGuardian-demo-org/);
  assert.match(status, /Codex \(user\): StackGuardian-demo-org/);
  assert.match(status, /3 skills/);

  const removed = expectOk(runCli(["remove", "-y"], project, home));
  assert.match(removed, /Claude Code: removed/);
  const claude = JSON.parse(
    readFileSync(join(home, ".claude.json"), "utf-8"),
  ) as {
    mcpServers?: Record<string, unknown>;
  };
  assert.strictEqual(claude.mcpServers?.[NAME], undefined);
  assert.ok(
    !readFileSync(join(home, ".codex", "config.toml"), "utf-8").includes(
      "StackGuardian-demo-org",
    ),
  );
  assert.strictEqual(
    existsSync(join(home, ".claude", "skills", "sg-create-workflow")),
    false,
  );
  assert.strictEqual(
    existsSync(join(home, ".agents", "skills", "sg-create-workflow")),
    false,
  );

  const logout = expectOk(runCli(["logout"], project, home));
  assert.match(logout, /Removed .*credentials\.json/);
  assert.strictEqual(
    existsSync(join(home, ".config", "add-sg-mcp", "credentials.json")),
    false,
  );

  const again = expectOk(runCli(["status"], project, home));
  assert.match(again, /Not signed in/);
});

test("remove --name drops one organization's entry and keeps the skills", () => {
  const home = createTempDir();
  const project = createTempDir();
  expectOk(runCli([...TOKEN_ARGS, "-y", "-a", "claude-code"], project, home));
  expectOk(
    runCli(
      [
        "--token",
        KEY,
        "--org",
        "other-org",
        "--region",
        "eu",
        "-y",
        "-a",
        "claude-code",
      ],
      project,
      home,
    ),
  );

  const removed = expectOk(
    runCli(
      ["remove", "--name", NAME, "-y", "-a", "claude-code"],
      project,
      home,
    ),
  );
  assert.match(removed, /Claude Code: removed StackGuardian-demo-org/);
  assert.doesNotMatch(removed, /skills: removed/);
  const claude = JSON.parse(
    readFileSync(join(home, ".claude.json"), "utf-8"),
  ) as { mcpServers?: Record<string, unknown> };
  assert.strictEqual(claude.mcpServers?.[NAME], undefined);
  assert.ok(claude.mcpServers?.["StackGuardian-other-org"]);
  for (const dir of [
    join(home, ".claude", "skills", "sg-create-workflow", "SKILL.md"),
    join(home, ".agents", "skills", "sg-create-workflow", "SKILL.md"),
  ]) {
    assert.ok(existsSync(dir), `${dir} is kept`);
  }
});

test("saved credentials are reused, and --project writes into the cwd with a .gitignore", () => {
  const home = createTempDir();
  const project = createTempDir();
  expectOk(runCli(["login", ...TOKEN_ARGS], project, home));

  const output = expectOk(
    runCli(
      ["--project", "-a", "claude-code", "-a", "cursor", "-y"],
      project,
      home,
    ),
  );
  assert.match(output, /Using saved credentials for demo-org/);
  assert.match(output, /Project scope writes the credential/);

  const mcp = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf-8")) as {
    mcpServers: Record<string, { url: string }>;
  };
  assert.strictEqual(mcp.mcpServers[NAME]?.url, URL);
  assert.ok(existsSync(join(project, ".cursor", "mcp.json")));
  const gitignore = readFileSync(join(project, ".gitignore"), "utf-8");
  assert.match(gitignore, /\.mcp\.json/);
  assert.match(gitignore, /\.cursor\/mcp\.json/);
  assert.ok(
    existsSync(
      join(project, ".agents", "skills", "sg-create-workflow", "SKILL.md"),
    ),
  );
  assert.ok(
    lstatSync(
      join(project, ".claude", "skills", "sg-create-workflow"),
    ).isSymbolicLink(),
  );
  assert.strictEqual(
    existsSync(join(home, ".claude.json")),
    false,
    "user scope untouched",
  );

  const purge = expectOk(
    runCli(["logout", "--purge", "--project"], project, home),
  );
  assert.match(purge, /Claude Code: removed/);
  assert.strictEqual(
    existsSync(join(project, ".claude", "skills", "sg-create-workflow")),
    false,
  );
});

test("--org overriding saved credentials triggers a fresh sign-in requirement", () => {
  const home = createTempDir();
  const project = createTempDir();
  expectOk(runCli(["login", ...TOKEN_ARGS], project, home));
  const result = runCli(
    ["--org", "other-org", "-y", "-a", "claude-code"],
    project,
    home,
  );
  assert.notStrictEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /--region|terminal|browser/);
});

test("preset-excluded agents and bad inputs fail clearly", () => {
  const home = createTempDir();
  const project = createTempDir();

  const fx = runCli([...TOKEN_ARGS, "-y", "-a", "fx"], project, home);
  assert.notStrictEqual(fx.status, 0);
  assert.match(`${fx.stdout}\n${fx.stderr}`, /Skipping fx/);
  assert.match(`${fx.stdout}\n${fx.stderr}`, /No supported agents selected/);

  const badBase = runCli(
    [
      "--token",
      KEY,
      "--org",
      "demo-org",
      "--api-base",
      "http://api.app.stackguardian.io",
      "-y",
      "--all",
    ],
    project,
    home,
  );
  assert.notStrictEqual(badBase.status, 0);
  assert.match(
    `${badBase.stdout}\n${badBase.stderr}`,
    /--api-base must be an https StackGuardian host/,
  );

  const badOrg = runCli(
    ["--token", KEY, "--org", "bad org", "--region", "eu", "-y", "--all"],
    project,
    home,
  );
  assert.notStrictEqual(badOrg.status, 0);
  assert.match(
    `${badOrg.stdout}\n${badOrg.stderr}`,
    /Invalid organization name/,
  );

  const noOrg = runCli(
    ["--token", KEY, "--region", "eu", "-y", "--all"],
    project,
    home,
  );
  assert.notStrictEqual(noOrg.status, 0);
  assert.match(
    `${noOrg.stdout}\n${noOrg.stderr}`,
    /--org is required with --token/,
  );

  // A fresh home: the --token runs above already saved a credential.
  const freshHome = createTempDir();
  const noTty = runCli(["-y", "--all"], project, freshHome);
  assert.notStrictEqual(noTty.status, 0);
  assert.match(`${noTty.stdout}\n${noTty.stderr}`, /--region/);
  assert.strictEqual(existsSync(join(freshHome, ".claude.json")), false);
});

const GRANT = "sgm_testtesttest1234";

function writeGrant(home: string, expiresAt: string | null): void {
  const dir = join(home, ".config", "add-sg-mcp");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({
      version: 1,
      current: {
        apiBase: "https://api.app.stackguardian.io/api/v1",
        dashboardUrl: "https://app.stackguardian.io",
        org: "demo-org",
        obtainedAt: "2026-09-16T12:00:00.000Z",
        authType: "grant",
        accessToken: GRANT,
        expiresAt,
      },
    }),
  );
}

test("a saved grant is shown by status but never reused as an API key", () => {
  const home = createTempDir();
  const project = createTempDir();
  writeGrant(home, "2099-01-01T00:00:00.000Z");

  const status = expectOk(runCli(["status"], project, home));
  assert.match(status, /Grant token: sgm_…1234/);
  assert.match(status, /Validity: expires/);

  // Default (apikey) mode must ignore the grant and ask for a sign-in instead.
  const connect = runCli(["-y", "--all"], project, home);
  assert.notStrictEqual(connect.status, 0);
  const output = `${connect.stdout}\n${connect.stderr}`;
  assert.ok(
    !output.includes("Using saved credentials"),
    "a grant must not be reused as an API key",
  );
  assert.match(output, /--region/);
  assert.match(
    output,
    /The saved grant for demo-org will be replaced; it stays active until you revoke it from Profile → Connected apps\./,
  );
  assert.ok(!output.includes("sgm_"), "the grant token must never be printed");
  assert.strictEqual(existsSync(join(home, ".claude.json")), false);

  const logout = expectOk(runCli(["logout"], project, home));
  assert.match(logout, /Connected apps/);
});

test("--auth grant installs a live grant as a Bearer header and re-logs in when it expired", () => {
  const home = createTempDir();
  const project = createTempDir();
  writeGrant(home, "2099-01-01T00:00:00.000Z");
  const output = expectOk(
    runCli(
      [
        "--auth",
        "grant",
        "--region",
        "eu",
        "-y",
        "-a",
        "claude-code",
        "--skip-skills",
      ],
      project,
      home,
    ),
  );
  assert.match(output, /Using the saved grant for demo-org/);
  assert.ok(!output.includes("sgm_"), "the grant token must never be printed");
  const claude = JSON.parse(
    readFileSync(join(home, ".claude.json"), "utf-8"),
  ) as {
    mcpServers: Record<
      string,
      { url: string; headers: Record<string, string> }
    >;
  };
  assert.strictEqual(claude.mcpServers[NAME]?.url, URL);
  assert.strictEqual(
    claude.mcpServers[NAME]?.headers?.Authorization,
    `Bearer ${GRANT}`,
  );

  const stale = createTempDir();
  writeGrant(stale, "2020-01-01T00:00:00.000Z");
  const expired = runCli(
    [
      "--auth",
      "grant",
      "--region",
      "eu",
      "-y",
      "-a",
      "claude-code",
      "--skip-skills",
      "--no-browser",
      "--login-timeout",
      "1",
    ],
    project,
    stale,
  );
  const expiredOutput = `${expired.stdout}\n${expired.stderr}`;
  assert.ok(
    !expiredOutput.includes("Using the saved grant"),
    "an expired grant must not be reused",
  );
  assert.match(expiredOutput, /\/oauth\/authorize\/\?/);
  assert.notStrictEqual(expired.status, 0);
  assert.strictEqual(existsSync(join(stale, ".claude.json")), false);
});

test("login --auth grant asks the broker, not the cli-connect page", () => {
  const home = createTempDir();
  const project = createTempDir();
  const result = runCli(
    [
      "login",
      "--auth",
      "grant",
      "--region",
      "eu",
      "--no-browser",
      "--login-timeout",
      "1",
    ],
    project,
    home,
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /\/oauth\/authorize\/\?/);
  assert.match(output, /code_challenge=/);
  assert.ok(
    !output.includes("cli-connect"),
    "the API-key connect page must not be used for a grant login",
  );
  assert.notStrictEqual(result.status, 0);
  assert.strictEqual(
    existsSync(join(home, ".config", "add-sg-mcp", "credentials.json")),
    false,
  );
});

test("login refuses an --auth mode it cannot run", () => {
  const project = createTempDir();
  for (const auth of ["oauth", "grnat"]) {
    const home = createTempDir();
    const result = runCli(
      [
        "login",
        "--auth",
        auth,
        "--region",
        "eu",
        "--no-browser",
        "--login-timeout",
        "1",
      ],
      project,
      home,
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notStrictEqual(result.status, 0, auth);
    assert.ok(
      !output.includes("https://"),
      `login --auth ${auth} must not open any sign-in page`,
    );
    assert.strictEqual(
      existsSync(join(home, ".config", "add-sg-mcp", "credentials.json")),
      false,
      auth,
    );
  }
});

test("--help is branded and lists the StackGuardian commands", () => {
  const home = createTempDir();
  const project = createTempDir();
  const output = expectOk(runCli(["--help"], project, home));
  assert.match(output, /add-sg-mcp/);
  for (const cmd of ["login", "logout", "status", "remove", "list-agents"]) {
    assert.match(output, new RegExp(`\\b${cmd}\\b`));
  }
  assert.match(output, /--project/);
  assert.match(output, /--token/);
});

test("--auth oauth writes a headerless entry for OAuth-capable agents only", () => {
  const home = createTempDir();
  const project = createTempDir();
  const output = expectOk(
    runCli(
      [
        "--auth",
        "oauth",
        "--org",
        "demo-org",
        "--region",
        "us",
        "-y",
        "--all",
        "--skip-skills",
      ],
      project,
      home,
    ),
  );
  assert.match(output, /OAuth mode/);
  const claude = JSON.parse(
    readFileSync(join(home, ".claude.json"), "utf-8"),
  ) as {
    mcpServers: Record<string, { url: string; headers?: unknown }>;
  };
  assert.strictEqual(
    claude.mcpServers[NAME]?.url,
    "https://api.us.stackguardian.io/api/v1/orgs/demo-org/mcp/",
  );
  assert.strictEqual(claude.mcpServers[NAME]?.headers, undefined);
  assert.strictEqual(
    existsSync(join(home, ".kiro", "settings", "mcp.json")),
    false,
  );
  assert.strictEqual(
    existsSync(join(home, ".config", "add-sg-mcp", "credentials.json")),
    false,
  );
  assert.strictEqual(
    existsSync(join(home, ".claude", "skills", "sg-create-workflow")),
    false,
  );
});

cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
