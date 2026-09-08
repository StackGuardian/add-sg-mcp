# add-sg-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `add-mcp` fork into `add-sg-mcp`: one command that logs in through the StackGuardian dashboard, picks an org, receives the org API key on a loopback callback, writes the StackGuardian MCP server into every selected coding agent and installs the StackGuardian skills.

**Architecture:** All StackGuardian logic lives in `src/sg/*` (preset, credentials, loopback auth, skills, commands); upstream's agent table, installer and config writers stay untouched. `src/index.ts` only registers the new commands and lets `main()` return what it installed so the skills step can follow it. The dashboard gains one page, `/orchestrator/cli-connect`, that mints the credential and redirects to `http://127.0.0.1:<port>/callback`.

**Tech Stack:** TypeScript (ESM, tsup), Commander 13, @clack/prompts, node:http/crypto/fs, hand-rolled `node:assert` tests run with tsx; dashboard: React 18 + Cloudscape + jest/RTL.

**Spec:** `docs/superpowers/specs/2026-09-08-sg-mcp-installer-design.md`

## Global Constraints

- Package name `add-sg-mcp`, bin `add-sg-mcp`, version `0.1.0`, Node `>=18`, no new runtime dependencies.
- Server entry name `stackguardian`; URL `https://<api-host>/api/v1/orgs/<org>/mcp/` (trailing slash); header `Authorization: apikey <key>`.
- Default scope is global; `--project` opts into project scope and implies `--gitignore`.
- `api_base` accepted only when `https:` and hostname ends with `.stackguardian.io` (or matches `--dashboard-url`'s host for custom envs).
- Org rule `^[A-Za-z0-9_-]{1,128}$`; state rule `^[A-Za-z0-9_-]{16,128}$`; port 1024–65535.
- Credentials at `$XDG_CONFIG_HOME/add-sg-mcp/credentials.json`, dir `0700`, file `0600`; the key is never printed unmasked.
- Skills: `sg-create-workflow`, `sg-update-workflow`, `sg-upgrade-workflow`; canonical `~/.agents/skills` / `.agents/skills`; symlink into agent dirs, copy fallback.
- Excluded agents for the preset: `claude-desktop`, `fx`.
- Tests: house style (`#!/usr/bin/env tsx`, `node:assert`, `test()` helper, temp dirs, no mocks); every new test file is added to `package.json` `test`, `test:unit`/`test:e2e`.
- Upstream files `src/agents.ts`, `src/installer.ts`, `src/formats/*`, `src/schema.ts`, `src/reader.ts`, `src/opencode-config.ts`, `src/source-parser.ts`, `src/template.ts` are not modified.

---

### Task 1: Slim and rename the fork

**Files:**
- Modify: `package.json` (name, bin, description, repository, scripts, files), `src/index.ts` (drop find/search/list/sync + `[target]`, banner), `src/config.ts` (`CONFIG_DIR`, drop find registries), `src/lib.ts` (drop find exports), `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `tests/config.test.ts`, `tests/e2e/cli.test.ts`, `tests/lib.test.ts`
- Delete: `src/find.ts`, `tests/find.test.ts`, `registry.json`, `registry.overlay.json`, `registry/`, `web/`, `scripts/`, `.github/workflows/registry-ci.yml`

**Interfaces:**
- Produces: `main(target, options)` now returns `Promise<InstallOutcome | undefined>` where `InstallOutcome = { serverName: string; targetAgents: AgentType[]; routing: Map<AgentType, InstallScope>; results: Map<AgentType, InstallResult> }`; `Options` gains `local?: boolean` (route every agent to project scope without prompting). Both exported from `src/index.ts` is not possible (it is the bin), so `main` moves nothing: Task 7 imports it via a new `export` on the function.

- [ ] Delete the registry/website/find code and the workflows step; remove `find`/`search`/`list`/`sync` commands and `[target]`; keep `list-agents` and `remove`.
- [ ] `src/config.ts`: `CONFIG_DIR = "add-sg-mcp"`; delete `FindRegistryConfigEntry`, `DEFAULT_FIND_REGISTRY_*`, `LEGACY_FIND_REGISTRY_*`, `migrateFindRegistryEntry`, `findRegistries` field and its getters/setters.
- [ ] `tests/config.test.ts`: replace the four `"add-mcp"` path segments with `"add-sg-mcp"`; delete find-registry tests. `tests/e2e/cli.test.ts`: delete `seedFindRegistries` and the three `find` tests (network). `tests/lib.test.ts`: delete find assertions if any.
- [ ] `package.json`: `"name": "add-sg-mcp"`, `"bin": {"add-sg-mcp": "dist/index.js"}`, `"version": "0.1.0"`, `"files": ["dist","skills","README.md"]`, remove `registry:*` scripts and `tests/find.test.ts` from `test`/`test:unit`, repository/homepage/bugs → `StackGuardian/add-sg-mcp`.
- [ ] `src/index.ts`: `.name("add-sg-mcp")`, description "Connect your coding agents to StackGuardian (MCP server + skills)"; replace `showLogo()` body with a two-line banner (`StackGuardian` + `add-sg-mcp v<version>`); delete the `!target` banner block; add `local?: boolean` to `Options` and, in the scope block, `if (options.local) { route all "local" } else if (options.global) {…}`; make `main` return `{ serverName, targetAgents, routing: agentRouting, results }` on every exit path after install; `export { main }`.
- [ ] Run: `bun run typecheck && bun run test:unit && bun run test:e2e` → all green (agent-count canary 22 untouched).
- [ ] Commit: `chore: rename fork to add-sg-mcp and drop the registry/find surface`.

### Task 2: `src/sg/preset.ts`

**Files:**
- Create: `src/sg/preset.ts`, `tests/sg-preset.test.ts`

**Interfaces (produces):**
```ts
export const SG_SERVER_NAME = "stackguardian";
export type SgEnvironment = { id: "eu" | "us" | "qa"; label: string; dashboardUrl: string; apiBase: string };
export const SG_ENVIRONMENTS: readonly SgEnvironment[];          // eu, us, qa
export function environmentForRegion(region: string): SgEnvironment | undefined; // "eu"|"us"|"qa"
export function isValidOrg(org: unknown): org is string;          // ^[A-Za-z0-9_-]{1,128}$
export function isValidState(state: unknown): state is string;    // ^[A-Za-z0-9_-]{16,128}$
export function normalizeApiBase(raw: string): string;            // trims, strips trailing "/", appends "/api/v1" when missing
export function isAllowedApiBase(apiBase: string, extraHosts?: string[]): boolean; // https + host endsWith .stackguardian.io | in extraHosts
export function buildMcpUrl(apiBase: string, org: string): string; // `${normalizeApiBase(apiBase)}/orgs/${org}/mcp/`
export function buildAuthHeader(apiKey: string): string;          // `Authorization: apikey ${apiKey}`
export function maskKey(key: string): string;                     // "sgu_…" + last 4
export const PRESET_EXCLUDED_AGENTS: readonly AgentType[];        // ["claude-desktop","fx"]
export function cliConnectUrl(dashboardUrl: string, port: number, state: string, org?: string): string;
```
- [ ] Write `tests/sg-preset.test.ts`: URL for eu/us/qa, trailing slash, `normalizeApiBase("https://api.app.stackguardian.io")` → `…/api/v1`, `isAllowedApiBase` rejects http, rejects `stackguardian.io.evil.com`, accepts `https://api.us.stackguardian.io/api/v1`, accepts extra host, org/state validation matrix, `maskKey("sgu_abcdefgh1234")` → `sgu_…1234`, `cliConnectUrl` encodes params and includes `client=add-sg-mcp&v=1`.
- [ ] Run → fails (module missing). Implement. Run → passes. Add to `test`/`test:unit`. Commit `feat(sg): preset URL, header and validation helpers`.

### Task 3: `src/sg/credentials.ts`

**Files:**
- Create: `src/sg/credentials.ts`, `tests/sg-credentials.test.ts`

**Interfaces (produces):**
```ts
export interface SgCredentials { apiBase: string; dashboardUrl: string; org: string; apiKey: string; obtainedAt: string }
export function getCredentialsPath(): string;                     // join(XDG_CONFIG_HOME|~/.config, "add-sg-mcp", "credentials.json")
export function readCredentials(): SgCredentials | null;          // null when missing/unparsable/wrong version
export function writeCredentials(c: SgCredentials): string;       // mkdir 0700, write 0600, returns path
export function deleteCredentials(): boolean;                     // true when a file was removed
```
- [ ] Tests (set `XDG_CONFIG_HOME` to a temp dir in-process; the path resolves lazily): round-trip, file mode `0o600` and dir `0o700` (skip mode asserts on win32), unparsable → null, delete returns true/false.
- [ ] Implement with `node:fs` sync APIs (`mkdirSync(dir,{recursive:true,mode:0o700})`, `writeFileSync(path, json, {mode:0o600})`, `chmodSync(path,0o600)`).
- [ ] Commit `feat(sg): credential store`.

### Task 4: `src/sg/auth.ts` — loopback login

**Files:**
- Create: `src/sg/auth.ts`, `tests/sg-auth.test.ts`

**Interfaces (produces):**
```ts
export interface LoginOptions {
  dashboardUrl: string;            // e.g. https://app.stackguardian.io
  org?: string;                    // preselect
  timeoutMs?: number;              // default 300_000
  openBrowser?: (url: string) => Promise<boolean>; // default openUrl; false → caller prints URL
  onAuthUrl?: (url: string) => void;               // always called with the URL
  allowedApiHosts?: string[];      // extra hosts (custom --dashboard-url)
}
export interface CallbackResult { org: string; apiKey: string; apiBase: string }
export function loginViaBrowser(opts: LoginOptions): Promise<CallbackResult>; // rejects Error("cancelled") | Error("timeout")
export function startCallbackServer(state: string, allowedApiHosts: string[]): Promise<{ port: number; result: Promise<CallbackResult>; close(): void }>;
export function openUrl(url: string): Promise<boolean>;            // spawn open|xdg-open|cmd /c start, argv only
export function callbackHtml(kind: "ok" | "error", message: string): string; // page with history.replaceState, no key
```
Callback handling in `startCallbackServer`: only `GET /callback`; parse with `new URL(req.url, "http://127.0.0.1")`; `error=access_denied` → 200 page "Cancelled" and reject `cancelled`; state mismatch / invalid org / invalid key (`^[A-Za-z0-9_.-]{16,512}$`) / disallowed api_base → `400` page, keep listening; valid → `200` page, resolve, `close()`. Listen on `127.0.0.1` port `0`.
- [ ] Tests with real `http.get` against the server: valid → resolves and second request gets connection refused; wrong state → 400 and still listening; bad api_base → 400; `error=access_denied` → rejects "cancelled"; `loginViaBrowser` with `openBrowser: async () => false` and `timeoutMs: 200` rejects "timeout"; `callbackHtml` never contains `sgu_`.
- [ ] Implement; commit `feat(sg): loopback browser login`.

### Task 5: `src/sg/skills.ts`

**Files:**
- Create: `src/sg/skills.ts`, `tests/sg-skills.test.ts`

**Interfaces (produces):**
```ts
export const SG_SKILL_NAMES = ["sg-create-workflow","sg-update-workflow","sg-upgrade-workflow"] as const;
export function bundledSkillsDir(): string;            // resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills") with src/dist fallback
export function canonicalSkillsDir(scope: InstallScope, cwd: string, home?: string): string; // ~/.agents/skills | <cwd>/.agents/skills
export function agentSkillsDir(agent: AgentType, scope: InstallScope, cwd: string, home?: string): string | undefined; // table from spec §8
export interface SkillInstallResult { agent: AgentType; skill: string; canonicalPath: string; linkPath?: string; mode: "symlink" | "copy" | "canonical-only"; error?: string }
export function installSkills(agents: AgentType[], scope: InstallScope, cwd: string, home?: string): SkillInstallResult[];
export function removeSkills(agents: AgentType[], scope: InstallScope, cwd: string, home?: string): { removed: string[]; errors: string[] };
export function installedSkillAgents(scope: InstallScope, cwd: string, home?: string): Map<AgentType, string[]>; // for status
```
Manifest: `join(configDir, "skills.json")` = `{ version: 1, entries: [{ agent, scope, cwd, skill, canonicalPath, linkPath, mode }] }`; `removeSkills` only deletes paths recorded there (and the canonical copy when no other entry references it).
- [ ] Tests with temp `home` + temp `cwd`: install for `claude-code`+`codex` global → canonical dirs exist with `SKILL.md`, `~/.claude/skills/sg-create-workflow` is a symlink pointing (relatively) at the canonical dir, `~/.codex/skills/...` too; `cline` global → `canonical-only`; rerun idempotent; project scope for `claude-code` → `.agents/skills` + `.claude/skills` link; `removeSkills` deletes links + canonical, leaves a foreign skill untouched; copy fallback exercised by forcing `symlinkSync` failure via an injected `linkFn` option (keep an optional 5th param `deps?: { symlink?: typeof symlinkSync }`).
- [ ] Implement; commit `feat(sg): skills installer`.

### Task 6: Bundle the skills

**Files:**
- Create: `skills/sg-create-workflow/SKILL.md`, `skills/sg-update-workflow/SKILL.md`, `skills/sg-upgrade-workflow/SKILL.md`, `skills/README.md`
- Source: `~/Desktop/open-source/sg-mcp-clickhouse/.claude/skills/{create-workflow,update-workflow,upgrade-workflow}/SKILL.md`

- [ ] Copy each file; set `name:` to the prefixed name; replace textual cross-references (`create-workflow` skill → `sg-create-workflow`, etc.) with a `sed` pass and review by grep that no bare old name remains.
- [ ] `skills/README.md`: provenance + "edit here, then sync to the MCP repo" note.
- [ ] Add a test in `tests/sg-skills.test.ts` that every `SG_SKILL_NAMES` entry has a `SKILL.md` whose frontmatter `name` equals the directory name.
- [ ] Commit `feat(sg): bundle the workflow skills`.

### Task 7: Commands and wiring

**Files:**
- Create: `src/sg/commands.ts`, `tests/e2e/sg-cli.test.ts`
- Modify: `src/index.ts` (register commands), `src/lib.ts` (export `SG_SERVER_NAME`, `buildMcpUrl`, `installSkills`, `removeSkills`)

**Interfaces:**
```ts
export interface SgAuthOptions { region?: string; env?: string; dashboardUrl?: string; org?: string; token?: string; apiBase?: string; browser?: boolean; timeout?: string }
export async function resolveCredentials(opts: SgAuthOptions, interactive: boolean): Promise<SgCredentials>;
// order: --token/SG_API_KEY (+ --org/SG_ORG + --api-base/SG_API_BASE or env) → stored credentials (unless --org differs) → browser login
export async function runConnect(opts: SgAuthOptions & ConnectOptions): Promise<void>; // default command
export async function runLogin(opts: SgAuthOptions): Promise<void>;
export async function runLogout(opts: { purge?: boolean; agent?: string[]; all?: boolean; project?: boolean }): Promise<void>;
export async function runStatus(): Promise<void>;
export async function runRemove(opts: { agent?: string[]; all?: boolean; project?: boolean; yes?: boolean; name?: string }): Promise<void>;
```
`runConnect`: banner → `resolveCredentials` → `main(buildMcpUrl(apiBase, org), { ...install options, name, transport: "http", header: [buildAuthHeader(key)], global: !project, local: project, gitignore: project || gitignore, agent: agents minus PRESET_EXCLUDED_AGENTS (with an info line when filtered) })` → if outcome and `!skipSkills`: `installSkills(successful agents, scope from routing, cwd)` → `p.note` per agent (`✓ Claude Code: 3 skills → ~/.claude/skills`) → next-steps note (restart agent / Claude Code `/mcp`). `--auth oauth`: skip credentials, prompt/flag org + region, header omitted, agents filtered to the OAuth-capable list.
- [ ] `src/index.ts`: default action → `runConnect`; `login`, `logout`, `status`, `remove` (replaces upstream remove: query defaults to `stackguardian`, also `removeSkills`), keep `list-agents`. Each subcommand merges `extractSubcommandOptionsFromArgv()`.
- [ ] e2e tests (subprocess with sandbox HOME, `--token sgu_testtesttest1234 --org demo-org --api-base https://api.app.stackguardian.io/api/v1 -y --all`): claude-code `~/.claude.json` has `mcpServers.stackguardian.url` ending `/orgs/demo-org/mcp/` and header `apikey sgu_…`; codex `config.toml` has `[mcp_servers.stackguardian.http_headers]`; cursor, vscode, gemini, opencode, copilot, kiro, zed, windsurf files exist with the URL; `~/.config/add-sg-mcp/credentials.json` mode 0600; skills linked in `~/.claude/skills`; `status` prints masked key and lists agents; `remove -y --all` empties entries and links; `logout --purge`; `--project` writes `.mcp.json` + `.gitignore`; `--help` mentions add-sg-mcp; bad `--api-base http://…` exits 1; excluded agent `-a fx` exits with the message.
- [ ] Commit `feat(sg): connect, login, logout, status, remove commands`.

### Task 8: Docs and release metadata

**Files:** `README.md`, `CHANGELOG.md`, `docs/RELEASING.md`, `AGENTS.md`, `NOTICE`
- [ ] README: what it does, `npx add-sg-mcp`, options table, headless/CI, per-agent notes (Codex comments, Claude Desktop/fx exclusions), skills, security notes, uninstall.
- [ ] CHANGELOG: `0.1.0` entry. RELEASING: Trusted Publisher re-binding to `StackGuardian/add-sg-mcp`. AGENTS.md: update project description + module map. NOTICE: Apache-2.0 attribution to neon-solutions/add-mcp.
- [ ] Commit `docs: add-sg-mcp README, changelog, releasing`.

### Task 9: Dashboard page

**Repo:** `~/Desktop/projects/dashboard`, branch `feat/cli-connect` from `origin/develop`.
**Files:**
- Create: `src/views/CliConnect/CliConnect.tsx`, `src/views/CliConnect/CliConnect.test.tsx`, `src/views/CliConnect/types.ts`, `src/views/CliConnect/callbackUrl.ts`, `src/views/CliConnect/callbackUrl.test.ts`, `.changeset/cli-connect.md`
- Modify: `src/routes.jsx` (after `terraform-login`), `src/utils/sidebar.ts#shouldHideSidebarForRoute`

`callbackUrl.ts`:
```ts
export const parseCliConnectParams = (search: string): { ok: true; port: number; state: string; client: string } | { ok: false; reason: string };
export const buildCallbackUrl = (port: number, params: Record<string, string>): string; // http://127.0.0.1:<port>/callback?…
export const manualLoginCommand = (apiKey: string, org: string, apiBase: string): string;
```
`CliConnect.tsx`: mirrors `TerraformLogin` (Cloudscape `Container`/`Select`/`Alert`/`Button`/`CopyToClipboard`), `useRoleBindings` for the SSO rule, `organizationServices.OrgApiKey(org, { regenerate: false })`, `getApiEndpointForCurrentRegion()`, states per spec §5.1.
- [ ] Tests (`jest`, mocks as in `TerraformLogin.test.tsx`): invalid params → error alert and no `OrgApiKey` call; org picker from string orgs; Connect → `OrgApiKey` called with `{regenerate:false}` and `window.location.assign` called with `http://127.0.0.1:51234/callback?…state=…&org=…&api_key=…&api_base=…`; Cancel → `…error=access_denied`; SSO-without-rolebindings → link alert; fallback panel present after Connect.
- [ ] `pnpm eslint`, `pnpm typecheck`, `pnpm test -- src/views/CliConnect` green; changeset; commit `feat(cli): /orchestrator/cli-connect page for the add-sg-mcp installer`; push; open PR to `develop`.

### Task 10: Verification and review

- [ ] `bun run fmt && bun run build && bun run typecheck && bun run test` green in add-sg-mcp; `bun run fallow -- --summary` reviewed.
- [ ] Real run on this machine: `HOME=<tmp> XDG_CONFIG_HOME=<tmp>/.config bun run dev -- --token … --org … --api-base … -y --all` (sandboxed), then a browser run with `--dashboard-url http://localhost:3000` against the dashboard dev server on the feature branch.
- [ ] Code review pass (code-reviewer / typescript-reviewer on the diff); fix findings.
- [ ] Push `feat/sg-installer`; open PR to `main`.
