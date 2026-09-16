import type { AgentType } from "../types.js";
import type { SgCredentials } from "./credentials.js";

/** Prefix of the MCP server entry; the organization is appended so several orgs can coexist. */
export const SG_SERVER_NAME_PREFIX = "StackGuardian";
/** Entry name written before per-org naming; still recognised by status and remove. */
export const LEGACY_SG_SERVER_NAME = "stackguardian";

/**
 * `StackGuardian-<org>`. Letters, digits, hyphens and underscores only: agents such as
 * Claude Code reject anything else (server names feed the `mcp__<server>__<tool>` ids),
 * and organization names are slugs, so the result is always valid.
 */
export function serverNameForOrg(org: string): string {
  return `${SG_SERVER_NAME_PREFIX}-${org}`;
}

/** Whether a stored entry is ours: by either name generation, or by pointing at a StackGuardian MCP URL. */
export function isStackGuardianServer(name: string, url?: string): boolean {
  if (
    name === LEGACY_SG_SERVER_NAME ||
    name.startsWith(`${SG_SERVER_NAME_PREFIX}-`)
  ) {
    return true;
  }
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase().endsWith(".stackguardian.io") &&
      /\/orgs\/[^/]+\/mcp\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
/** `client` query parameter the dashboard shows on the connect page. */
export const SG_CLIENT_ID = "add-sg-mcp";
/** Dashboard route that mints the credential and redirects to the loopback callback. */
export const CLI_CONNECT_PATH = "/orchestrator/cli-connect";

export interface SgEnvironment {
  id: "eu" | "us" | "qa";
  label: string;
  dashboardUrl: string;
  apiBase: string;
}

export const SG_ENVIRONMENTS: readonly SgEnvironment[] = [
  {
    id: "eu",
    label: "Europe — app.stackguardian.io",
    dashboardUrl: "https://app.stackguardian.io",
    apiBase: "https://api.app.stackguardian.io/api/v1",
  },
  {
    id: "us",
    label: "United States — us.stackguardian.io",
    dashboardUrl: "https://us.stackguardian.io",
    apiBase: "https://api.us.stackguardian.io/api/v1",
  },
  {
    id: "qa",
    label: "QA — dash.qa.stackguardian.io",
    dashboardUrl: "https://dash.qa.stackguardian.io",
    apiBase: "https://testapi.qa.stackguardian.io/api/v1",
  },
];

export function environmentForRegion(
  region: string,
): SgEnvironment | undefined {
  const id = region.trim().toLowerCase();
  return SG_ENVIRONMENTS.find((env) => env.id === id);
}

/** Organization names are Django slugs on the platform. */
export const ORG_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const API_KEY_PATTERN = /^[A-Za-z0-9_.-]{16,512}$/;

export function isValidOrg(value: unknown): value is string {
  return typeof value === "string" && ORG_PATTERN.test(value);
}

export function isValidState(value: unknown): value is string {
  return typeof value === "string" && STATE_PATTERN.test(value);
}

export function isValidApiKey(value: unknown): value is string {
  return typeof value === "string" && API_KEY_PATTERN.test(value);
}

/** `https://host[/api/v1][/]` → `https://host/api/v1` */
export function normalizeApiBase(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (!/\/api\/v1$/.test(base)) {
    base = `${base}/api/v1`;
  }
  return base;
}

/**
 * The callback hands the CLI an API base chosen by the browser. Only
 * StackGuardian hosts are accepted so a tampered link cannot point the agents
 * (and their credential) at another server.
 */
export function isAllowedApiBase(
  apiBase: string,
  extraHosts: string[] = [],
): boolean {
  let url: URL;
  try {
    url = new URL(apiBase.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".stackguardian.io")) return true;
  return extraHosts.map((h) => h.toLowerCase()).includes(host);
}

export function buildMcpUrl(apiBase: string, org: string): string {
  return `${normalizeApiBase(apiBase)}/orgs/${encodeURIComponent(org)}/mcp/`;
}

export function buildAuthHeader(
  credentials: Pick<SgCredentials, "authType" | "apiKey" | "accessToken">,
): string {
  return credentials.authType === "grant"
    ? `Authorization: Bearer ${credentials.accessToken}`
    : `Authorization: apikey ${credentials.apiKey}`;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "…";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Agents that cannot carry the preset: Claude Desktop is stdio-only, fx only sends `Bearer`. */
export const PRESET_EXCLUDED_AGENTS: readonly AgentType[] = [
  "claude-desktop",
  "fx",
];

/** Agents that run the MCP OAuth flow themselves (`--auth oauth`). */
export const OAUTH_CAPABLE_AGENTS: readonly AgentType[] = [
  "claude-code",
  "vscode",
  "cursor",
  "codex",
  "gemini-cli",
  "windsurf",
];

export function cliConnectUrl(
  dashboardUrl: string,
  port: number,
  state: string,
  org?: string,
): string {
  const base = `${dashboardUrl.trim().replace(/\/+$/, "")}/`;
  const url = new URL(CLI_CONNECT_PATH, base);
  url.searchParams.set("port", String(port));
  url.searchParams.set("state", state);
  url.searchParams.set("client", SG_CLIENT_ID);
  url.searchParams.set("v", "1");
  if (org) url.searchParams.set("org", org);
  return url.toString();
}
