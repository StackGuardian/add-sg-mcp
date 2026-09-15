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
  /** Where the landing pages link back to, so Cancel never strands the user on a loopback page. */
  dashboardUrl?: string;
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
const MAX_FORM_BYTES = 64 * 1024;

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

const LOGO_MARK =
  `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<path d="M40 20C40 8.9543 31.0457 0 20 0C8.9543 0 0 8.9543 0 20C0 31.0457 8.9543 40 20 40C31.0457 40 40 31.0457 40 20Z" fill="#1B71EC"/>` +
  `<path fill-rule="evenodd" clip-rule="evenodd" d="M6.66663 19.9998C6.66663 12.6361 12.6362 6.6665 20 6.6665C27.3637 6.6665 33.3333 12.6361 33.3333 19.9998C33.3333 27.3636 27.3637 33.3332 20 33.3332C12.6362 33.3332 6.66663 27.3636 6.66663 19.9998Z" stroke="white" stroke-width="1.85185"/>` +
  `<path fill-rule="evenodd" clip-rule="evenodd" d="M13.3333 20.0002C13.3333 16.3182 16.318 13.3335 19.9999 13.3335C23.6818 13.3335 26.6666 16.3182 26.6666 20.0002C26.6666 23.6821 23.6818 26.6668 19.9999 26.6668C16.318 26.6668 13.3333 23.6821 13.3333 20.0002Z" stroke="white" stroke-width="2.59259"/>` +
  `</svg>`;

/**
 * The page the browser lands on. Styled with the StackGuardian design-system
 * tokens (Inter, #1b71ec primary, 10px radius) so it reads like the dashboard;
 * it is self-contained (no network), never includes the key, strips the query
 * from history, and links back to the dashboard when one is known.
 */
export function callbackHtml(
  kind: "ok" | "error",
  message: string,
  backUrl?: string,
): string {
  const title = kind === "ok" ? "Connected to StackGuardian" : "Not connected";
  const badge =
    kind === "ok"
      ? `<span class="status ok"><span class="dot"></span>Connected</span>`
      : `<span class="status err"><span class="dot"></span>Not connected</span>`;
  const back = backUrl
    ? `<a class="back" href="${escapeHtml(backUrl)}">Back to StackGuardian</a>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{--background:#ffffff;--foreground:#0a0a0a;--card:#ffffff;--primary:#1b71ec;--muted:#f5f5f5;--muted-foreground:#737373;--border:#e5e5e5;--success:#f0fdf4;--success-foreground:#14532d;--success-accent:#16a34a;--success-border:#bbf7d0;--destructive:#dc2626;--warning:#fffbeb;--warning-foreground:#78350f;--warning-accent:#d97706;--warning-border:#fde68a;--radius:0.625rem}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--muted);color:var(--foreground);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:28rem;margin:1.5rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:2rem}
.brand{display:flex;align-items:center;gap:.625rem;margin-bottom:1.5rem}
.brand svg{width:2rem;height:2rem}
.brand span{font-size:1.125rem;font-weight:600;letter-spacing:-.01em}
h1{font-size:1.25rem;font-weight:600;line-height:1.3;margin:0 0 .5rem}
p{margin:0;color:var(--muted-foreground)}
.status{display:inline-flex;align-items:center;gap:.5rem;margin-top:1.25rem;padding:.25rem .625rem;border-radius:999px;font-size:.75rem;font-weight:500;border:1px solid}
.status .dot{width:.5rem;height:.5rem;border-radius:999px}
.status.ok{background:var(--success);color:var(--success-foreground);border-color:var(--success-border)}
.status.ok .dot{background:var(--success-accent)}
.status.err{background:var(--warning);color:var(--warning-foreground);border-color:var(--warning-border)}
.status.err .dot{background:var(--warning-accent)}
.back{display:inline-block;margin-top:1.25rem;margin-left:.75rem;font-size:.875rem;color:var(--primary);text-decoration:none}
.back:hover{text-decoration:underline}
</style></head>
<body><main>
<div class="brand">${LOGO_MARK}<span>StackGuardian</span></div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${badge}${back}
</main>
<script>try{history.replaceState(null,"","/done")}catch(e){}</script>
</body></html>
`;
}

function respond(
  res: http.ServerResponse,
  status: number,
  kind: "ok" | "error",
  message: string,
  backUrl?: string,
  onFlushed?: () => void,
): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(callbackHtml(kind, message, backUrl), onFlushed);
}

/**
 * The callback arrives as a form POST (preferred: the key stays out of the
 * browser history and of any request log) or as a GET (manual use).
 */
function readParams(
  req: http.IncomingMessage,
): Promise<URLSearchParams | null> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET") return Promise.resolve(url.searchParams);
  if (req.method !== "POST") return Promise.resolve(null);
  return new Promise((resolve) => {
    let body = "";
    let settled = false;
    const done = (value: URLSearchParams | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_FORM_BYTES) {
        req.destroy();
        done(null);
      }
    });
    req.on("end", () => done(new URLSearchParams(body)));
    req.on("error", () => done(null));
  });
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
    const back = options.dashboardUrl;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (
        url.pathname !== "/callback" ||
        (req.method !== "GET" && req.method !== "POST")
      ) {
        respond(res, 404, "error", "Not found.", back);
        return;
      }
      void readParams(req).then((params) => {
        if (!params) {
          respond(res, 400, "error", "Could not read the callback.", back);
          return;
        }
        if (params.get("state") !== state) {
          respond(
            res,
            400,
            "error",
            "This link does not match the terminal session. Start again from the terminal.",
            back,
          );
          return;
        }
        const error = params.get("error");
        if (error) {
          respond(
            res,
            200,
            "error",
            "Cancelled. You can close this tab.",
            back,
            () => {
              settle?.reject(
                new LoginError(
                  "cancelled",
                  `Cancelled in the browser (${error})`,
                ),
              );
              close();
            },
          );
          return;
        }
        const org = params.get("org");
        const apiKey = params.get("api_key");
        const apiBase = params.get("api_base");
        if (!isValidOrg(org)) {
          respond(
            res,
            400,
            "error",
            "Invalid organization in the callback.",
            back,
          );
          return;
        }
        if (!isValidApiKey(apiKey)) {
          respond(
            res,
            400,
            "error",
            "Invalid credential in the callback.",
            back,
          );
          return;
        }
        if (!apiBase || !isAllowedApiBase(apiBase, options.allowedApiHosts)) {
          respond(
            res,
            400,
            "error",
            "The API host in the callback is not a StackGuardian host.",
            back,
          );
          return;
        }
        respond(
          res,
          200,
          "ok",
          "You can close this tab and return to the terminal.",
          back,
          () => {
            settle?.resolve({
              org,
              apiKey,
              apiBase: normalizeApiBase(apiBase),
            });
            close();
          },
        );
      });
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
    dashboardUrl: options.dashboardUrl,
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
