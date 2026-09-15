#!/usr/bin/env node
// Runs the test files under a throwaway HOME so upstream's in-process
// global-scope tests can never touch the developer's real agent configs.
// Usage: node tests/run.mjs unit|e2e|all
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UNIT = [
  "tests/source-parser.test.ts",
  "tests/agents.test.ts",
  "tests/config.test.ts",
  "tests/installer.test.ts",
  "tests/package-arguments.test.ts",
  "tests/template.test.ts",
  "tests/reader.test.ts",
  "tests/formats-remove.test.ts",
  "tests/formats-utils.test.ts",
  "tests/opencode-config.test.ts",
  "tests/lib.test.ts",
  "tests/sg-preset.test.ts",
  "tests/sg-credentials.test.ts",
  "tests/sg-auth.test.ts",
  "tests/sg-skills.test.ts",
];
const E2E = [
  "tests/e2e/install.test.ts",
  "tests/e2e/cli.test.ts",
  "tests/e2e/sg-cli.test.ts",
];

const which = process.argv[2] ?? "all";
const files =
  which === "unit" ? UNIT : which === "e2e" ? E2E : [...UNIT, ...E2E];
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
const home = mkdtempSync(join(tmpdir(), "add-sg-mcp-test-home-"));
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  CODEX_HOME: join(home, ".codex"),
  APPDATA: join(home, "AppData", "Roaming"),
  LOCALAPPDATA: join(home, "AppData", "Local"),
};

let failures = 0;
for (const file of files) {
  console.log(`\n▶ ${file}`);
  const result = spawnSync(tsx, [join(repoRoot, file)], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) failures++;
}
rmSync(home, { recursive: true, force: true });
console.log(
  `\n${files.length - failures}/${files.length} test files passed${failures ? ` — ${failures} FAILED` : ""}`,
);
process.exit(failures ? 1 : 0);
