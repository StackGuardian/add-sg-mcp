import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { LoginError, callbackHtml, generateState, openUrl } from "./auth.js";

/** What the broker hands back for `--auth grant`, plus where it came from. */
export interface GrantResult {
  accessToken: string;
  org: string;
  roles: string[];
  expiresIn?: number;
  apiBase: string;
  dashboardUrl: string;
}

/**
 * The CLI has no client secret: its OAuth identity is the URL of the hosted
 * client-metadata document (CIMD), which the broker fetches to learn the name
 * and the loopback redirect it may use.
 */
export const CLIENT_METADATA_URL = (dashboardUrl: string): string =>
  `${dashboardUrl.trim().replace(/\/+$/, "")}/.well-known/oauth-clients/add-sg-mcp.json`;

const DEFAULT_TIMEOUT_MS = 300_000;

function trimBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, "");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  /** Narrows the consent page to one organization; the broker picks otherwise. */
  org?: string;
}

export function authorizeUrl(apiBase: string, p: AuthorizeParams): string {
  const base = trimBase(apiBase);
  const url = new URL(`${base}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("code_challenge", p.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", p.state);
  if (p.org) {
    url.searchParams.set(
      "resource",
      `${base}/orgs/${encodeURIComponent(p.org)}/mcp/`,
    );
  }
  return url.toString();
}

export interface CodeCallbackServer {
  port: number;
  /** Settles once: with the authorization code, or a LoginError("cancelled"). */
  result: Promise<{ code: string }>;
  close(): void;
}

function respond(
  res: http.ServerResponse,
  status: number,
  kind: "ok" | "error",
  message: string,
  onFlushed?: () => void,
): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(callbackHtml(kind, message), onFlushed);
}

/** The loopback redirect of the authorization-code flow, on an ephemeral port. */
export function startCodeCallbackServer(
  state: string,
): Promise<CodeCallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let settle: {
      resolve: (value: { code: string }) => void;
      reject: (error: Error) => void;
    } | null = null;
    const result = new Promise<{ code: string }>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // Nobody may be awaiting yet when a cancel arrives; keep Node quiet.
    result.catch(() => {});

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback") {
        respond(res, 404, "error", "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        respond(
          res,
          400,
          "error",
          "This link does not match the terminal session. Start again from the terminal.",
        );
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        respond(res, 200, "error", "Cancelled. You can close this tab.", () => {
          settle?.reject(
            new LoginError("cancelled", `Cancelled in the browser (${error})`),
          );
          close();
        });
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        respond(res, 400, "error", "The callback carried no code.");
        return;
      }
      respond(
        res,
        200,
        "ok",
        "You can close this tab and return to the terminal.",
        () => {
          settle?.resolve({ code });
          close();
        },
      );
    });

    function close(): void {
      server.close();
      server.closeIdleConnections?.();
    }

    server.on("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolveServer({ port: address.port, result, close });
    });
  });
}

export interface TokenRequest {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}

export interface TokenResult {
  accessToken: string;
  org: string;
  roles: string[];
  expiresIn?: number;
}

/** Back-channel exchange; the code and the verifier never touch the browser together. */
export async function exchangeCode(
  apiBase: string,
  p: TokenRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: p.code,
    code_verifier: p.verifier,
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
  });
  const res = await fetchImpl(`${trimBase(apiBase)}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    throw new Error(
      `Token exchange failed: ${String(json.error ?? res.status)}${
        json.error_description ? ` (${String(json.error_description)})` : ""
      }`,
    );
  }
  return {
    accessToken: json.access_token,
    org: String(json.org ?? ""),
    roles: Array.isArray(json.roles) ? json.roles.map(String) : [],
    ...(typeof json.expires_in === "number"
      ? { expiresIn: json.expires_in }
      : {}),
  };
}

export interface GrantLoginOptions {
  apiBase: string;
  dashboardUrl: string;
  org?: string;
  timeoutMs?: number;
  /** Returns false when no browser could be opened; the URL was already passed to onAuthUrl. */
  openBrowser?: (url: string) => Promise<boolean>;
  onAuthUrl?: (url: string) => void;
}

export async function loginViaGrant(
  options: GrantLoginOptions,
): Promise<GrantResult> {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const server = await startCodeCallbackServer(state);
  const redirectUri = `http://127.0.0.1:${server.port}/callback`;
  const clientId = CLIENT_METADATA_URL(options.dashboardUrl);
  const url = authorizeUrl(options.apiBase, {
    clientId,
    redirectUri,
    challenge,
    state,
    org: options.org,
  });
  options.onAuthUrl?.(url);
  const open = options.openBrowser ?? openUrl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new LoginError(
          "timeout",
          `No response from the browser within ${Math.round(timeoutMs / 1000)}s.`,
        ),
      );
    }, timeoutMs);
  });
  try {
    await open(url).catch(() => false);
    const { code } = await Promise.race([server.result, timeout]);
    const token = await exchangeCode(options.apiBase, {
      code,
      verifier,
      clientId,
      redirectUri,
    });
    return {
      ...token,
      apiBase: options.apiBase,
      dashboardUrl: options.dashboardUrl,
    };
  } finally {
    if (timer) clearTimeout(timer);
    server.close();
  }
}
