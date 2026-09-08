import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import {
  cliConnectUrl,
  isAllowedApiBase,
  isValidApiKey,
  isValidOrg,
  normalizeApiBase,
} from "./preset.js";

export type LoginErrorCode = "cancelled" | "timeout";

export class LoginError extends Error {
  constructor(
    public readonly code: LoginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LoginError";
  }
}

export interface CallbackResult {
  org: string;
  apiKey: string;
  apiBase: string;
}

export interface CallbackServer {
  port: number;
  /** Settles once: with the credential, or a LoginError("cancelled"). */
  result: Promise<CallbackResult>;
  close(): void;
}

export interface CallbackServerOptions {
  /** Extra API hostnames accepted besides `*.stackguardian.io` (custom environments). */
  allowedApiHosts?: string[];
}

export interface LoginOptions extends CallbackServerOptions {
  dashboardUrl: string;
  org?: string;
  timeoutMs?: number;
  /** Returns false when no browser could be opened; the URL was already passed to onAuthUrl. */
  openBrowser?: (url: string) => Promise<boolean>;
  onAuthUrl?: (url: string) => void;
}

const DEFAULT_TIMEOUT_MS = 300_000;

export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The page the browser lands on. It never includes the key and strips the query from history. */
export function callbackHtml(kind: "ok" | "error", message: string): string {
  const title = kind === "ok" ? "Connected to StackGuardian" : "Not connected";
  const color = kind === "ok" ? "#0E6B78" : "#B0651C";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F4F6F7;color:#1B2530;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{background:#fff;border:1px solid #D3DADF;border-radius:8px;padding:32px 40px;max-width:480px;text-align:center}
h1{font-size:20px;margin:0 0 12px;color:${color}}p{margin:0;color:#4A5763}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>
<script>try{history.replaceState(null,"","/done")}catch(e){}</script>
</body></html>
`;
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

export function startCallbackServer(
  state: string,
  options: CallbackServerOptions = {},
): Promise<CallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let settle: {
      resolve: (value: CallbackResult) => void;
      reject: (error: Error) => void;
    } | null = null;
    const result = new Promise<CallbackResult>((resolve, reject) => {
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
      const params = url.searchParams;
      if (params.get("state") !== state) {
        respond(
          res,
          400,
          "error",
          "This link does not match the terminal session. Start again from the terminal.",
        );
        return;
      }
      const error = params.get("error");
      if (error) {
        respond(res, 200, "error", "Cancelled. You can close this tab.", () => {
          settle?.reject(
            new LoginError("cancelled", `Cancelled in the browser (${error})`),
          );
          close();
        });
        return;
      }
      const org = params.get("org");
      const apiKey = params.get("api_key");
      const apiBase = params.get("api_base");
      if (!isValidOrg(org)) {
        respond(res, 400, "error", "Invalid organization in the callback.");
        return;
      }
      if (!isValidApiKey(apiKey)) {
        respond(res, 400, "error", "Invalid credential in the callback.");
        return;
      }
      if (!apiBase || !isAllowedApiBase(apiBase, options.allowedApiHosts)) {
        respond(
          res,
          400,
          "error",
          "The API host in the callback is not a StackGuardian host.",
        );
        return;
      }
      respond(
        res,
        200,
        "ok",
        "You can close this tab and return to the terminal.",
        () => {
          settle?.resolve({ org, apiKey, apiBase: normalizeApiBase(apiBase) });
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

/** Opens the URL with the platform opener; argv only, never a shell string. */
export function openUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [command, args]: [string, string[]] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["powershell", ["-NoProfile", "-Command", `Start-Process "${url}"`]]
          : ["xdg-open", [url]];
    try {
      const child = spawn(command, args, {
        stdio: "ignore",
        detached: process.platform !== "win32",
      });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export async function loginViaBrowser(
  options: LoginOptions,
): Promise<CallbackResult> {
  const state = generateState();
  const server = await startCallbackServer(state, {
    allowedApiHosts: options.allowedApiHosts,
  });
  const authUrl = cliConnectUrl(
    options.dashboardUrl,
    server.port,
    state,
    options.org,
  );
  options.onAuthUrl?.(authUrl);
  const open = options.openBrowser ?? openUrl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      server.close();
      reject(
        new LoginError(
          "timeout",
          `No response from the browser within ${Math.round(timeoutMs / 1000)}s.`,
        ),
      );
    }, timeoutMs);
  });
  try {
    await open(authUrl).catch(() => false);
    return await Promise.race([server.result, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
