#!/usr/bin/env tsx
import assert from "node:assert";
import { callbackHtml, generateState } from "../src/sg/auth.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
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

await test("generateState yields a base64url nonce of at least 32 chars", async () => {
  const s = generateState();
  assert.match(s, /^[A-Za-z0-9_-]{32,}$/);
  assert.notStrictEqual(s, generateState());
});

await test("callbackHtml escapes the message and never carries a key", async () => {
  const html = callbackHtml("error", "Bad <state>");
  assert.match(html, /Bad &lt;state&gt;/);
  assert.match(html, /history\.replaceState/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
