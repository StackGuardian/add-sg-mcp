#!/usr/bin/env tsx
import assert from "node:assert";
import http from "node:http";
import {
  startCallbackServer,
  loginViaBrowser,
  callbackHtml,
  generateState,
  LoginError,
} from "../src/sg/auth.js";

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

function post(
  url: string,
  form: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

const STATE = "state_0123456789abcdef";
const KEY = "sgu_abcdefghijklmnop";

await test("generateState yields a base64url nonce of at least 32 chars", async () => {
  const s = generateState();
  assert.match(s, /^[A-Za-z0-9_-]{32,}$/);
  assert.notStrictEqual(s, generateState());
});

await test("valid callback resolves with org, key and api base, then the server closes", async () => {
  const server = await startCallbackServer(STATE);
  const url = `http://127.0.0.1:${server.port}/callback?state=${STATE}&org=demo-org&api_key=${KEY}&api_base=${encodeURIComponent("https://api.app.stackguardian.io/api/v1")}`;
  const res = await get(url);
  assert.strictEqual(res.status, 200);
  assert.ok(!res.body.includes(KEY), "response must not echo the key");
  assert.match(res.body, /replaceState/);
  const result = await server.result;
  assert.deepStrictEqual(result, {
    org: "demo-org",
    apiKey: KEY,
    apiBase: "https://api.app.stackguardian.io/api/v1",
  });
  await assert.rejects(get(`http://127.0.0.1:${server.port}/callback`));
});

await test("state mismatch and bad params answer 400 and keep listening", async () => {
  const server = await startCallbackServer(STATE);
  const base = `http://127.0.0.1:${server.port}/callback`;
  const wrongState = await get(
    `${base}?state=nope_nope_nope_nope&org=demo-org&api_key=${KEY}&api_base=https%3A%2F%2Fapi.app.stackguardian.io%2Fapi%2Fv1`,
  );
  assert.strictEqual(wrongState.status, 400);
  const badOrg = await get(
    `${base}?state=${STATE}&org=bad%20org&api_key=${KEY}&api_base=https%3A%2F%2Fapi.app.stackguardian.io%2Fapi%2Fv1`,
  );
  assert.strictEqual(badOrg.status, 400);
  const badBase = await get(
    `${base}?state=${STATE}&org=demo-org&api_key=${KEY}&api_base=https%3A%2F%2Fevil.example.com%2Fapi%2Fv1`,
  );
  assert.strictEqual(badBase.status, 400);
  const badKey = await get(
    `${base}?state=${STATE}&org=demo-org&api_key=short&api_base=https%3A%2F%2Fapi.app.stackguardian.io%2Fapi%2Fv1`,
  );
  assert.strictEqual(badKey.status, 400);
  const notFound = await get(`http://127.0.0.1:${server.port}/other`);
  assert.strictEqual(notFound.status, 404);
  const ok = await get(
    `${base}?state=${STATE}&org=demo-org&api_key=${KEY}&api_base=https%3A%2F%2Fapi.app.stackguardian.io%2Fapi%2Fv1`,
  );
  assert.strictEqual(ok.status, 200);
  const result = await server.result;
  assert.strictEqual(result.org, "demo-org");
});

await test("a form POST callback is accepted like GET; the page links back and never shows the key", async () => {
  const server = await startCallbackServer(STATE, {
    dashboardUrl: "https://app.stackguardian.io",
  });
  const res = await post(`http://127.0.0.1:${server.port}/callback`, {
    state: STATE,
    org: "demo-org",
    api_key: KEY,
    api_base: "https://api.app.stackguardian.io/api/v1",
  });
  assert.strictEqual(res.status, 200);
  assert.ok(!res.body.includes(KEY));
  assert.match(res.body, /href="https:\/\/app\.stackguardian\.io"/);
  const result = await server.result;
  assert.strictEqual(result.org, "demo-org");
  assert.strictEqual(result.apiKey, KEY);
});

await test("a POST with the wrong state is refused and the server keeps listening", async () => {
  const server = await startCallbackServer(STATE);
  const bad = await post(`http://127.0.0.1:${server.port}/callback`, {
    state: "nope_nope_nope_nope",
    org: "demo-org",
    api_key: KEY,
    api_base: "https://api.app.stackguardian.io/api/v1",
  });
  assert.strictEqual(bad.status, 400);
  assert.ok(!bad.body.includes("Back to StackGuardian"));
  const ok = await post(`http://127.0.0.1:${server.port}/callback`, {
    state: STATE,
    org: "demo-org",
    api_key: KEY,
    api_base: "https://api.app.stackguardian.io/api/v1",
  });
  assert.strictEqual(ok.status, 200);
  await server.result;
});

await test("extra allowed hosts are honoured for custom environments", async () => {
  const server = await startCallbackServer(STATE, {
    allowedApiHosts: ["localhost"],
  });
  const res = await get(
    `http://127.0.0.1:${server.port}/callback?state=${STATE}&org=demo-org&api_key=${KEY}&api_base=https%3A%2F%2Flocalhost%3A8000%2Fapi%2Fv1`,
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(
    (await server.result).apiBase,
    "https://localhost:8000/api/v1",
  );
});

await test("access_denied rejects with a cancelled LoginError", async () => {
  const server = await startCallbackServer(STATE);
  const res = await get(
    `http://127.0.0.1:${server.port}/callback?state=${STATE}&error=access_denied`,
  );
  assert.strictEqual(res.status, 200);
  await assert.rejects(
    server.result,
    (err: unknown) => err instanceof LoginError && err.code === "cancelled",
  );
});

await test("loginViaBrowser passes the auth URL to the caller and times out", async () => {
  let seen = "";
  await assert.rejects(
    loginViaBrowser({
      dashboardUrl: "https://app.stackguardian.io",
      timeoutMs: 150,
      openBrowser: async () => false,
      onAuthUrl: (u) => (seen = u),
    }),
    (err: unknown) => err instanceof LoginError && err.code === "timeout",
  );
  const url = new URL(seen);
  assert.strictEqual(url.pathname, "/orchestrator/cli-connect");
  assert.match(url.searchParams.get("port") ?? "", /^\d+$/);
  assert.match(url.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{32,}$/);
});

await test("loginViaBrowser resolves when the browser hits the callback", async () => {
  const result = await loginViaBrowser({
    dashboardUrl: "https://app.stackguardian.io",
    org: "preset-org",
    timeoutMs: 5000,
    openBrowser: async (authUrl) => {
      const u = new URL(authUrl);
      assert.strictEqual(u.searchParams.get("org"), "preset-org");
      const port = u.searchParams.get("port");
      const state = u.searchParams.get("state");
      void get(
        `http://127.0.0.1:${port}/callback?state=${state}&org=preset-org&api_key=${KEY}&api_base=https%3A%2F%2Fapi.app.stackguardian.io%2Fapi%2Fv1`,
      );
      return true;
    },
  });
  assert.strictEqual(result.org, "preset-org");
  assert.strictEqual(result.apiKey, KEY);
});

await test("callbackHtml escapes the message and never carries a key", async () => {
  const html = callbackHtml("error", "Bad <state>");
  assert.match(html, /Bad &lt;state&gt;/);
  assert.match(html, /history\.replaceState/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
