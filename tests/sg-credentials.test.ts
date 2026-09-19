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
  isExpired,
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
  authType: "apikey",
};

const grant: SgCredentials = {
  apiBase: "https://testapi.qa.stackguardian.io/api/v1",
  dashboardUrl: "https://dash.qa.stackguardian.io",
  org: "demo-org",
  obtainedAt: "2026-09-16T12:00:00.000Z",
  authType: "grant",
  accessToken: "sgm_abcdefghijklmnop",
  expiresAt: null,
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

test("a grant credential round-trips with its token and expiry", () => {
  setupConfigHome();
  writeCredentials(grant);
  assert.deepStrictEqual(readCredentials(), grant);
  const dated = { ...grant, expiresAt: "2026-12-01T00:00:00.000Z" };
  writeCredentials(dated);
  assert.deepStrictEqual(readCredentials(), dated);
});

test("a grant credential without a token reads as null", () => {
  const home = setupConfigHome();
  mkdirSync(join(home, "add-sg-mcp"), { recursive: true });
  writeFileSync(
    join(home, "add-sg-mcp", "credentials.json"),
    JSON.stringify({
      version: 1,
      current: { ...grant, accessToken: "" },
    }),
  );
  assert.strictEqual(readCredentials(), null);
});

test("a grant with an unreadable expiry reads as null", () => {
  const home = setupConfigHome();
  mkdirSync(join(home, "add-sg-mcp"), { recursive: true });
  for (const expiresAt of [12345, "", { at: 1 }]) {
    writeFileSync(
      join(home, "add-sg-mcp", "credentials.json"),
      JSON.stringify({ version: 1, current: { ...grant, expiresAt } }),
    );
    assert.strictEqual(readCredentials(), null, JSON.stringify(expiresAt));
  }
});

test("a file written before grants reads back as an apikey credential", () => {
  const home = setupConfigHome();
  mkdirSync(join(home, "add-sg-mcp"), { recursive: true });
  const legacy = {
    apiBase: sample.apiBase,
    dashboardUrl: sample.dashboardUrl,
    org: sample.org,
    apiKey: sample.apiKey,
    obtainedAt: sample.obtainedAt,
  };
  writeFileSync(
    join(home, "add-sg-mcp", "credentials.json"),
    JSON.stringify({ version: 1, current: legacy }),
  );
  assert.deepStrictEqual(readCredentials(), sample);
});

test("isExpired is true only for a past expiry", () => {
  assert.strictEqual(isExpired(sample), false);
  assert.strictEqual(isExpired(grant), false);
  assert.strictEqual(
    isExpired({ ...grant, expiresAt: "2020-01-01T00:00:00.000Z" }),
    true,
  );
  assert.strictEqual(
    isExpired({
      ...grant,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    false,
  );
  // Fail closed: an expiry we cannot read is not proof the grant is still good.
  assert.strictEqual(isExpired({ ...grant, expiresAt: "not a date" }), true);
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
