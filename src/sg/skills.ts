import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentType } from "../types.js";
import type { InstallScope } from "../agents.js";
import { getConfigDir } from "./credentials.js";

export const SG_SKILL_NAMES = [
  "sg-create-workflow",
  "sg-update-workflow",
  "sg-upgrade-workflow",
] as const;
export type SgSkillName = (typeof SG_SKILL_NAMES)[number];

const MANIFEST_FILE = "skills.json";
const MANIFEST_VERSION = 1;

/** `skills/` ships in the npm package next to `dist/`; from `src/sg/` it is two levels up. */
export function bundledSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, "..", "..", "skills"),
    resolve(here, "..", "skills"),
  ]) {
    if (existsSync(join(candidate, SG_SKILL_NAMES[0], "SKILL.md"))) {
      return candidate;
    }
  }
  throw new Error("Bundled skills directory not found");
}

type DirSpec = {
  global: (home: string) => string;
  local: (cwd: string) => string;
};

const canonicalGlobal = (home: string) => join(home, ".agents", "skills");
const canonicalLocal = (cwd: string) => join(cwd, ".agents", "skills");
const CANONICAL: DirSpec = { global: canonicalGlobal, local: canonicalLocal };

/**
 * Where each agent looks for skills (spec §8). Agents missing here have no
 * skills concept and are skipped.
 */
const AGENT_SKILL_DIRS: Partial<Record<AgentType, DirSpec>> = {
  "claude-code": {
    global: (h) => join(h, ".claude", "skills"),
    local: (c) => join(c, ".claude", "skills"),
  },
  codex: {
    global: (h) => join(process.env.CODEX_HOME || join(h, ".codex"), "skills"),
    local: canonicalLocal,
  },
  cursor: {
    global: (h) => join(h, ".cursor", "skills"),
    local: canonicalLocal,
  },
  "gemini-cli": {
    global: (h) => join(h, ".gemini", "skills"),
    local: canonicalLocal,
  },
  vscode: {
    global: (h) => join(h, ".copilot", "skills"),
    local: canonicalLocal,
  },
  "github-copilot-cli": {
    global: (h) => join(h, ".copilot", "skills"),
    local: canonicalLocal,
  },
  opencode: {
    global: (h) => join(h, ".config", "opencode", "skills"),
    local: canonicalLocal,
  },
  "kilo-code": {
    global: (h) => join(h, ".kilo", "skills"),
    local: canonicalLocal,
  },
  cline: CANONICAL,
  "cline-cli": CANONICAL,
  "kimi-code": CANONICAL,
  zed: CANONICAL,
  windsurf: {
    global: (h) => join(h, ".codeium", "windsurf", "skills"),
    local: (c) => join(c, ".windsurf", "skills"),
  },
  antigravity: {
    global: (h) => join(h, ".gemini", "antigravity", "skills"),
    local: canonicalLocal,
  },
  goose: {
    global: (h) => join(h, ".config", "goose", "skills"),
    local: (c) => join(c, ".goose", "skills"),
  },
  "grok-build": {
    global: (h) => join(process.env.GROK_HOME || join(h, ".grok"), "skills"),
    local: (c) => join(c, ".grok", "skills"),
  },
  "kiro-cli": {
    global: (h) => join(h, ".kiro", "skills"),
    local: (c) => join(c, ".kiro", "skills"),
  },
  pi: {
    global: (h) =>
      join(
        process.env.PI_CODING_AGENT_DIR || join(h, ".pi", "agent"),
        "skills",
      ),
    local: (c) => join(c, ".pi", "skills"),
  },
};

export function canonicalSkillsDir(
  scope: InstallScope,
  cwd: string,
  home: string = homedir(),
): string {
  return scope === "global" ? canonicalGlobal(home) : canonicalLocal(cwd);
}

export function agentSkillsDir(
  agent: AgentType,
  scope: InstallScope,
  cwd: string,
  home: string = homedir(),
): string | undefined {
  const spec = AGENT_SKILL_DIRS[agent];
  if (!spec) return undefined;
  return scope === "global" ? spec.global(home) : spec.local(cwd);
}

export type SkillInstallMode =
  | "symlink"
  | "copy"
  | "canonical-only"
  | "skipped";

export interface SkillInstallResult {
  agent: AgentType;
  skill: SgSkillName;
  canonicalPath: string;
  linkPath?: string;
  mode: SkillInstallMode;
  error?: string;
}

export interface SkillsOptions {
  home?: string;
  /** Injectable for tests; a throwing implementation exercises the copy fallback. */
  symlink?: typeof symlinkSync;
  manifestPath?: string;
}

interface ManifestEntry {
  agent: AgentType;
  scope: InstallScope;
  cwd: string;
  skill: string;
  canonicalPath: string;
  linkPath?: string;
  mode: SkillInstallMode;
}

interface Manifest {
  version: number;
  entries: ManifestEntry[];
}

function manifestPathFor(options: SkillsOptions): string {
  return options.manifestPath ?? join(getConfigDir(), MANIFEST_FILE);
}

function readManifest(path: string): ManifestEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
    return parsed.version === MANIFEST_VERSION && Array.isArray(parsed.entries)
      ? parsed.entries
      : [];
  } catch {
    return [];
  }
}

function writeManifest(path: string, entries: ManifestEntry[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const manifest: Manifest = { version: MANIFEST_VERSION, entries };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function sameEntry(a: ManifestEntry, b: ManifestEntry): boolean {
  return (
    a.agent === b.agent &&
    a.scope === b.scope &&
    a.cwd === b.cwd &&
    a.skill === b.skill
  );
}

function upsertEntry(entries: ManifestEntry[], entry: ManifestEntry): void {
  const index = entries.findIndex((e) => sameEntry(e, entry));
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
}

function skillNameIn(path: string): string | null {
  try {
    const head = readFileSync(join(path, "SKILL.md"), "utf-8").slice(0, 2048);
    const match = head.match(/^---\r?\n(?:[\s\S]*?\n)?name:\s*([^\r\n]+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** A path is ours when it is a symlink, recorded in the manifest, or an sg-* skill by frontmatter. */
function isOurs(
  path: string,
  skill: string,
  entries: ManifestEntry[],
): boolean {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink()) return true;
  if (!stat.isDirectory()) return false;
  if (
    entries.some(
      (e) =>
        e.skill === skill && (e.canonicalPath === path || e.linkPath === path),
    )
  ) {
    return true;
  }
  return skillNameIn(path) === skill;
}

function removePath(path: string): void {
  if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
  else rmSync(path, { recursive: true, force: true });
}

function refreshCanonical(
  source: string,
  canonicalPath: string,
  skill: string,
  entries: ManifestEntry[],
): void {
  if (existsSync(canonicalPath) || isSymlink(canonicalPath)) {
    if (!isOurs(canonicalPath, skill, entries)) {
      throw new Error(
        `${canonicalPath} exists and was not installed by add-sg-mcp; remove it first`,
      );
    }
    removePath(canonicalPath);
  }
  mkdirSync(dirname(canonicalPath), { recursive: true });
  cpSync(source, canonicalPath, { recursive: true });
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function placeLink(
  canonicalPath: string,
  linkPath: string,
  skill: string,
  entries: ManifestEntry[],
  symlink: typeof symlinkSync,
): "symlink" | "copy" {
  mkdirSync(dirname(linkPath), { recursive: true });
  if (existsSync(linkPath) || isSymlink(linkPath)) {
    if (!isOurs(linkPath, skill, entries)) {
      throw new Error(
        `${linkPath} exists and was not installed by add-sg-mcp; remove it first`,
      );
    }
    removePath(linkPath);
  }
  try {
    symlink(relative(dirname(linkPath), canonicalPath), linkPath, "dir");
    return "symlink";
  } catch {
    cpSync(canonicalPath, linkPath, { recursive: true });
    return "copy";
  }
}

export function installSkills(
  agentList: AgentType[],
  scope: InstallScope,
  cwd: string,
  options: SkillsOptions = {},
): SkillInstallResult[] {
  const home = options.home ?? homedir();
  const symlink = options.symlink ?? symlinkSync;
  const manifestPath = manifestPathFor(options);
  const entries = readManifest(manifestPath);
  const bundled = bundledSkillsDir();
  const canonicalDir = canonicalSkillsDir(scope, cwd, home);
  const refreshed = new Set<string>();
  const results: SkillInstallResult[] = [];

  for (const agent of agentList) {
    const agentDir = agentSkillsDir(agent, scope, cwd, home);
    for (const skill of SG_SKILL_NAMES) {
      const canonicalPath = join(canonicalDir, skill);
      if (!agentDir) {
        results.push({ agent, skill, canonicalPath, mode: "skipped" });
        continue;
      }
      const usesCanonical = resolve(agentDir) === resolve(canonicalDir);
      const linkPath = usesCanonical ? undefined : join(agentDir, skill);
      try {
        if (!refreshed.has(canonicalPath)) {
          refreshCanonical(join(bundled, skill), canonicalPath, skill, entries);
          refreshed.add(canonicalPath);
        }
        const mode: SkillInstallMode = linkPath
          ? placeLink(canonicalPath, linkPath, skill, entries, symlink)
          : "canonical-only";
        const entry: ManifestEntry = {
          agent,
          scope,
          cwd,
          skill,
          canonicalPath,
          mode,
        };
        if (linkPath) entry.linkPath = linkPath;
        upsertEntry(entries, entry);
        results.push({ agent, skill, canonicalPath, linkPath, mode });
      } catch (error) {
        results.push({
          agent,
          skill,
          canonicalPath,
          linkPath,
          mode: "skipped",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  writeManifest(manifestPath, entries);
  return results;
}

export interface SkillsRemoveResult {
  removed: string[];
  errors: string[];
}

export function removeSkills(
  agentList: AgentType[],
  scope: InstallScope,
  cwd: string,
  options: SkillsOptions = {},
): SkillsRemoveResult {
  const home = options.home ?? homedir();
  const manifestPath = manifestPathFor(options);
  let entries = readManifest(manifestPath);
  const canonicalDir = canonicalSkillsDir(scope, cwd, home);
  const removed: string[] = [];
  const errors: string[] = [];

  for (const agent of agentList) {
    const agentDir = agentSkillsDir(agent, scope, cwd, home);
    for (const skill of SG_SKILL_NAMES) {
      if (agentDir && resolve(agentDir) !== resolve(canonicalDir)) {
        const linkPath = join(agentDir, skill);
        if (
          (existsSync(linkPath) || isSymlink(linkPath)) &&
          isOurs(linkPath, skill, entries)
        ) {
          try {
            removePath(linkPath);
            removed.push(linkPath);
          } catch (error) {
            errors.push(
              `${linkPath}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      entries = entries.filter(
        (e) =>
          !(
            e.agent === agent &&
            e.scope === scope &&
            e.cwd === cwd &&
            e.skill === skill
          ),
      );
    }
  }

  for (const skill of SG_SKILL_NAMES) {
    const canonicalPath = join(canonicalDir, skill);
    const stillUsed = entries.some((e) => e.canonicalPath === canonicalPath);
    if (stillUsed) continue;
    if (
      (existsSync(canonicalPath) || isSymlink(canonicalPath)) &&
      isOurs(canonicalPath, skill, entries)
    ) {
      try {
        removePath(canonicalPath);
        removed.push(canonicalPath);
      } catch (error) {
        errors.push(
          `${canonicalPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  writeManifest(manifestPath, entries);
  return { removed, errors };
}

/** Which of our skills each agent can currently see. */
export function skillsStatus(
  agentList: AgentType[],
  scope: InstallScope,
  cwd: string,
  options: SkillsOptions = {},
): Map<AgentType, string[]> {
  const home = options.home ?? homedir();
  const status = new Map<AgentType, string[]>();
  for (const agent of agentList) {
    const agentDir = agentSkillsDir(agent, scope, cwd, home);
    if (!agentDir) {
      status.set(agent, []);
      continue;
    }
    status.set(
      agent,
      SG_SKILL_NAMES.filter((skill) =>
        existsSync(join(agentDir, skill, "SKILL.md")),
      ),
    );
  }
  return status;
}
