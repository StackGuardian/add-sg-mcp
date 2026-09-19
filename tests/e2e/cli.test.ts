#!/usr/bin/env tsx

import assert from "node:assert";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import * as TOML from "@iarna/toml";

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
  const dir = mkdtempSync(join(tmpdir(), "add-mcp-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tempDirs = [];
}

const testFileDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testFileDir, "..", "..");
const indexPath = join(repoRoot, "src", "index.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

function runCli(
  args: string[],
  cwd: string,
  homeDir: string,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  return spawnSync(tsxBin, [indexPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: join(homeDir, ".config"),
      CODEX_HOME: join(homeDir, ".codex"),
      NO_COLOR: "1",
      ...extraEnv,
    },
  });
}

function claudeDesktopConfigPath(homeDir: string): string {
  if (process.platform === "darwin") {
    return join(
      homeDir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homeDir, "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  return join(homeDir, ".config", "Claude", "claude_desktop_config.json");
}

function windsurfConfigPath(homeDir: string): string {
  return join(homeDir, ".codeium", "windsurf", "mcp_config.json");
}

function antigravityConfigPath(homeDir: string): string {
  return join(homeDir, ".gemini", "config", "mcp_config.json");
}

// Regression: https://github.com/neon-solutions/add-mcp/issues/29
test("E2E CLI: absolute path with spaces is preserved as single command", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const binaryPath =
    "/Applications/Hopper Disassembler.app/Contents/MacOS/HopperMCPServer";

  const result = runCli(
    [binaryPath, "-a", "cursor", "-y", "--name", "Hopper"],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(projectDir, ".cursor", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  const server = servers.Hopper as Record<string, unknown>;

  assert.ok(server, "Hopper server should be configured");
  assert.strictEqual(
    server.command,
    binaryPath,
    "command must keep the full path verbatim (including spaces)",
  );
  assert.deepStrictEqual(
    server.args,
    [],
    "no implicit arg-splitting on spaces in the path",
  );
});

test("E2E CLI: absolute path with spaces accepts repeated --args", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const binaryPath = "/opt/Some App/bin/my-server";

  const result = runCli(
    [
      binaryPath,
      "-a",
      "cursor",
      "-y",
      "--name",
      "Server",
      "--args",
      "--port",
      "--args",
      "3000",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(projectDir, ".cursor", "mcp.json");
  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  const server = servers.Server as Record<string, unknown>;

  assert.strictEqual(server.command, binaryPath);
  assert.deepStrictEqual(server.args, ["--port", "3000"]);
});

test("E2E CLI: --gitignore adds local config path", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "-a", "cursor", "-y", "--gitignore"],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const gitignorePath = join(projectDir, ".gitignore");
  assert.strictEqual(existsSync(gitignorePath), true);
  assert.strictEqual(
    readFileSync(gitignorePath, "utf-8"),
    ".cursor/mcp.json\n",
  );
});

test("E2E CLI: --gitignore with --global warns and does not write project .gitignore", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "-a", "cursor", "-g", "-y", "--gitignore"],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(
    combinedOutput,
    /--gitignore is only supported for project-scoped installations; ignoring\./,
  );
  assert.strictEqual(existsSync(join(projectDir, ".gitignore")), false);
  assert.strictEqual(existsSync(join(homeDir, ".cursor", "mcp.json")), true);
});

test("E2E CLI: -y keeps project-capable agents project-scoped by default", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "cursor",
      "-y",
      "--name",
      "project-scope",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  assert.strictEqual(existsSync(join(projectDir, ".cursor", "mcp.json")), true);
  assert.strictEqual(existsSync(join(homeDir, ".cursor", "mcp.json")), false);
});

test("E2E CLI: global-only selections force a shared global scope", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "cursor",
      "-a",
      "claude-desktop",
      "-y",
      "--name",
      "shared-global-scope",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  assert.strictEqual(
    existsSync(join(projectDir, ".cursor", "mcp.json")),
    false,
  );
  assert.strictEqual(existsSync(join(homeDir, ".cursor", "mcp.json")), true);
  assert.strictEqual(existsSync(claudeDesktopConfigPath(homeDir)), true);

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Selected agents require global installation/);
  assert.match(output, /Scope:\s*Global/);
});

test("E2E CLI: mcporter default install writes project config", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "-a", "mcporter", "-y"],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  assert.strictEqual(
    existsSync(join(projectDir, "config", "mcporter.json")),
    true,
  );
});

test("E2E CLI: mcporter global install writes home config", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "-a", "mcporter", "-g", "-y"],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  assert.strictEqual(
    existsSync(join(homeDir, ".mcporter", "mcporter.json")),
    true,
  );
});

test("E2E CLI: Goose HTTP install with headers", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "goose",
      "-y",
      "--name",
      "example",
      "--header",
      "Authorization: Bearer token",
      "--header",
      "x-read-only: true",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const gooseConfigPath = join(homeDir, ".config", "goose", "config.yaml");
  assert.strictEqual(existsSync(gooseConfigPath), true);

  const saved = yaml.load(readFileSync(gooseConfigPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const extensions = saved.extensions as Record<string, unknown>;
  const server = extensions.example as Record<string, unknown>;

  assert.strictEqual(server.type, "streamable_http");
  assert.strictEqual(server.uri, "https://mcp.example.com/mcp");
  assert.deepStrictEqual(server.headers, {
    Authorization: "Bearer token",
    "x-read-only": "true",
  });
});

test("E2E CLI: fx remote install writes ~/.fx/mcp.json without -g", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "fx",
      "-y",
      "--name",
      "example",
      "--header",
      "X-Workspace: demo",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(homeDir, ".fx", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);
  assert.strictEqual(statSync(join(homeDir, ".fx")).mode & 0o777, 0o700);
  assert.strictEqual(statSync(configPath).mode & 0o777, 0o600);
  assert.strictEqual(existsSync(join(projectDir, ".fx.json")), false);
  assert.strictEqual(existsSync(join(projectDir, "mcp.json")), false);

  const saved = JSON.parse(readFileSync(configPath, "utf-8")) as {
    mcp: Record<string, Record<string, unknown>>;
  };
  const server = saved.mcp.example;
  assert.ok(server);
  assert.strictEqual(server.type, "http");
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
  assert.strictEqual(server.enabled, true);
  assert.deepStrictEqual(server.headers, {
    "X-Workspace": "demo",
  });
});

test("E2E CLI: fx writes bearer_token_env", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "fx",
      "-y",
      "--name",
      "example",
      "--bearer-token-env",
      "NEON_API_KEY",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const saved = JSON.parse(
    readFileSync(join(homeDir, ".fx", "mcp.json"), "utf-8"),
  ) as { mcp: Record<string, Record<string, unknown>> };
  const server = saved.mcp.example;
  assert.ok(server);
  assert.strictEqual(server.bearer_token_env, "NEON_API_KEY");
  assert.strictEqual("headers" in server, false);
});

test("E2E CLI: mixed fx then cursor keeps Authorization on Cursor and bearer_token_env on fx", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "fx",
      "-a",
      "cursor",
      "-y",
      "--name",
      "example",
      "--header",
      "Authorization: Bearer token",
      "--bearer-token-env",
      "NEON_API_KEY",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /bearer token env var is not supported by Cursor/);
  assert.match(
    output,
    /Authorization header dropped from the fx config; fx reads the token from NEON_API_KEY/,
  );

  const fxSaved = JSON.parse(
    readFileSync(join(homeDir, ".fx", "mcp.json"), "utf-8"),
  ) as { mcp: Record<string, Record<string, unknown>> };
  const fxServer = fxSaved.mcp.example;
  assert.ok(fxServer);
  assert.strictEqual(fxServer.bearer_token_env, "NEON_API_KEY");
  assert.strictEqual("headers" in fxServer, false);

  const cursorSaved = JSON.parse(
    readFileSync(join(homeDir, ".cursor", "mcp.json"), "utf-8"),
  ) as { mcpServers: Record<string, Record<string, unknown>> };
  const cursorServer = cursorSaved.mcpServers.example;
  assert.ok(cursorServer);
  assert.deepStrictEqual(cursorServer.headers, {
    Authorization: "Bearer token",
  });
});

test("E2E CLI: --bearer-token-env rejects a value in place of a name", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "fx",
      "-y",
      "--header",
      "Authorization: Bearer token",
      "--bearer-token-env",
      "Bearer sk-live",
    ],
    projectDir,
    homeDir,
  );

  const output = `${result.stdout}\n${result.stderr}`;
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /not a valid name/);
  assert.strictEqual(existsSync(join(homeDir, ".fx")), false);
});

test("E2E CLI: whitespace-only --bearer-token-env fails", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "fx",
      "-y",
      "--bearer-token-env",
      "   ",
    ],
    projectDir,
    homeDir,
  );

  const output = `${result.stdout}\n${result.stderr}`;
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /Invalid --bearer-token-env/);
  assert.strictEqual(existsSync(join(homeDir, ".fx")), false);
});

test("E2E CLI: --bearer-token-env is ignored for stdio installs", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "mcp-server-postgres",
      "-a",
      "fx",
      "-y",
      "--name",
      "postgres",
      "--bearer-token-env",
      "NEON_API_KEY",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /--bearer-token-env is only used for remote URLs/);

  const saved = JSON.parse(
    readFileSync(join(homeDir, ".fx", "mcp.json"), "utf-8"),
  ) as { mcp: Record<string, Record<string, unknown>> };
  const server = saved.mcp.postgres;
  assert.ok(server);
  assert.strictEqual(server.type, "local");
  assert.strictEqual("bearer_token_env" in server, false);
});

test("E2E CLI: fx rejects a literal Authorization header", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "fx",
      "-y",
      "--name",
      "example",
      "--header",
      "Authorization: Bearer token",
    ],
    projectDir,
    homeDir,
  );

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /literal Authorization header/);
  assert.match(output, /--bearer-token-env/);
  assert.notStrictEqual(result.status, 0);
  assert.strictEqual(existsSync(join(homeDir, ".fx")), false);
});

test("E2E CLI: fx stdio install uses command array and environment", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "mcp-server-postgres",
      "-a",
      "fx",
      "-y",
      "--name",
      "postgres",
      "--env",
      "DATABASE_URL=postgres://localhost/test",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const saved = JSON.parse(
    readFileSync(join(homeDir, ".fx", "mcp.json"), "utf-8"),
  ) as { mcp: Record<string, Record<string, unknown>> };
  const server = saved.mcp.postgres;
  assert.ok(server);
  assert.strictEqual(server.type, "local");
  assert.deepStrictEqual(server.command, ["npx", "-y", "mcp-server-postgres"]);
  assert.deepStrictEqual(server.environment, {
    DATABASE_URL: "postgres://localhost/test",
  });
  assert.strictEqual("args" in server, false);
});

test("E2E CLI: Goose HTTP install with -h header shorthand", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "goose",
      "-y",
      "--name",
      "example",
      "-h",
      "Authorization: Bearer token",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const gooseConfigPath = join(homeDir, ".config", "goose", "config.yaml");
  const saved = yaml.load(readFileSync(gooseConfigPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const extensions = saved.extensions as Record<string, unknown>;
  const server = extensions.example as Record<string, unknown>;

  assert.deepStrictEqual(server.headers, {
    Authorization: "Bearer token",
  });
});

test("E2E CLI: remote server to claude-desktop errors with custom message", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "-a", "claude-desktop", "-y"],
    projectDir,
    homeDir,
  );

  assert.notStrictEqual(result.status, 0, "CLI should exit with non-zero");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /don't support http transport/,
    "should report unsupported transport",
  );
  assert.match(
    output,
    /Settings.*Connectors/,
    "should include the custom unsupportedTransportMessage",
  );
});

test("E2E CLI: --all skips claude-desktop for remote server with custom message", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "--all", "-y"],
    projectDir,
    homeDir,
  );

  assert.strictEqual(result.status, 0, "CLI should succeed");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /Skipping agents.*Claude Desktop/,
    "should warn about skipping Claude Desktop",
  );
  assert.match(
    output,
    /Settings.*Connectors/,
    "should include the custom unsupportedTransportMessage",
  );
});

test("E2E CLI: stdio server to claude-desktop succeeds", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "claude-desktop",
      "-y",
      "--name",
      "filesystem",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = claudeDesktopConfigPath(homeDir);
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  assert.ok(servers.filesystem, "filesystem server should be configured");

  const server = servers.filesystem as Record<string, unknown>;
  assert.strictEqual(server.command, "npx");
});

test("E2E CLI: remote server to antigravity succeeds with serverUrl config", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "antigravity",
      "-y",
      "--name",
      "remote",
      "--header",
      "Authorization: Bearer token",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = antigravityConfigPath(homeDir);
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  const server = servers.remote as Record<string, unknown>;
  assert.strictEqual(server.serverUrl, "https://mcp.example.com/mcp");
  assert.deepStrictEqual(server.headers, {
    Authorization: "Bearer token",
  });
});

test("E2E CLI: --all includes antigravity for remote server", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "--all", "-y"],
    projectDir,
    homeDir,
  );

  assert.strictEqual(result.status, 0, "CLI should succeed");

  const configPath = antigravityConfigPath(homeDir);
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  const antigravityRemoteServer = Object.values(servers).find((value) => {
    const server = value as Record<string, unknown>;
    return server.serverUrl === "https://mcp.example.com/mcp";
  });
  assert.ok(
    antigravityRemoteServer,
    "remote antigravity server should exist in mcpServers",
  );
});

test("E2E CLI: stdio server to antigravity succeeds", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "antigravity",
      "-y",
      "--name",
      "filesystem",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = antigravityConfigPath(homeDir);
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  assert.ok(servers.filesystem, "filesystem server should be configured");

  const server = servers.filesystem as Record<string, unknown>;
  assert.strictEqual(server.command, "npx");
});

test("E2E CLI: remote server to windsurf succeeds with serverUrl config", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "windsurf",
      "-y",
      "--name",
      "remote",
      "--header",
      "Authorization: Bearer token",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = windsurfConfigPath(homeDir);
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  const server = servers.remote as Record<string, unknown>;
  assert.strictEqual(server.serverUrl, "https://mcp.example.com/mcp");
  assert.deepStrictEqual(server.headers, {
    Authorization: "Bearer token",
  });
});

test("E2E CLI: --all includes windsurf for remote server", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "--all", "-y"],
    projectDir,
    homeDir,
  );

  assert.strictEqual(result.status, 0, "CLI should succeed");

  const configPath = windsurfConfigPath(homeDir);
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  const windsurfRemoteServer = Object.values(servers).find((value) => {
    const server = value as Record<string, unknown>;
    return server.serverUrl === "https://mcp.example.com/mcp";
  });
  assert.ok(
    windsurfRemoteServer,
    "remote windsurf server should exist in mcpServers",
  );
});

test("E2E CLI: stdio server to windsurf succeeds", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "windsurf",
      "-y",
      "--name",
      "filesystem",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = windsurfConfigPath(homeDir);
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  assert.ok(servers.filesystem, "filesystem server should be configured");

  const server = servers.filesystem as Record<string, unknown>;
  assert.strictEqual(server.command, "npx");
});

test("E2E CLI: windsurf aliases (codeium, cascade) install to windsurf config", () => {
  for (const alias of ["codeium", "cascade"] as const) {
    const projectDir = createTempDir();
    const homeDir = createTempDir();

    const result = runCli(
      ["https://mcp.example.com/mcp", "-a", alias, "-y", "--name", "remote"],
      projectDir,
      homeDir,
    );

    assert.strictEqual(result.status, 0, `${alias} alias should succeed`);

    const configPath = windsurfConfigPath(homeDir);
    assert.strictEqual(existsSync(configPath), true);

    const saved = JSON.parse(readFileSync(configPath, "utf-8"));
    const servers = saved.mcpServers as Record<string, unknown>;
    assert.ok(servers.remote, `${alias} should write remote server config`);
  }
});

test("E2E CLI: local stdio install supports repeated --env", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "cursor",
      "-y",
      "--name",
      "filesystem",
      "--env",
      "API_KEY=secret",
      "--env",
      "NESTED=value=with=equals",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(projectDir, ".cursor", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const servers = saved.mcpServers as Record<string, unknown>;
  const server = servers.filesystem as Record<string, unknown>;

  assert.strictEqual(server.command, "npx");
  assert.deepStrictEqual(server.env, {
    API_KEY: "secret",
    NESTED: "value=with=equals",
  });
});

test("E2E CLI: invalid --env format exits with error", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "cursor",
      "-y",
      "--env",
      "INVALID_ENV",
    ],
    projectDir,
    homeDir,
  );

  assert.notStrictEqual(result.status, 0, "CLI should exit with non-zero");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Invalid --env value\(s\)/);
  assert.match(output, /Use 'KEY=VALUE' format\./);
});

test("E2E CLI: --header with empty value hints at shell expansion", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "-y", "--header", "Authorization: "],
    projectDir,
    homeDir,
  );

  assert.notStrictEqual(result.status, 0, "CLI should exit with non-zero");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Invalid --header value\(s\)/);
  assert.match(output, /single quotes/);
  assert.match(output, /\$\{VAR\}/);
});

test("E2E CLI: --env with empty value hints at shell expansion", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "cursor",
      "-y",
      "--env",
      "API_KEY=",
    ],
    projectDir,
    homeDir,
  );

  assert.notStrictEqual(result.status, 0, "CLI should exit with non-zero");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Invalid --env value\(s\)/);
  assert.match(output, /single quotes/);
  assert.match(output, /\$\{VAR\}/);
});

test("E2E CLI: --env with no equals does not show shell-expansion hint", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "@modelcontextprotocol/server-filesystem",
      "-a",
      "cursor",
      "-y",
      "--env",
      "no-equals-here",
    ],
    projectDir,
    homeDir,
  );

  assert.notStrictEqual(result.status, 0, "CLI should exit with non-zero");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Invalid --env value\(s\)/);
  assert.doesNotMatch(output, /single quotes/);
});

test("E2E CLI: --header with no colon does not show shell-expansion hint", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["https://mcp.example.com/mcp", "-y", "--header", "no-colon-here"],
    projectDir,
    homeDir,
  );

  assert.notStrictEqual(result.status, 0, "CLI should exit with non-zero");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Invalid --header value\(s\)/);
  assert.doesNotMatch(output, /single quotes/);
});

test("E2E CLI: remote install with --env warns and succeeds", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "cursor",
      "-y",
      "--env",
      "API_KEY=secret",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /--env is only used for local\/package\/command installs, ignoring/,
  );

  const configPath = join(projectDir, ".cursor", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);
});
// ── list command tests ───────────────────────────────────────────────────

test("list: shows help when no agents detected", () => {
  const homeDir = createTempDir();
  const projectDir = createTempDir();

  const result = runCli(["list"], projectDir, homeDir);

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /No agents detected/);
});

// ── remove command tests ─────────────────────────────────────────────────

// ── sync command tests ───────────────────────────────────────────────────

test("sync: unreadable Copilot config is not treated as empty", () => {
  const homeDir = createTempDir();
  const projectDir = createTempDir();

  mkdirSync(join(projectDir, ".github"), { recursive: true });
  writeFileSync(
    join(projectDir, ".github", "mcp.json"),
    `{
  "mcpServers": {
    "keep": { "url": "https://keep.example.invalid/mcp" },
  }
}
`,
  );
  mkdirSync(join(projectDir, ".cursor"), { recursive: true });
  writeFileSync(
    join(projectDir, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: {} }),
  );

  const empty = runCli(["sync", "-y"], projectDir, homeDir);
  assert.notStrictEqual(empty.status, 0, `${empty.stdout}\n${empty.stderr}`);
  const emptyOutput = `${empty.stdout}\n${empty.stderr}`;
  assert.match(emptyOutput, /Invalid JSON/);
  assert.doesNotMatch(emptyOutput, /already in sync/);

  writeFileSync(
    join(projectDir, ".cursor", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        added: { type: "http", url: "https://new.example.invalid/mcp" },
      },
    }),
  );

  const result = runCli(["sync", "-y"], projectDir, homeDir);
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Invalid JSON/);
  assert.doesNotMatch(output, /Failed to add/);
  assert.match(
    readFileSync(join(projectDir, ".github", "mcp.json"), "utf-8"),
    /keep/,
  );
  assert.doesNotMatch(
    readFileSync(join(projectDir, ".github", "mcp.json"), "utf-8"),
    /added/,
  );
});

test("E2E CLI: Grok alias honors GROK_HOME and maps native remote fields", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  const grokHome = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/sse",
      "-a",
      "grok",
      "-g",
      "-y",
      "--name",
      "grok-remote",
      "--transport",
      "sse",
      "--header",
      "Authorization: Bearer ${API_TOKEN}",
      "--timeout",
      "2000",
    ],
    projectDir,
    homeDir,
    { GROK_HOME: grokHome },
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(grokHome, "config.toml");
  assert.strictEqual(existsSync(configPath), true);
  assert.strictEqual(existsSync(join(homeDir, ".grok", "config.toml")), false);

  const saved = TOML.parse(readFileSync(configPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const server = (saved.mcp_servers as Record<string, Record<string, unknown>>)[
    "grok-remote"
  ];
  assert.ok(server);
  assert.strictEqual(server.url, "https://mcp.example.com/sse");
  assert.deepStrictEqual(server.headers, {
    Authorization: "Bearer ${API_TOKEN}",
  });
  assert.strictEqual(server.tool_timeout_sec, 2);
  assert.strictEqual("type" in server, false);
});

test("E2E CLI: Grok global install falls back to ~/.grok", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "grok-build",
      "-g",
      "-y",
      "--name",
      "grok-default-home",
    ],
    projectDir,
    homeDir,
    { GROK_HOME: "" },
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(homeDir, ".grok", "config.toml");
  assert.strictEqual(existsSync(configPath), true);
  const saved = TOML.parse(readFileSync(configPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const server = (saved.mcp_servers as Record<string, Record<string, unknown>>)[
    "grok-default-home"
  ];
  assert.ok(server);
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
});

test("E2E CLI: Grok project install ignores GROK_HOME", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  const grokHome = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/sse",
      "-a",
      "grok-build",
      "-y",
      "--name",
      "grok-project",
      "--transport",
      "sse",
    ],
    projectDir,
    homeDir,
    { GROK_HOME: grokHome },
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(projectDir, ".grok", "config.toml");
  assert.strictEqual(existsSync(configPath), true);
  assert.strictEqual(existsSync(join(grokHome, "config.toml")), false);

  const saved = TOML.parse(readFileSync(configPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const server = (saved.mcp_servers as Record<string, Record<string, unknown>>)[
    "grok-project"
  ];
  assert.ok(server);
  assert.strictEqual(server.url, "https://mcp.example.com/sse");
  assert.strictEqual("type" in server, false);
});

test("E2E CLI: Kiro alias installs into .kiro/settings/mcp.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "kiro",
      "-y",
      "--name",
      "kiro-remote",
      "--timeout",
      "60000",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(projectDir, ".kiro", "settings", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const server = saved.mcpServers["kiro-remote"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
  assert.strictEqual(server.timeout, 60000);
  assert.strictEqual("type" in server, false);
});

test("E2E CLI: Pi honors PI_CODING_AGENT_DIR for global installs", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  const piAgentDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "pi-agent",
      "-g",
      "-y",
      "--name",
      "pi-remote",
      "--timeout",
      "5000",
    ],
    projectDir,
    homeDir,
    { PI_CODING_AGENT_DIR: piAgentDir },
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(piAgentDir, "mcp.json");
  assert.strictEqual(existsSync(configPath), true);
  assert.strictEqual(
    existsSync(join(homeDir, ".pi", "agent", "mcp.json")),
    false,
  );

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const server = saved.mcpServers["pi-remote"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
  assert.strictEqual(server.requestTimeoutMs, 5000);
  assert.strictEqual("type" in server, false);
});

test("E2E CLI: Pi global install falls back to ~/.pi/agent", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    ["mcp-server-postgres", "-a", "pi", "-g", "-y", "--name", "pi-local"],
    projectDir,
    homeDir,
    { PI_CODING_AGENT_DIR: "" },
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(homeDir, ".pi", "agent", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const server = saved.mcpServers["pi-local"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.command, "npx");
  assert.deepStrictEqual(server.args, ["-y", "mcp-server-postgres"]);
  assert.strictEqual("type" in server, false);
});

test("E2E CLI: Mastra alias installs into .mastracode/mcp.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "mastra",
      "-y",
      "--name",
      "mastra-remote",
      "--scopes",
      "read,write",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(projectDir, ".mastracode", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);
  assert.strictEqual(existsSync(join(projectDir, ".mcp.json")), false);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const server = saved.mcpServers["mastra-remote"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
  assert.deepStrictEqual(server.oauth, { scopes: ["read", "write"] });
  assert.strictEqual("type" in server, false);
});

test("E2E CLI: Mastra Code global install writes ~/.mastracode/mcp.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "mcp-server-postgres",
      "-a",
      "mastracode",
      "-g",
      "-y",
      "--name",
      "mastra-local",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(homeDir, ".mastracode", "mcp.json");
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const server = saved.mcpServers["mastra-local"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.command, "npx");
  assert.deepStrictEqual(server.args, ["-y", "mcp-server-postgres"]);
  assert.strictEqual("type" in server, false);
});

test("E2E CLI: Kimi alias honors KIMI_CODE_HOME for global installs", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  const kimiHome = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "kimi",
      "-g",
      "-y",
      "--name",
      "kimi-remote",
      "--timeout",
      "5000",
    ],
    projectDir,
    homeDir,
    { KIMI_CODE_HOME: kimiHome },
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(kimiHome, "mcp.json");
  assert.strictEqual(existsSync(configPath), true);
  assert.strictEqual(
    existsSync(join(homeDir, ".kimi-code", "mcp.json")),
    false,
  );

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const server = saved.mcpServers["kimi-remote"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.transport, "http");
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
  assert.strictEqual(server.toolTimeoutMs, 5000);
});

test("E2E CLI: Kimi global install falls back to ~/.kimi-code", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "mcp-server-postgres",
      "-a",
      "kimi-code",
      "-g",
      "-y",
      "--name",
      "kimi-local",
    ],
    projectDir,
    homeDir,
    { KIMI_CODE_HOME: "" },
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const saved = JSON.parse(
    readFileSync(join(homeDir, ".kimi-code", "mcp.json"), "utf-8"),
  );
  const server = saved.mcpServers["kimi-local"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.transport, "stdio");
  assert.strictEqual(server.command, "npx");
  assert.deepStrictEqual(server.args, ["-y", "mcp-server-postgres"]);
});

test("E2E CLI: Kilo alias installs into the XDG config dir for global installs", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "kilo",
      "-g",
      "-y",
      "--name",
      "kilo-remote",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const configPath = join(homeDir, ".config", "kilo", "kilo.json");
  assert.strictEqual(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, "utf-8"));
  const server = saved.mcp["kilo-remote"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.type, "remote");
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
});

test("E2E CLI: OpenCode global install defaults to opencode.jsonc", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "opencode",
      "-g",
      "-y",
      "--name",
      "oc-remote",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const jsoncPath = join(homeDir, ".config", "opencode", "opencode.jsonc");
  assert.strictEqual(existsSync(jsoncPath), true);
  assert.strictEqual(
    existsSync(join(homeDir, ".config", "opencode", "opencode.json")),
    false,
  );

  const saved = JSON.parse(readFileSync(jsoncPath, "utf-8"));
  const server = saved.mcp["oc-remote"] as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.type, "remote");
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
});

test("E2E CLI: OpenCode global install prefers existing jsonc over json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  const configDir = join(homeDir, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "opencode.jsonc"), "{}");
  writeFileSync(join(configDir, "opencode.json"), "{}");

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "opencode",
      "-g",
      "-y",
      "--name",
      "oc-remote",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const jsoncPath = join(configDir, "opencode.jsonc");
  const jsonPath = join(configDir, "opencode.json");
  assert.strictEqual(existsSync(jsoncPath), true);

  const jsonc = JSON.parse(readFileSync(jsoncPath, "utf-8"));
  const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
  assert.ok(jsonc.mcp["oc-remote"]);
  assert.ok(!json.mcp);
});

test("E2E CLI: OpenCode global install reuses existing opencode.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  const configDir = join(homeDir, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "opencode.json"), "{}");

  const result = runCli(
    ["mcp-server-postgres", "-a", "opencode", "-g", "-y", "--name", "postgres"],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  assert.strictEqual(existsSync(join(configDir, "opencode.jsonc")), false);
  const saved = JSON.parse(
    readFileSync(join(configDir, "opencode.json"), "utf-8"),
  );
  const server = saved.mcp.postgres as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.type, "local");
});

test("E2E CLI: github-copilot-cli project install writes .mcp.json, not .vscode/mcp.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "github-copilot-cli",
      "-y",
      "--name",
      "ghc",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  assert.strictEqual(existsSync(join(projectDir, ".mcp.json")), true);
  assert.strictEqual(
    existsSync(join(projectDir, ".vscode", "mcp.json")),
    false,
  );

  const saved = JSON.parse(
    readFileSync(join(projectDir, ".mcp.json"), "utf-8"),
  );
  const server = saved.mcpServers.ghc as Record<string, unknown>;
  assert.ok(server);
  assert.strictEqual(server.type, "http");
  assert.strictEqual(server.url, "https://mcp.example.com/mcp");
  assert.ok(!("tools" in server));
});

test("E2E CLI: github-copilot-cli writes strict JSON into a comment-only .mcp.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  writeFileSync(join(projectDir, ".mcp.json"), "// MCP configuration\n");

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "github-copilot-cli",
      "-y",
      "--name",
      "ghc",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const text = readFileSync(join(projectDir, ".mcp.json"), "utf-8");
  assert.doesNotMatch(text, /^\s*\/\//m);
  const saved = JSON.parse(text);
  assert.ok(saved.mcpServers.ghc);
});

test("E2E CLI: claude-code does not create .mcp.json that hides .github/mcp.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();
  mkdirSync(join(projectDir, ".github"), { recursive: true });
  writeFileSync(
    join(projectDir, ".github", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        keep: { type: "http", url: "https://keep.example.com/mcp" },
      },
    }),
  );

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "claude-code",
      "-y",
      "--name",
      "added",
    ],
    projectDir,
    homeDir,
  );

  assert.strictEqual(existsSync(join(projectDir, ".mcp.json")), false);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notStrictEqual(result.status, 0, output);
  assert.match(output, /\.github\/mcp\.json/);
  assert.match(output, /Merge the servers/);
  assert.match(output, /Failed/);
  assert.doesNotMatch(output, /Done!/);
});

test("E2E CLI: --timeout and --scopes map per agent and warn on drop", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "gemini-cli",
      "-a",
      "cursor",
      "-a",
      "vscode",
      "-y",
      "--name",
      "scoped",
      "--timeout",
      "30000",
      "--scopes",
      "read,write",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  // Gemini: timeout + oauth.scopes
  const gemini = JSON.parse(
    readFileSync(join(projectDir, ".gemini", "settings.json"), "utf-8"),
  );
  const geminiServer = gemini.mcpServers.scoped as Record<string, unknown>;
  assert.strictEqual(geminiServer.timeout, 30000);
  assert.deepStrictEqual(geminiServer.oauth, { scopes: ["read", "write"] });

  // Cursor: scopes -> auth.scopes, timeout dropped
  const cursor = JSON.parse(
    readFileSync(join(projectDir, ".cursor", "mcp.json"), "utf-8"),
  );
  const cursorServer = cursor.mcpServers.scoped as Record<string, unknown>;
  assert.deepStrictEqual(cursorServer.auth, { scopes: ["read", "write"] });
  assert.ok(!("timeout" in cursorServer));

  // VS Code: both dropped, no raw fields
  const vscode = JSON.parse(
    readFileSync(join(projectDir, ".vscode", "mcp.json"), "utf-8"),
  );
  const vscodeServer = vscode.servers.scoped as Record<string, unknown>;
  assert.ok(!("timeout" in vscodeServer));
  assert.ok(!("oauthScopes" in vscodeServer));
  assert.ok(!("auth" in vscodeServer));

  // User is warned about dropped fields
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /request timeout is not supported by/i);
  assert.match(output, /OAuth scopes is not supported by/i);
});

test("E2E CLI: --timeout with a package install warns and is ignored", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "mcp-server-postgres",
      "-a",
      "claude-code",
      "-y",
      "--name",
      "pg",
      "--timeout",
      "5000",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const saved = JSON.parse(
    readFileSync(join(projectDir, ".mcp.json"), "utf-8"),
  );
  const server = saved.mcpServers.pg as Record<string, unknown>;
  assert.ok(!("timeout" in server), "timeout is remote-only");

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /--timeout is only used for remote URLs/i);
});

test("E2E CLI: Codex auto-approve selected tool writes per-tool approval", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "executor mcp",
      "-a",
      "codex",
      "-y",
      "--name",
      "executor",
      "--auto-approve",
      "--approve-tool",
      "execute",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const saved = TOML.parse(
    readFileSync(join(projectDir, ".codex", "config.toml"), "utf-8"),
  ) as Record<string, unknown>;
  const executor = (
    saved.mcp_servers as Record<string, Record<string, unknown>>
  ).executor;
  assert.ok(executor);
  const tools = executor.tools as Record<string, unknown>;
  assert.deepStrictEqual(tools.execute, { approval_mode: "approve" });
});

test("E2E CLI: Codex --auto-approve (all tools) writes server default", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "executor mcp",
      "-a",
      "codex",
      "-y",
      "--name",
      "executor",
      "--auto-approve",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const saved = TOML.parse(
    readFileSync(join(projectDir, ".codex", "config.toml"), "utf-8"),
  ) as Record<string, unknown>;
  const executor = (
    saved.mcp_servers as Record<string, Record<string, unknown>>
  ).executor;
  assert.ok(executor);
  assert.strictEqual(executor.default_tools_approval_mode, "approve");
});

test("E2E CLI: Claude Code auto-approve selected tool writes settings.local.json", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "executor mcp",
      "-a",
      "claude-code",
      "-y",
      "--name",
      "executor",
      "--auto-approve",
      "--approve-tool",
      "execute",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  // MCP server config stays clean
  const mcp = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
  const server = mcp.mcpServers.executor as Record<string, unknown>;
  assert.ok(!("autoApproveTools" in server));

  // Approval lands in the separate settings file
  const settings = JSON.parse(
    readFileSync(join(projectDir, ".claude", "settings.local.json"), "utf-8"),
  ) as Record<string, unknown>;
  const permissions = settings.permissions as Record<string, unknown>;
  assert.deepStrictEqual(permissions.allow, ["mcp__executor__execute"]);
});

test("E2E CLI: Claude Code --auto-approve (all tools) writes server-level rule", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "executor mcp",
      "-a",
      "claude-code",
      "-y",
      "--name",
      "executor",
      "--auto-approve",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const settings = JSON.parse(
    readFileSync(join(projectDir, ".claude", "settings.local.json"), "utf-8"),
  ) as Record<string, unknown>;
  const permissions = settings.permissions as Record<string, unknown>;
  assert.deepStrictEqual(permissions.allow, ["mcp__executor"]);
});

test("E2E CLI: auto-approve on an unsupported agent warns and writes no approval", () => {
  const projectDir = createTempDir();
  const homeDir = createTempDir();

  const result = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "cursor",
      "-y",
      "--name",
      "remote",
      "--auto-approve",
    ],
    projectDir,
    homeDir,
  );

  if (result.status !== 0) {
    throw new Error(
      `CLI failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }

  const cursor = JSON.parse(
    readFileSync(join(projectDir, ".cursor", "mcp.json"), "utf-8"),
  );
  const server = cursor.mcpServers.remote as Record<string, unknown>;
  assert.ok(!("autoApproveTools" in server));
  assert.ok(!("tools" in server));

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /tool auto-approval is not supported by Cursor/i);
});

test("E2E CLI: sync matches OpenCode command arrays to Cursor command/args", () => {
  const homeDir = createTempDir();
  const projectDir = createTempDir();
  mkdirSync(join(projectDir, ".cursor"), { recursive: true });
  writeFileSync(
    join(projectDir, ".cursor", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        pg: {
          command: "npx",
          args: ["-y", "mcp-server-postgres"],
        },
      },
    }),
  );
  writeFileSync(
    join(projectDir, "opencode.jsonc"),
    JSON.stringify({
      mcp: {
        servers: {
          postgres: {
            type: "local",
            command: ["npx", "-y", "mcp-server-postgres"],
          },
        },
      },
    }),
  );

  const result = runCli(["sync", "-y"], projectDir, homeDir);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /conflict/i);
});

test("E2E CLI: sync does not delete a different OpenCode server on a dest-name collision", () => {
  const homeDir = createTempDir();
  const projectDir = createTempDir();
  mkdirSync(join(projectDir, ".cursor"), { recursive: true });
  writeFileSync(
    join(projectDir, ".cursor", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        pg: { url: "https://a.example.com/mcp" },
        b: { url: "https://b.example.com/mcp" },
      },
    }),
  );
  writeFileSync(
    join(projectDir, "opencode.jsonc"),
    JSON.stringify({
      mcp: {
        servers: {
          postgres: {
            type: "remote",
            url: "https://a.example.com/mcp",
            timeout: { startup: 45_000 },
          },
          pg: {
            type: "remote",
            url: "https://b.example.com/mcp",
          },
        },
      },
    }),
  );

  const result = runCli(["sync", "-y"], projectDir, homeDir);
  assert.ok(
    result.status === 0 || result.status === 1,
    `${result.stdout}\n${result.stderr}`,
  );
  const mcp = JSON.parse(
    readFileSync(join(projectDir, "opencode.jsonc"), "utf-8"),
  ).mcp as { servers: Record<string, Record<string, unknown>> };
  const byUrl = new Map(
    Object.values(mcp.servers).map((server) => [server.url, server]),
  );
  assert.deepStrictEqual(byUrl.get("https://a.example.com/mcp")?.timeout, {
    startup: 45_000,
  });
  assert.strictEqual(
    byUrl.get("https://b.example.com/mcp")?.url,
    "https://b.example.com/mcp",
  );
  assert.ok(
    result.status === 0 || result.status === 1,
    `${result.stdout}\n${result.stderr}`,
  );
});

test("E2E CLI: failed OpenCode destination write leaves the source alias", () => {
  const homeDir = createTempDir();
  const projectDir = createTempDir();
  mkdirSync(join(projectDir, ".cursor"), { recursive: true });
  writeFileSync(
    join(projectDir, ".cursor", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        pg: { url: "https://mcp.postgres.example.com/mcp" },
      },
    }),
  );
  const openPath = join(projectDir, "opencode.jsonc");
  writeFileSync(
    openPath,
    JSON.stringify({
      mcp: {
        servers: {
          postgres: {
            type: "remote",
            url: "https://mcp.postgres.example.com/mcp",
          },
        },
      },
    }),
  );
  chmodSync(openPath, 0o444);

  const result = runCli(["sync", "-y"], projectDir, homeDir);
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  chmodSync(openPath, 0o644);
  const mcp = JSON.parse(readFileSync(openPath, "utf-8")).mcp as Record<
    string,
    Record<string, unknown>
  >;
  const servers = mcp.servers as unknown as Record<
    string,
    Record<string, unknown>
  >;
  assert.ok(servers.postgres);
  assert.strictEqual(servers.pg, undefined);
});

test("E2E CLI: OpenCode rejects a lone closing brace and leaves the file", () => {
  const homeDir = createTempDir();
  const projectDir = createTempDir();
  const malformed = "}";
  writeFileSync(join(projectDir, "opencode.jsonc"), malformed);

  const add = runCli(
    [
      "https://mcp.example.com/mcp",
      "-a",
      "opencode",
      "-y",
      "--name",
      "example",
    ],
    projectDir,
    homeDir,
  );
  assert.notStrictEqual(add.status, 0, `${add.stdout}\n${add.stderr}`);
  assert.strictEqual(
    readFileSync(join(projectDir, "opencode.jsonc"), "utf-8"),
    malformed,
  );
});

cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
