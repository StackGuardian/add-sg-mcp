#!/usr/bin/env tsx
import assert from "node:assert";
import {
  SG_SERVER_NAME_PREFIX,
  LEGACY_SG_SERVER_NAME,
  serverNameForOrg,
  isStackGuardianServer,
  SG_ENVIRONMENTS,
  PRESET_EXCLUDED_AGENTS,
  environmentForRegion,
  regionChoices,
  isValidOrg,
  isValidState,
  isValidApiKey,
  normalizeApiBase,
  isAllowedApiBase,
  buildMcpUrl,
  buildAuthHeader,
  maskKey,
} from "../src/sg/preset.js";

let passed = 0;
let failed = 0;

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

test("server names are StackGuardian-<org> and recognised alongside the legacy name", () => {
  assert.strictEqual(SG_SERVER_NAME_PREFIX, "StackGuardian");
  assert.strictEqual(serverNameForOrg("demo-org"), "StackGuardian-demo-org");
  assert.match(serverNameForOrg("Org_1"), /^[A-Za-z0-9_-]+$/);
  assert.strictEqual(isStackGuardianServer("StackGuardian-demo-org"), true);
  assert.strictEqual(isStackGuardianServer(LEGACY_SG_SERVER_NAME), true);
  assert.strictEqual(
    isStackGuardianServer(
      "my-sg",
      "https://api.app.stackguardian.io/api/v1/orgs/demo-org/mcp/",
    ),
    true,
  );
  assert.strictEqual(
    isStackGuardianServer("context7", "https://mcp.context7.com/mcp"),
    false,
  );
  assert.strictEqual(isStackGuardianServer("StackGuardianX"), false);
  assert.deepStrictEqual([...PRESET_EXCLUDED_AGENTS], ["claude-desktop", "fx"]);
});

test("environments cover eu, us and qa with matching hosts", () => {
  assert.deepStrictEqual(
    SG_ENVIRONMENTS.map((e) => e.id),
    ["eu", "us", "qa"],
  );
  assert.strictEqual(
    environmentForRegion("eu")?.apiBase,
    "https://api.app.stackguardian.io/api/v1",
  );
  assert.strictEqual(
    environmentForRegion("US")?.dashboardUrl,
    "https://us.stackguardian.io",
  );
  assert.strictEqual(
    environmentForRegion("qa")?.apiBase,
    "https://testapi.qa.stackguardian.io/api/v1",
  );
  assert.strictEqual(environmentForRegion("apac"), undefined);
});

test("the region picker offers eu and us, and qa only when asked", () => {
  assert.deepStrictEqual(
    regionChoices().map((e) => e.id),
    ["eu", "us"],
  );
  assert.deepStrictEqual(
    regionChoices(true).map((e) => e.id),
    ["eu", "us", "qa"],
  );
});

test("buildMcpUrl uses /api/v1/orgs/<org>/mcp/ with a trailing slash", () => {
  assert.strictEqual(
    buildMcpUrl("https://api.app.stackguardian.io/api/v1", "demo-org"),
    "https://api.app.stackguardian.io/api/v1/orgs/demo-org/mcp/",
  );
  assert.strictEqual(
    buildMcpUrl("https://api.us.stackguardian.io/", "Org_1"),
    "https://api.us.stackguardian.io/api/v1/orgs/Org_1/mcp/",
  );
});

test("normalizeApiBase trims, strips slashes and appends /api/v1 once", () => {
  assert.strictEqual(
    normalizeApiBase(" https://api.app.stackguardian.io "),
    "https://api.app.stackguardian.io/api/v1",
  );
  assert.strictEqual(
    normalizeApiBase("https://api.app.stackguardian.io/api/v1/"),
    "https://api.app.stackguardian.io/api/v1",
  );
});

test("isAllowedApiBase accepts only https *.stackguardian.io or listed hosts", () => {
  assert.strictEqual(
    isAllowedApiBase("https://api.us.stackguardian.io/api/v1"),
    true,
  );
  assert.strictEqual(
    isAllowedApiBase("https://testapi.qa.stackguardian.io/api/v1"),
    true,
  );
  assert.strictEqual(
    isAllowedApiBase("http://api.app.stackguardian.io"),
    false,
  );
  assert.strictEqual(
    isAllowedApiBase("https://api.app.stackguardian.io.evil.com/api/v1"),
    false,
  );
  assert.strictEqual(isAllowedApiBase("https://stackguardian.io"), false);
  assert.strictEqual(isAllowedApiBase("not a url"), false);
  assert.strictEqual(
    isAllowedApiBase("https://localhost:8000/api/v1", ["localhost"]),
    true,
  );
});

test("org, state and key validation", () => {
  assert.strictEqual(isValidOrg("demo-org_1"), true);
  assert.strictEqual(isValidOrg("bad org"), false);
  assert.strictEqual(isValidOrg("../x"), false);
  assert.strictEqual(isValidOrg(""), false);
  assert.strictEqual(isValidOrg(42), false);
  assert.strictEqual(isValidState("a".repeat(16)), true);
  assert.strictEqual(isValidState("short"), false);
  assert.strictEqual(isValidState("x".repeat(129)), false);
  assert.strictEqual(isValidApiKey("sgu_abcdefghijklmnop"), true);
  assert.strictEqual(isValidApiKey("sgu_short"), false);
  assert.strictEqual(isValidApiKey("sgu_has space aaaaaaaaaaaaa"), false);
});

test("buildAuthHeader picks the scheme from the credential", () => {
  assert.strictEqual(
    buildAuthHeader({ authType: "apikey", apiKey: "sgu_abc" }),
    "Authorization: apikey sgu_abc",
  );
  assert.strictEqual(
    buildAuthHeader({ authType: "grant", accessToken: "sgat_abc" }),
    "Authorization: Bearer sgat_abc",
  );
});

test("maskKey keeps prefix and last four characters", () => {
  assert.strictEqual(maskKey("sgu_abcdefgh1234"), "sgu_…1234");
  assert.strictEqual(maskKey("short"), "…");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
