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
  apiKey: string;
  obtainedAt: string;
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
  "apiKey",
  "obtainedAt",
];

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
  for (const field of FIELDS) {
    if (typeof current[field] !== "string" || current[field].length === 0) {
      return null;
    }
  }
  return {
    apiBase: current.apiBase,
    dashboardUrl: current.dashboardUrl,
    org: current.org,
    apiKey: current.apiKey,
    obtainedAt: current.obtainedAt,
  };
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
