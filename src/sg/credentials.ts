import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = "add-sg-mcp";
const CREDENTIALS_FILE = "credentials.json";
const CURRENT_VERSION = 1;

export interface SgCredentials {
  apiBase: string;
  dashboardUrl: string;
  org: string;
  obtainedAt: string;
  /** `apikey` is the sgu_ key from the dashboard, `grant` the sgm_ token from the OAuth broker. */
  authType: "apikey" | "grant";
  /** Set for `apikey`. */
  apiKey?: string;
  /** Set for `grant`. */
  accessToken?: string;
  /** ISO expiry of a grant, or null when it never expires. */
  expiresAt?: string | null;
}

interface CredentialsFile {
  version: number;
  current: SgCredentials;
}

/** Resolved lazily so tests (and users) can point XDG_CONFIG_HOME elsewhere. */
export function getConfigDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    CONFIG_DIR,
  );
}

export function getCredentialsPath(): string {
  return join(getConfigDir(), CREDENTIALS_FILE);
}

const FIELDS: (keyof SgCredentials)[] = [
  "apiBase",
  "dashboardUrl",
  "org",
  "obtainedAt",
];

/**
 * True once a grant has passed its expiry; an expired credential counts as
 * absent. An expiry we cannot parse fails closed.
 */
export function isExpired(credentials: SgCredentials): boolean {
  if (!credentials.expiresAt) return false;
  const at = Date.parse(credentials.expiresAt);
  return !Number.isFinite(at) || at <= Date.now();
}

export function readCredentials(): SgCredentials | null {
  let parsed: CredentialsFile;
  try {
    parsed = JSON.parse(
      readFileSync(getCredentialsPath(), "utf-8"),
    ) as CredentialsFile;
  } catch {
    return null;
  }
  if (parsed?.version !== CURRENT_VERSION || !parsed.current) return null;
  const current = parsed.current;
  // Files written before grants existed carry no authType and hold an API key.
  const authType = current.authType === "grant" ? "grant" : "apikey";
  const secret = authType === "grant" ? current.accessToken : current.apiKey;
  if (typeof secret !== "string" || secret.length === 0) return null;
  for (const field of FIELDS) {
    const value = current[field];
    if (typeof value !== "string" || value.length === 0) return null;
  }
  const common = {
    apiBase: current.apiBase,
    dashboardUrl: current.dashboardUrl,
    org: current.org,
    obtainedAt: current.obtainedAt,
  };
  if (authType === "apikey") {
    return { ...common, authType, apiKey: secret };
  }
  const expiresAt = current.expiresAt ?? null;
  // An expiry we cannot read is not proof the grant is still good: refuse the file.
  if (expiresAt !== null && (typeof expiresAt !== "string" || !expiresAt)) {
    return null;
  }
  return { ...common, authType, accessToken: secret, expiresAt };
}

/** Writes the file with owner-only permissions; returns its path. */
export function writeCredentials(credentials: SgCredentials): string {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best effort (Windows).
  }
  const path = getCredentialsPath();
  const content: CredentialsFile = {
    version: CURRENT_VERSION,
    current: credentials,
  };
  // Write next to the target and rename so a crash never leaves a torn file.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(content, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Best effort: Windows has no POSIX modes; the profile folder ACL applies.
  }
  renameSync(tmp, path);
  return path;
}

export function deleteCredentials(): boolean {
  const path = getCredentialsPath();
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
