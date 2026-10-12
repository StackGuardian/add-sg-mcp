import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

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
 * it is self-contained (no network), never includes the key and strips the
 * query from history.
 */
export function callbackHtml(kind: "ok" | "error", message: string): string {
  const title = kind === "ok" ? "Connected to StackGuardian" : "Not connected";
  const badge =
    kind === "ok"
      ? `<span class="status ok"><span class="dot"></span>Connected</span>`
      : `<span class="status err"><span class="dot"></span>Not connected</span>`;
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
</style></head>
<body><main>
<div class="brand">${LOGO_MARK}<span>StackGuardian</span></div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${badge}
</main>
<script>try{history.replaceState(null,"","/done")}catch(e){}</script>
</body></html>
`;
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
