# add-sg-mcp — StackGuardian MCP + Skills installer

Date: 2026-09-08
Status: approved for implementation (autonomous session; see "Decisions")
Repo: `StackGuardian/add-sg-mcp` (fork of `neon-solutions/add-mcp` v2.4.0)

## 1. Goal

One command connects a developer's coding agents to the StackGuardian MCP
server and installs the StackGuardian agent skills:

```
npx add-sg-mcp
```

It opens the StackGuardian dashboard in the browser, the user signs in (if
needed) and picks an organization, the dashboard hands a credential back to
the terminal, and the CLI writes the MCP server entry plus the skills into
every coding agent the user selects (Claude Code, Codex, Cursor, VS Code,
Gemini CLI, OpenCode, Copilot CLI, Windsurf, Kiro, Zed, Cline, Goose, Grok
Build, Kilo, Kimi, Antigravity, Pi, Mastra, MCPorter).

Non-goals (this iteration):

- MCP OAuth 2.1 through the platform broker (api#1739 and friends). The
  broker is delivered but not deployed; see §10 for the `--auth oauth`
  preview hook that needs nothing else from this repo once it is.
- Claude Desktop (stdio-only in upstream; its remote connectors use the
  OAuth path above) and fx (only sends `Bearer`, the gateway needs `apikey`).
- Named / role-scoped API Access keys and per-app revocation UI.
- Keeping upstream's registry site (`registry/`, `web/`) and `find` command.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The credential is the user's **per-org API key** (`sgu_…`), obtained with `POST /api/v1/orgs/<org>/api_token/` `{regenerate:false}`, sent as `Authorization: apikey <key>`. | The gateway authorizer accepts it on the MCP routes (auth `src/app.py:851-865`, `:1153-1179`): the org comes from the URL path, the principal and roles are the user's own. It is long-lived, so static agent configs keep working. The OAuth ID token expires in 60 min and would need a refresh process in every agent. This is also what the dashboard's own "MCP install" snippet already uses (`ApiKeyManagement.tsx:27`). |
| D2 | Login and org selection happen on a **new dashboard page** `/orchestrator/cli-connect`, which redirects to a **loopback callback** on the CLI. | The user asked for the dashboard to drive login + org selection. The dashboard already preserves deep links through login (`App.jsx` `handleUser`, `utils/redirect/*`) and has the org list + `OrgApiKey` service used by `TerraformLogin`. The loopback redirect is the `gh auth login` model. |
| D3 | Default scope is **user-level** (global). Project scope needs `--project`. | A credential must not be written into a repo's `.mcp.json` / `.cursor/mcp.json` by default. Upstream defaults to project scope; we invert it. |
| D4 | Reuse upstream's agent table, config writers and installer **unchanged**; put all StackGuardian logic in `src/sg/*`. | Upstream adds agents every minor release; keeping `agents.ts`, `installer.ts`, `formats/*` byte-identical keeps `git merge upstream/main` cheap. |
| D5 | Skills ship **inside the npm package** (`skills/`), are installed to the cross-agent canonical directory (`~/.agents/skills/<name>` or `.agents/skills/<name>`) and **symlinked** into each agent's native skills directory (copy fallback). | Matches the `.agents/skills` convention the Agent Skills spec recommends and the layout the `skills` CLI already creates on developer machines. |
| D6 | Skill names are prefixed `sg-` (`sg-create-workflow`, `sg-update-workflow`, `sg-upgrade-workflow`). | Namespacing avoids collisions with generic "create-workflow" skills; `name` must equal the directory name. |
| D7 | The MCP server entry is named `stackguardian` and points at `https://<api-host>/api/v1/orgs/<org>/mcp/`. | `/mcp/` with trailing slash is the gateway resource that avoids a redirect (`lakehouse_mcp/path_prefix.py`). One org per entry; `--name` allows a second org side by side. |
| D8 | The dashboard page passes `api_base` back to the CLI, and the CLI accepts only `https` hosts ending in `.stackguardian.io`. | `app.stackguardian.io` and `us.stackguardian.io` are the same bundle; the API host is chosen at runtime from the browser hostname (`authUtils.getApiEndpointForCurrentRegion`). The allow-list closes the obvious redirect-injection hole. |

## 3. Architecture

```
add-sg-mcp (this repo, npm)                 dashboard (React)                 platform API
────────────────────────────                ─────────────────                 ────────────
src/sg/preset.ts    URL/header builders     views/CliConnect/                 POST /orgs/<org>/api_token/
src/sg/auth.ts      loopback login          routes.jsx (+1 route)             (existing)
src/sg/credentials.ts credential store      utils/sidebar.ts (hide sidebar)
src/sg/skills.ts    skills installer
src/sg/commands.ts  Commander wiring
src/index.ts        (thin: registers sg commands)
skills/sg-*/SKILL.md bundled skills
```

Untouched upstream modules: `src/agents.ts`, `src/installer.ts`,
`src/formats/*`, `src/schema.ts`, `src/reader.ts`, `src/opencode-config.ts`,
`src/source-parser.ts`, `src/template.ts`, `src/lib.ts` (plus new exports).

Removed: `src/find.ts`, `tests/find.test.ts`, `registry.json`,
`registry.overlay.json`, `registry/`, `web/`, `scripts/*registry*`,
`scripts/sync-integrations-sh.mjs`, the `find`/`search`/`list`/`sync`
commands and the free-form `[target]` positional, `findRegistries` config,
`.github/workflows/registry-ci.yml`, the `registry:verify` CI step.

## 4. CLI surface

```
npx add-sg-mcp [options]        Connect: login (if needed) → install server → install skills
  add-sg-mcp login  [auth options]   Only obtain/refresh the credential
  add-sg-mcp logout [--purge]        Forget the credential (--purge also removes server + skills)
  add-sg-mcp status                  Show credential (masked) and per-agent install state
  add-sg-mcp remove [agent options]  Remove the server entry and skills from agents
  add-sg-mcp list-agents             (upstream)
```

Auth options (default command and `login`):

| Option | Meaning |
|---|---|
| `--region <eu\|us>` | Production region → dashboard `app.` / `us.stackguardian.io`. Prompted when omitted and interactive. |
| `--env <prod\|qa>` | `qa` → `dash.qa.stackguardian.io` / `testapi.qa…`. Default `prod`. |
| `--dashboard-url <url>` | Any other dashboard (nonprod envs, local dev). Must be http(s). |
| `--org <org>` | Pre-select the organization (the page still shows it; with `--token` it is required). |
| `--token <sgu_key>` | Headless: skip the browser. Requires `--org` and `--api-base` (or `--region`/`--env`). |
| `--api-base <url>` | API base for `--token`, e.g. `https://api.app.stackguardian.io/api/v1`. |
| `--no-browser` | Print the URL instead of opening a browser; still waits for the callback. |
| `--timeout <s>` | Callback wait, default 300. |

Environment variables `SG_API_KEY`, `SG_ORG`, `SG_API_BASE` are read as
fallbacks for `--token`, `--org`, `--api-base` (CI use).

Install options (default command and `remove`): `-a/--agent` (repeatable),
`--all`, `-y/--yes`, `--project` (project scope; warns and implies
`--gitignore`), `-g/--global` (accepted, already the default), `-n/--name`
(default `stackguardian`), `--skip-skills`, `--auth <apikey|oauth>` (default
`apikey`).

Interactive defaults: agents multiselect pre-checked with the agents detected
on the machine (`detectGlobalAgents`), scope global, confirm. `-y` selects
every detected agent; `--all` every supported agent.

Exit codes follow upstream: non-zero when any agent write fails.

## 5. Login flow (end to end)

```
CLI                                  Browser / dashboard                          API
 1  choose dashboard host
 2  listen http://127.0.0.1:<port>/callback, state = 32 random bytes (base64url)
 3  open https://<dash>/orchestrator/cli-connect?port=<port>&state=<state>&client=add-sg-mcp&v=1
                                      4  not signed in → /login?redirect=<that path> (existing)
                                      5  page: consent text, org Select (default lastOrg), Connect
                                      6  Connect → POST /orgs/<org>/api_token/ {regenerate:false} ──▶ key
                                      7  navigate http://127.0.0.1:<port>/callback?state&org&api_key&api_base
 8  verify state, org, api_base; respond HTML ("Connected — close this tab"; strips query via history.replaceState)
 9  save credentials.json (0600)
10  agent selection → upstream main(url, {name, transport:"http", header:["Authorization: apikey <key>"]})
11  skills install → summary
```

Callback contract (`GET /callback`):

| Param | Rule |
|---|---|
| `state` | must equal the CLI's nonce; otherwise `400`, keep waiting |
| `org` | `^[A-Za-z0-9_-]{1,128}$` (org names are Django slugs) |
| `api_key` | non-empty, `^[A-Za-z0-9_.-]{16,512}$` |
| `api_base` | `https://` + hostname ending `.stackguardian.io`; the CLI normalises to `…/api/v1` |
| `error` | `access_denied` → the CLI exits 1 with "Cancelled in the browser" |

Only the first valid callback is accepted; the server closes after it.
Timeout → exit 1 with the `--token` hint. The browser is opened with
`spawn("open"|"xdg-open"|"cmd /c start", [url])` (argv, never a shell
string); on failure or `--no-browser` the URL is printed.

### 5.1 Dashboard page `/orchestrator/cli-connect`

Files: `src/views/CliConnect/{CliConnect.tsx,CliConnect.test.tsx,types.ts,
callbackUrl.ts,callbackUrl.test.ts}`, one route in `src/routes.jsx` next to
`terraform-login` (gated on `!loadingOrgs`), one case in
`utils/sidebar.ts#shouldHideSidebarForRoute`, one changeset.

Query params: `port` (integer 1024–65535), `state`
(`^[A-Za-z0-9_-]{16,128}$`), `client` (`^[a-z0-9-]{1,32}$`, display only,
default `add-sg-mcp`), `v` (ignored). The page **constructs**
`http://127.0.0.1:<port>/callback` itself and never accepts a redirect URI.

States: invalid params → error Alert; org picker + consent ("**add-sg-mcp**
running on this machine asked to connect to StackGuardian as {email}. Only
continue if you just ran this command yourself.") with Connect / Cancel;
SSO user not in rolebindings (`useRoleBindings`, same rule as
`TerraformLogin`) → Alert linking to the org's API Access tab plus the manual
command; connecting → spinner, then `window.location.assign(callbackUrl)`;
a fallback panel ("Terminal didn't pick it up? Paste this:"
`npx add-sg-mcp login --token <key> --org <org> --api-base <base>` with
`CopyToClipboard`) is rendered before navigation so Back shows it. Cancel
navigates to `…/callback?state=<state>&error=access_denied`.

The key is held in component state only; never in storage or logs.

## 6. Credential store

`$XDG_CONFIG_HOME/add-sg-mcp/credentials.json` (POSIX default
`~/.config/add-sg-mcp/`), directory `0700`, file `0600`:

```json
{ "version": 1,
  "current": { "apiBase": "https://api.app.stackguardian.io/api/v1",
               "dashboardUrl": "https://app.stackguardian.io",
               "org": "demo-org", "apiKey": "sgu_…", "obtainedAt": "2026-09-08T12:00:00Z" } }
```

`status` prints the key masked (`sgu_…last4`). `logout` deletes the file.
`login` overwrites `current`. The last-selected-agents memory stays in
upstream's `config.json` (renamed dir `add-sg-mcp`).

## 7. Agent config shapes

Produced by upstream transforms for a remote server with headers (no fork
changes). With `stackguardian`, url `https://api.app.stackguardian.io/api/v1/orgs/demo-org/mcp/`:

- Claude Code (`~/.claude.json`), VS Code (`mcp.json` → `servers`), Gemini CLI,
  MCPorter: `{"type":"http","url":…,"headers":{"Authorization":"apikey …"}}`
- Cursor: same without `type`; Windsurf / Antigravity: `serverUrl` + `headers`
- Codex (`~/.codex/config.toml`): `[mcp_servers.stackguardian]` `url` +
  `[mcp_servers.stackguardian.http_headers]` (upstream rewrites the whole
  TOML file; comments are lost — warned about in the summary)
- OpenCode: `{"type":"remote","url":…,"headers":…}` under `mcp` (V1) or
  `mcp.servers` (V2)
- Cline: `{"url":…,"type":"streamableHttp","headers":…}`; Kiro CLI: `{"url":…,"headers":…}`;
  Zed: `context_servers` `{"source":"custom","type":"http",…}`; Copilot CLI:
  `{"type":"http","url":…,"tools":["*"],"headers":…}`; Goose YAML
  `extensions.stackguardian` `type: streamable_http`, `uri`, `headers`;
  Grok Build TOML; Kilo; Kimi (`transport: http`); Pi; Mastra.
- Excluded by the preset: `claude-desktop` (stdio-only), `fx` (Bearer-only).
  Selecting them explicitly prints why and skips them.

## 8. Skills

Bundled under `skills/` (added to `package.json` `files`), resolved from the
built bundle via `fileURLToPath(import.meta.url)` → `../skills`. Source: the
three customer-facing skills from `sg-clickhouse-mcp/.claude/skills`, renamed
with the `sg-` prefix and cross-references updated.

Install (per selected agent, same scope as the server):

| Scope | Canonical copy | Agent link |
|---|---|---|
| global | `~/.agents/skills/<name>/` | `<agent global skills dir>/<name>` → symlink (relative) |
| project | `<cwd>/.agents/skills/<name>/` | `<cwd>/<agent project skills dir>/<name>` → symlink |

Agent skills directories (from the `skills` CLI table, verified on this
machine for Claude Code, Codex, Gemini, OpenCode, Copilot, Cursor):

| Agent | global | project |
|---|---|---|
| claude-code | `~/.claude/skills` | `.claude/skills` |
| codex | `~/.codex/skills` | `.agents/skills` (canonical) |
| cursor | `~/.cursor/skills` | `.agents/skills` |
| gemini-cli | `~/.gemini/skills` | `.agents/skills` |
| vscode, github-copilot-cli | `~/.copilot/skills` | `.agents/skills` |
| opencode | `~/.config/opencode/skills` | `.agents/skills` |
| kilo-code | `~/.kilo/skills` | `.agents/skills` |
| cline, cline-cli, kimi-code, zed | `~/.agents/skills` (canonical) | `.agents/skills` |
| windsurf | `~/.codeium/windsurf/skills` | `.windsurf/skills` |
| antigravity | `~/.gemini/antigravity/skills` | `.agents/skills` |
| goose | `~/.config/goose/skills` | `.goose/skills` |
| grok-build | `~/.grok/skills` | `.grok/skills` |
| kiro-cli | `~/.kiro/skills` | `.kiro/skills` |
| pi | `~/.pi/agent/skills` | `.pi/skills` |
| mastracode, mcporter | none (skipped with a note) | none |

When the agent directory equals the canonical one, only the copy is made.
Symlink failure (Windows without privileges, `EPERM`) falls back to a
recursive copy. Re-running replaces the canonical copy and fixes the link.
`remove` / `logout --purge` delete the links and the canonical copies for
exactly these three names. A manifest `~/.config/add-sg-mcp/skills.json`
records what was written so removal never touches foreign skills.

## 9. Error handling

| Where | Condition | Behaviour |
|---|---|---|
| CLI | browser cannot be opened | print the URL, keep waiting |
| CLI | no callback within timeout | exit 1: "No response from the browser. Run again, or use --token" |
| CLI | state mismatch / bad params | HTTP 400 to the browser, keep waiting |
| CLI | `api_base` not allow-listed | HTTP 400, keep waiting, print warning |
| CLI | `error=access_denied` | exit 1: "Cancelled in the browser" |
| CLI | credentials file unwritable | exit 1 with the path |
| CLI | agent write failure | upstream per-agent error report, exit 1 |
| CLI | skills link failure | fall back to copy; report per agent |
| Page | invalid `port`/`state` | error Alert, no key fetched |
| Page | `OrgApiKey` error | notification + inline error; nothing sent |
| Page | zero orgs | Alert linking to onboarding |
| Page | loopback unreachable | browser error page; Back shows the fallback panel |

Nothing logs the key: the CLI masks it in `status`, and the callback URL is
only ever parsed, never printed.

## 10. `--auth oauth` (preview)

Writes the same server entry **without** headers for the agents that
implement MCP OAuth themselves (Claude Code, VS Code, Cursor, Codex, Gemini
CLI, Windsurf). No login step; `--org` (or the prompt) is still needed for
the URL. Documented as requiring the platform OAuth broker (api#1739,
core#1290, auth#206, dashboard#6891 plus the QA click-ops in that spec) to
be rolled out. Nothing else in this repo depends on it.

## 11. Testing

House style: `#!/usr/bin/env tsx`, `node:assert`, hand-rolled `test()`,
temp dirs, no mocks. Every new file is added to the `test` / `test:unit` /
`test:e2e` scripts (there is no glob).

- `tests/sg-preset.test.ts` — URL/header builders, host allow-list, org validation.
- `tests/sg-credentials.test.ts` — read/write/mask, file mode `0600`, XDG override.
- `tests/sg-auth.test.ts` — real loopback server: valid callback, state mismatch, bad api_base, cancel, timeout; response HTML has no key.
- `tests/sg-skills.test.ts` — canonical copy, symlink, copy fallback, idempotent re-run, remove, manifest.
- `tests/e2e/sg-cli.test.ts` — subprocess with `HOME`/`XDG_CONFIG_HOME` sandbox: `add-sg-mcp --token … --org … --api-base … -y --all --skip-skills`, per-agent config assertions (claude-code, codex, cursor, vscode, gemini, opencode, copilot, kiro, zed, windsurf), `status`, `remove`, `logout --purge`, `--project` writes + gitignore, help output brand.
- Upstream suites stay green except the knowingly updated config-dir tests; `tests/find.test.ts` is deleted.
- Dashboard: jest for `callbackUrl.ts` and `CliConnect.test.tsx` (param validation, org picker, connect → `OrgApiKey` + navigation URL, cancel URL, SSO-without-rolebindings path, fallback panel).
- Manual: run the CLI on this machine with `--dashboard-url http://localhost:3000` against a local dashboard dev server (QA API), then with dash.qa once the dashboard PR is deployed.

## 12. Rollout

1. `add-sg-mcp` PR → `main`; publish `add-sg-mcp@0.1.0` to npm (Trusted
   Publisher must be re-bound to `StackGuardian/add-sg-mcp` + `release.yml`;
   `docs/RELEASING.md` updated).
2. Dashboard PR → `develop` → dash.qa → prod (EU, US).
3. Until the page is live, `npx add-sg-mcp --token <key> --org <org>` works
   with a key copied from Profile → API keys.
4. Follow-ups outside this repo: point the dashboard's MCP install snippet
   and `sg-clickhouse-mcp` README at `npx add-sg-mcp`; US region MCP gateway
   wiring (infra finding: no invoke permission for `/orgs/*/mcp/*` in
   us-east-2); OAuth broker click-ops.
