#!/usr/bin/env tsx
import assert from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCredentialsPath,
  readCredentials,
  writeCredentials,
  deleteCredentials,
  type SgCredentials,
} from "../src/sg/credentials.js";

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

function setupConfigHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "add-sg-mcp-cred-"));
  tempDirs.push(dir);
  process.env.XDG_CONFIG_HOME = dir;
  return dir;
}

const sample: SgCredentials = {
  apiBase: "https://api.app.stackguardian.io/api/v1",
  dashboardUrl: "https://app.stackguardian.io",
  org: "demo-org",
  apiKey: "sgu_abcdefghijklmnop",
  obtainedAt: "2026-09-08T12:00:00.000Z",
};

test("path lives under XDG_CONFIG_HOME/add-sg-mcp/credentials.json", () => {
  const home = setupConfigHome();
  assert.strictEqual(
    getCredentialsPath(),
    join(home, "add-sg-mcp", "credentials.json"),
  );
});

test("write then read round-trips and uses 0600/0700 modes", () => {
  const home = setupConfigHome();
  const path = writeCredentials(sample);
  assert.strictEqual(path, join(home, "add-sg-mcp", "credentials.json"));
  assert.deepStrictEqual(readCredentials(), sample);
  if (process.platform !== "win32") {
    assert.strictEqual(statSync(path).mode & 0o777, 0o600);
    assert.strictEqual(statSync(join(home, "add-sg-mcp")).mode & 0o777, 0o700);
  }
});

test("missing or unparsable file reads as null", () => {
  const home = setupConfigHome();
  assert.strictEqual(readCredentials(), null);
  mkdirSync(join(home, "add-sg-mcp"), { recursive: true });
  writeFileSync(join(home, "add-sg-mcp", "credentials.json"), "{oops");
  assert.strictEqual(readCredentials(), null);
});

test("wrong version or missing fields read as null", () => {
  const home = setupConfigHome();
  mkdirSync(join(home, "add-sg-mcp"), { recursive: true });
  writeFileSync(
    join(home, "add-sg-mcp", "credentials.json"),
    JSON.stringify({ version: 99, current: sample }),
  );
  assert.strictEqual(readCredentials(), null);
  writeFileSync(
    join(home, "add-sg-mcp", "credentials.json"),
    JSON.stringify({ version: 1, current: { ...sample, apiKey: "" } }),
  );
  assert.strictEqual(readCredentials(), null);
});

test("deleteCredentials reports whether a file was removed", () => {
  const home = setupConfigHome();
  assert.strictEqual(deleteCredentials(), false);
  writeCredentials(sample);
  assert.strictEqual(
    existsSync(join(home, "add-sg-mcp", "credentials.json")),
    true,
  );
  assert.strictEqual(deleteCredentials(), true);
  assert.strictEqual(
    existsSync(join(home, "add-sg-mcp", "credentials.json")),
    false,
  );
});

for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
