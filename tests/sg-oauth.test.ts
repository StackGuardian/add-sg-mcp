#!/usr/bin/env tsx
import assert from "node:assert";
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  CLIENT_METADATA_URL,
  OAuthError,
  authorizeUrl,
  exchangeCode,
  generatePkce,
  loginViaGrant,
  startCodeCallbackServer,
} from "../src/sg/oauth.js";
import { LoginError } from "../src/sg/auth.js";

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

/**
 * A stand-in for `<apiBase>/oauth/token/` so the flow runs without mocking fetch.
 * Like the real gateway, it only answers the trailing-slash form.
 */
function startTokenServer(
  handler: (form: URLSearchParams) => { status: number; body: unknown },
): Promise<{ apiBase: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url !== "/api/v1/oauth/token/") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ msg: "Unauthorized" }));
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { status, body: payload } = handler(new URLSearchParams(body));
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        apiBase: `http://127.0.0.1:${port}/api/v1`,
        close: () => server.close(),
      });
    });
  });
}

const QA_API = "https://testapi.qa.stackguardian.io/api/v1";
const QA_DASHBOARD = "https://dash.qa.stackguardian.io";
const CLIENT_ID = `${QA_DASHBOARD}/.well-known/oauth-clients/add-sg-mcp.json`;
const TOKEN = "sgm_testtesttest1234";
const REQ = { code: "c", verifier: "v", clientId: "i", redirectUri: "r" };

await test("the client identity is the hosted metadata document URL", async () => {
  assert.strictEqual(CLIENT_METADATA_URL(QA_DASHBOARD), CLIENT_ID);
  assert.strictEqual(CLIENT_METADATA_URL(`${QA_DASHBOARD}/`), CLIENT_ID);
});

await test("the PKCE verifier is 43 base64url characters and the challenge is its S256", async () => {
  const { verifier, challenge } = generatePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(
    challenge,
    createHash("sha256").update(verifier).digest("base64url"),
  );
  assert.notStrictEqual(verifier, generatePkce().verifier);
});

await test("authorizeUrl carries the standard parameters and the MCP resource when an org is given", async () => {
  const url = new URL(
    authorizeUrl(QA_API, {
      clientId: CLIENT_ID,
      redirectUri: "http://127.0.0.1:5000/callback",
      challenge: "CHAL",
      state: "STATE",
      org: "demo-org",
    }),
  );
  assert.strictEqual(
    url.origin + url.pathname,
    "https://testapi.qa.stackguardian.io/api/v1/oauth/authorize/",
  );
  assert.strictEqual(url.searchParams.get("response_type"), "code");
  assert.strictEqual(url.searchParams.get("client_id"), CLIENT_ID);
  assert.strictEqual(
    url.searchParams.get("redirect_uri"),
    "http://127.0.0.1:5000/callback",
  );
  assert.strictEqual(url.searchParams.get("code_challenge"), "CHAL");
  assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(url.searchParams.get("state"), "STATE");
  assert.strictEqual(
    url.searchParams.get("resource"),
    "https://testapi.qa.stackguardian.io/api/v1/orgs/demo-org/mcp/",
  );
});

await test("authorizeUrl omits the resource when no org was chosen", async () => {
  const url = new URL(
    authorizeUrl(`${QA_API}/`, {
      clientId: CLIENT_ID,
      redirectUri: "http://127.0.0.1:5000/callback",
      challenge: "CHAL",
      state: "STATE",
    }),
  );
  assert.strictEqual(url.searchParams.get("resource"), null);
  assert.strictEqual(url.pathname, "/api/v1/oauth/authorize/");
});

await test("the code callback refuses a wrong state, keeps listening and then delivers the code", async () => {
  const server = await startCodeCallbackServer("STATE");
  const base = `http://127.0.0.1:${server.port}/callback`;
  const wrongState = await get(`${base}?code=x&state=WRONG`);
  assert.strictEqual(wrongState.status, 400);
  const notFound = await get(`http://127.0.0.1:${server.port}/other`);
  assert.strictEqual(notFound.status, 404);
  const noCode = await get(`${base}?state=STATE`);
  assert.strictEqual(noCode.status, 400);
  const good = await get(`${base}?code=SEALED&state=STATE`);
  assert.strictEqual(good.status, 200);
  assert.ok(!good.body.includes("SEALED"), "the page must not echo the code");
  assert.deepStrictEqual(await server.result, { code: "SEALED" });
});

await test("the code callback cancels on access_denied", async () => {
  const server = await startCodeCallbackServer("S2");
  const res = await get(
    `http://127.0.0.1:${server.port}/callback?error=access_denied&state=S2`,
  );
  assert.strictEqual(res.status, 200);
  await assert.rejects(
    server.result,
    (err: unknown) => err instanceof LoginError && err.code === "cancelled",
  );
});

await test("the code callback surfaces an authorization error that is not a cancellation", async () => {
  const server = await startCodeCallbackServer("S3");
  const res = await get(
    `http://127.0.0.1:${server.port}/callback?error=invalid_target&error_description=unknown%20resource&state=S3`,
  );
  assert.strictEqual(res.status, 200);
  await assert.rejects(server.result, (err: unknown) => {
    assert.ok(err instanceof OAuthError, "expected an OAuthError");
    assert.strictEqual(err.error, "invalid_target");
    assert.strictEqual(err.description, "unknown resource");
    assert.strictEqual(err.message, "invalid_target: unknown resource");
    return true;
  });
});

await test("exchangeCode posts a form and maps the response", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response(
      JSON.stringify({
        access_token: TOKEN,
        token_type: "Bearer",
        org: "demo-org",
        roles: ["DEV"],
        expires_in: 3600,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const result = await exchangeCode(
    QA_API,
    {
      code: "SEALED",
      verifier: "V",
      clientId: CLIENT_ID,
      redirectUri: "http://127.0.0.1:5000/callback",
    },
    fetchImpl,
  );
  assert.strictEqual(
    calls[0]?.url,
    "https://testapi.qa.stackguardian.io/api/v1/oauth/token/",
  );
  const form = new URLSearchParams(calls[0]?.body ?? "");
  assert.strictEqual(form.get("grant_type"), "authorization_code");
  assert.strictEqual(form.get("code"), "SEALED");
  assert.strictEqual(form.get("code_verifier"), "V");
  assert.strictEqual(form.get("client_id"), CLIENT_ID);
  assert.strictEqual(
    form.get("redirect_uri"),
    "http://127.0.0.1:5000/callback",
  );
  assert.deepStrictEqual(result, {
    accessToken: TOKEN,
    org: "demo-org",
    roles: ["DEV"],
    expiresIn: 3600,
  });
});

await test("exchangeCode omits expiresIn for a grant without an expiry", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        access_token: TOKEN,
        token_type: "Bearer",
        org: "demo-org",
        roles: [],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  assert.deepStrictEqual(
    await exchangeCode(
      QA_API,
      { code: "c", verifier: "v", clientId: "i", redirectUri: "r" },
      fetchImpl,
    ),
    { accessToken: TOKEN, org: "demo-org", roles: [] },
  );
});

await test("exchangeCode surfaces an OAuth error", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "the code has expired",
      }),
      { status: 400 },
    )) as unknown as typeof fetch;
  await assert.rejects(
    exchangeCode(
      "https://x/api/v1",
      { code: "c", verifier: "v", clientId: "i", redirectUri: "r" },
      fetchImpl,
    ),
    (err: unknown) => {
      assert.ok(err instanceof OAuthError, "expected an OAuthError");
      assert.strictEqual(err.error, "invalid_grant");
      assert.strictEqual(err.message, "invalid_grant: the code has expired");
      return true;
    },
  );
});

await test("exchangeCode rejects a token or a token_type it cannot use", async () => {
  const answer = (extra: Record<string, unknown>) =>
    (async () =>
      new Response(
        JSON.stringify({
          access_token: TOKEN,
          token_type: "Bearer",
          org: "demo-org",
          roles: [],
          ...extra,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  for (const extra of [
    { access_token: "sgm_short" },
    { access_token: "sgm_has space aaaaaaaaaaaa" },
    { token_type: "mac" },
    { token_type: undefined },
  ]) {
    await assert.rejects(
      exchangeCode(QA_API, REQ, answer(extra)),
      (err: unknown) =>
        err instanceof OAuthError && err.error === "invalid_response",
      JSON.stringify(extra),
    );
  }
  const lowercase = await exchangeCode(
    QA_API,
    REQ,
    answer({ token_type: "bearer" }),
  );
  assert.strictEqual(lowercase.accessToken, TOKEN);
});

await test("exchangeCode gives up when the token endpoint never answers", async () => {
  const hanging = http.createServer(() => {});
  await new Promise<void>((resolve) =>
    hanging.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = hanging.address() as AddressInfo;
  try {
    await assert.rejects(
      exchangeCode(`http://127.0.0.1:${port}/api/v1`, REQ, fetch, 200),
      (err: unknown) => err instanceof LoginError && err.code === "timeout",
    );
  } finally {
    hanging.closeAllConnections?.();
    hanging.close();
  }
});

await test("exchangeCode rejects an unusable expires_in", async () => {
  const withExpiry = (value: unknown) =>
    (async () =>
      new Response(
        JSON.stringify({
          access_token: TOKEN,
          token_type: "Bearer",
          org: "demo-org",
          roles: [],
          expires_in: value,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  for (const bad of [1e300, -1, "3600"]) {
    await assert.rejects(
      exchangeCode(
        QA_API,
        { code: "c", verifier: "v", clientId: "i", redirectUri: "r" },
        withExpiry(bad),
      ),
      (err: unknown) =>
        err instanceof OAuthError && err.error === "invalid_response",
      `expires_in ${String(bad)} must be refused`,
    );
  }
  const ok = await exchangeCode(
    QA_API,
    { code: "c", verifier: "v", clientId: "i", redirectUri: "r" },
    withExpiry(0),
  );
  assert.strictEqual(ok.expiresIn, 0);
});

await test("exchangeCode rejects a response without a usable token or organization", async () => {
  const noToken = (async () =>
    new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(
    exchangeCode(
      "https://x/api/v1",
      { code: "c", verifier: "v", clientId: "i", redirectUri: "r" },
      noToken,
    ),
    (err: unknown) =>
      err instanceof OAuthError && err.error === "invalid_response",
  );
  const badOrg = (async () =>
    new Response(
      JSON.stringify({
        access_token: TOKEN,
        token_type: "Bearer",
        org: "../evil",
        roles: [],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  await assert.rejects(
    exchangeCode(
      "https://x/api/v1",
      { code: "c", verifier: "v", clientId: "i", redirectUri: "r" },
      badOrg,
    ),
    (err: unknown) =>
      err instanceof OAuthError && err.error === "invalid_response",
  );
});

await test("loginViaGrant runs the whole flow and returns the grant", async () => {
  const seen: URLSearchParams[] = [];
  const token = await startTokenServer((form) => {
    seen.push(form);
    return {
      status: 200,
      body: {
        access_token: TOKEN,
        token_type: "Bearer",
        org: "demo-org",
        roles: ["DEV"],
        expires_in: 3600,
      },
    };
  });
  let authUrl = "";
  try {
    const result = await loginViaGrant({
      apiBase: token.apiBase,
      dashboardUrl: QA_DASHBOARD,
      org: "demo-org",
      timeoutMs: 5000,
      onAuthUrl: (url) => (authUrl = url),
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const redirect = new URL(parsed.searchParams.get("redirect_uri") ?? "");
        void get(
          `${redirect.origin}/callback?code=SEALED&state=${encodeURIComponent(parsed.searchParams.get("state") ?? "")}`,
        );
        return true;
      },
    });
    assert.deepStrictEqual(result, {
      accessToken: TOKEN,
      org: "demo-org",
      roles: ["DEV"],
      expiresIn: 3600,
      apiBase: token.apiBase,
      dashboardUrl: QA_DASHBOARD,
    });
  } finally {
    token.close();
  }
  const form = seen[0];
  assert.ok(form, "the token endpoint was called");
  assert.strictEqual(form.get("grant_type"), "authorization_code");
  assert.strictEqual(form.get("code"), "SEALED");
  assert.strictEqual(form.get("client_id"), CLIENT_ID);
  const challenge = new URL(authUrl).searchParams.get("code_challenge");
  assert.strictEqual(
    challenge,
    createHash("sha256")
      .update(form.get("code_verifier") ?? "")
      .digest("base64url"),
  );
  assert.ok(
    !authUrl.includes(form.get("code_verifier") ?? "never"),
    "the verifier must never leave the CLI over the front channel",
  );
});

await test("loginViaGrant hands the authorization URL to the caller and times out", async () => {
  let seen = "";
  await assert.rejects(
    loginViaGrant({
      apiBase: QA_API,
      dashboardUrl: QA_DASHBOARD,
      timeoutMs: 150,
      openBrowser: async () => false,
      onAuthUrl: (url) => (seen = url),
    }),
    (err: unknown) => err instanceof LoginError && err.code === "timeout",
  );
  const url = new URL(seen);
  assert.strictEqual(url.pathname, "/api/v1/oauth/authorize/");
  assert.strictEqual(url.searchParams.get("client_id"), CLIENT_ID);
  assert.strictEqual(url.searchParams.get("resource"), null);
  assert.match(
    url.searchParams.get("redirect_uri") ?? "",
    /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
  );
  assert.match(url.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{16,}$/);
  const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
  await assert.rejects(
    get(`${redirect.origin}/callback`),
    "the callback server must be closed once the login gave up",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
