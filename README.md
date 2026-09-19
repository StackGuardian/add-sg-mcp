# add-sg-mcp

Work with [StackGuardian](https://www.stackguardian.io) from your coding agent. One command adds the **StackGuardian MCP server** to Claude Code, Codex, Cursor, VS Code, Gemini CLI and [more](#supported-agents), and installs the **StackGuardian skills**. You can then ask your agent, in plain language, to find out why a run failed, deploy a template, change a workflow or check your cloud posture.

```bash
npx add-sg-mcp
```

No Node.js? Use the [one-line installer](#install) for macOS, Linux or Windows instead.

## Before you start

- A StackGuardian account with access to the organization you want to connect.
- Your region: **Europe** (`app.stackguardian.io`) or **United States** (`us.stackguardian.io`).
- At least one [supported coding agent](#supported-agents) on this machine.

## Install

With Node.js 18 or later:

```bash
npx add-sg-mcp
```

Without Node.js, the installer downloads a standalone executable, checks it against the release's `SHA256SUMS`, installs it and runs it:

```bash
# macOS and Linux
curl -fsSL https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.ps1 | iex
```

Then:

1. Pick your region. The StackGuardian dashboard opens in your browser; sign in if needed and choose the organization.
2. Back in the terminal, choose the agents to connect. The ones found on this machine (or those you picked last time) are preselected.
3. Restart those agents.

With the standalone executable, run `add-sg-mcp` wherever this README says `npx add-sg-mcp`. See [Install script options](#install-script-options) to pin a version, change the install folder or use a mirror.

## Check that it works

- **Claude Code:** run `/mcp`. `StackGuardian-<org>` should be listed, and the skills show up as `/sg-create-workflow`, `/sg-update-workflow` and `/sg-upgrade-workflow`.
- **Any agent:** `npx add-sg-mcp status` shows your saved sign-in and which agents have the server and the skills.
- Ask your agent something small, such as _"Show my five most recent StackGuardian workflow runs and their status."_

Nothing there? See [Troubleshooting](#troubleshooting).

## What your agent can do

The MCP server works in the organization you connected, with the access of the credential you chose ([see below](#choose-how-your-agent-signs-in)). Its tools cover these areas:

| Area                        | Ask your agent, for example                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Workflows and runs          | "Why did the last run of `prod-vpc` fail?" · "Show the outputs of that run" · "Start a new run of `prod-vpc`"                        |
| Approvals                   | "Approve the run of `prod-vpc` that's waiting for approval" — the agent always asks you before it approves, rejects or cancels a run |
| Templates and the library   | "Find a StackGuardian template for an S3 bucket" · "Which workflows still use revision 3 of our `vpc` template?"                     |
| Stacks and policies         | "Which stacks have drift?" · "Which stacks have no policy attached?"                                                                 |
| Secrets and connectors      | "Is our AWS connector still authenticating?" · "Store a new secret `github-token`"                                                   |
| Cloud inventory and posture | "How are we doing on cloud posture?" · "What are our ten most misconfigured AWS resources?" · "What isn't managed by IaC?"           |

Tools that create, change, run or delete things act on your real StackGuardian organization. Most agents ask before each tool call, so read what the agent is about to do before you approve it. In Claude Code, `/mcp` lists the server's current tools.

### Skills

The skills walk the agent through multi-step changes and ask you at each decision instead of guessing:

| Skill                 | Use it to                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sg-create-workflow`  | Create a workflow from a StackGuardian template or your own git repository (Terraform, OpenTofu or a custom step pipeline). You review the template's defaults before anything is created. |
| `sg-update-workflow`  | Change an existing workflow's settings: connector, environment variables, schedules, approvals, runners, notifications and more. Only what you change is touched.                          |
| `sg-upgrade-workflow` | Move a workflow to another template revision, with a dry run that shows the exact change first.                                                                                            |

In Claude Code, start one with `/sg-create-workflow` and so on. Other agents pick up a skill when your request matches it, for example _"Deploy the AWS VPC template to the networking workflow group."_

## Choose how your agent signs in

|                     | API key (default)                              | Grant token                                                   | OAuth (preview)                                             |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Command             | `npx add-sg-mcp`                               | `npx add-sg-mcp --auth grant`                                 | `npx add-sg-mcp --auth oauth --org <org> --region <eu\|us>` |
| What the agent gets | Your user API key for the organization         | A token for one organization and the roles you approve        | No stored credential; the agent signs you in on first use   |
| Access              | Everything your roles allow                    | Only the roles you approved                                   | Your access, through the agent's own sign-in                |
| Expiry and revoking | No expiry; rotate it from _Profile → API keys_ | You choose the expiry; revoke from _Profile → Connected apps_ | Handled through the agent's own sign-in                     |

Use a grant token when an agent should be able to do less than you can.

### Grant tokens

`npx add-sg-mcp --auth grant --region eu` (optionally `--org my-org`) asks the StackGuardian OAuth broker for a **grant token** instead of using your API key. The browser opens a consent page where you pick the organization, the roles the agent may use and how long the grant should last; the CLI receives an `sgm_` token on a loopback callback and writes it to each agent as an `Authorization: Bearer` header.

- The token is bound to **one organization and the roles you approved** — it is not your full user key, so an agent can be given less than you have.
- `npx add-sg-mcp status` shows `expires <date>`, `no expiry` or `expired`. An expired grant is never reused; the next run asks for a new one.
- Revoke a grant any time from _Profile → Connected apps_ in the dashboard. `logout` only deletes the local copy.
- `npx add-sg-mcp login --auth grant` requests a fresh grant without touching agent configs.

### OAuth (preview)

`npx add-sg-mcp --auth oauth --org my-org --region eu` writes the server URL without a credential for agents that implement MCP OAuth themselves (Claude Code, VS Code, Cursor, Codex, Gemini CLI, Windsurf). The agent then signs you in on first use. This needs the StackGuardian OAuth broker to be enabled for your environment.

## Everyday tasks

| To                             | Run                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect another agent          | `npx add-sg-mcp -a cursor` (`npx add-sg-mcp list-agents` shows the names)                                                                                                                                               |
| Connect another organization   | `npx add-sg-mcp login --org other-org --region eu`, then `npx add-sg-mcp`. It gets its own `StackGuardian-other-org` entry next to the first.                                                                           |
| Disconnect one organization    | `npx add-sg-mcp remove --name StackGuardian-<org>`. The skills stay for the organizations you keep.                                                                                                                     |
| Update the tool and the skills | `npx add-sg-mcp@latest`, or run the install script again. Each run refreshes the skills.                                                                                                                                |
| See what's installed           | `npx add-sg-mcp status`                                                                                                                                                                                                 |
| Remove everything              | `npx add-sg-mcp logout --purge` removes the server and skills from your agents and forgets the credential. For the standalone executable, also delete `~/.local/bin/add-sg-mcp` (Windows: `%LOCALAPPDATA%\add-sg-mcp`). |

### Headless / CI

Skip the browser with an API key from **Profile → API keys** in the dashboard:

```bash
npx add-sg-mcp --token sgu_… --org my-org --region eu -y --all
# or
SG_API_KEY=sgu_… SG_ORG=my-org SG_REGION=eu npx add-sg-mcp -y -a claude-code
```

`--api-base https://…/api/v1` replaces `--region` for non-standard environments. In a Docker image, `curl -fsSL …/install.sh | ADD_SG_MCP_NO_RUN=1 sh` installs the executable without running it.

## Troubleshooting

**The server doesn't show up in my agent.** Restart the agent; most read their MCP config only at startup. Then run `npx add-sg-mcp status`. If the agent isn't listed, it wasn't selected: run `npx add-sg-mcp -a <agent>`. With `--project`, the server is only in that project's config.

**"No coding agents detected on this machine."** With `-y`, or when there's no terminal to prompt in, only detected agents are used. Name them instead (`-a claude-code -a cursor`) or pass `--all`.

**The browser doesn't open, or sign-in times out.** Add `--no-browser` and open the printed link in a browser on the same machine; the sign-in returns to a listener on `127.0.0.1`. Sign-in waits five minutes (`--login-timeout <seconds>` changes that). On a remote server or in CI, use an API key instead ([Headless / CI](#headless--ci)).

**My agent gets "unauthorized" errors.** The credential in the agent's config no longer works:

- API key rotated or deleted: run `npx add-sg-mcp login`, then `npx add-sg-mcp` to write the new key to your agents.
- Grant expired: `npx add-sg-mcp --auth grant` asks for a new one.
- Grant revoked: run `npx add-sg-mcp login --auth grant`, then `npx add-sg-mcp --auth grant`.

**The skills don't appear.** Restart the agent. Mastra Code and MCPorter have no skills support, so they get the server only. `--skip-skills` skips them on purpose.

**"… exists and was not installed by add-sg-mcp."** A skill folder with the same name is already in the agent's skills directory. Move it away and run again.

**Claude Desktop.** Not supported here: Claude Desktop only takes local servers from this tool. Add StackGuardian through _Settings → Connectors_ instead.

**"this Linux has no glibc".** The standalone executables need glibc, which Alpine and other musl-based systems lack. Use `npx add-sg-mcp` with Node.js there.

## Reference

### Options

```
npx add-sg-mcp [options]

  --region <eu|us|qa>        StackGuardian region (prompted when omitted)
  --org <org>                Organization to connect (pre-selected in the browser)
  -a, --agent <agent>        Agents to install to (repeatable; default: the ones detected)
  --all                      Every supported agent
  -y, --yes                  No prompts (installs to all detected agents)
  --project                  Project scope (current directory) instead of your user profile;
                             the generated files are added to .gitignore
  -n, --name <name>          Server entry name (default: StackGuardian-<org>)
  --skip-skills              Do not install the skills
  --token <api-key>          Use this API key instead of signing in (or SG_API_KEY)
  --api-base <url>           API base for --token or --auth grant, in place of --region
  --no-browser               Print the sign-in link instead of opening a browser
  --login-timeout <seconds>  How long to wait for the browser (default 300)
  --dashboard-url <url>      Another dashboard (other environments, local dev)
  --auth <apikey|grant|oauth> Credential mode (default apikey)
```

| Command                                          | What it does                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `npx add-sg-mcp login`                           | Sign in again (switch organization or region) without touching agent configs   |
| `npx add-sg-mcp status`                          | Show the saved credential (masked) and which agents have the server and skills |
| `npx add-sg-mcp remove [-a <agent>] [--project]` | Remove the server entry and the skills from your agents                        |
| `npx add-sg-mcp logout [--purge]`                | Forget the credential; `--purge` also runs `remove`                            |
| `npx add-sg-mcp list-agents`                     | List supported agents and their config files                                   |

`remove` and `logout --purge` take every `StackGuardian-<org>` entry and the skills out. `remove --name <entry>` takes out just that entry and keeps the skills.

### Install script options

Pass options to the first run:

```bash
curl -fsSL https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.sh | sh -s -- --region eu -a claude-code
```

```powershell
& ([scriptblock]::Create((irm https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.ps1))) --region eu -a claude-code
```

Environment variables (with `curl | sh`, set them on the `sh` side: `… | ADD_SG_MCP_NO_RUN=1 sh`):

| Variable                  | Effect                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ADD_SG_MCP_VERSION`      | Release to install, e.g. `v0.2.0` (default: latest)                                                                       |
| `ADD_SG_MCP_INSTALL_DIR`  | Install directory. Default `~/.local/bin`; on Windows `%LOCALAPPDATA%\add-sg-mcp\bin`, which is added to your user `PATH` |
| `ADD_SG_MCP_DOWNLOAD_URL` | Base URL of a mirror that serves the release files                                                                        |
| `ADD_SG_MCP_NO_RUN`       | `1` installs without running `add-sg-mcp`                                                                                 |

Builds exist for macOS (Apple Silicon, Intel), Linux with glibc (x64, arm64) and Windows x64. To install by hand, download `add-sg-mcp-<os>-<arch>.tar.gz` (or `add-sg-mcp-windows-x64.zip`) from the release and put the executable on your `PATH`. `gh attestation verify <file> --repo StackGuardian/add-sg-mcp` confirms that a file was built by this repository's workflow.

The executables are not yet notarized by Apple or code-signed for Windows. The install scripts are not affected, but a browser download is quarantined on macOS and may show a SmartScreen prompt on Windows (_More info → Run anyway_).

### Supported agents

Claude Code, Codex, Cursor, VS Code (Copilot), Gemini CLI, OpenCode, GitHub Copilot CLI, Windsurf, Kiro CLI, Zed, Cline, Goose, Grok Build, Kilo Code, Kimi Code, Antigravity, Pi, Mastra Code, MCPorter. Run `npx add-sg-mcp list-agents` for the current list and each agent's config file.

- **Codex** and **Grok Build** store MCP servers in a TOML file that is rewritten as a whole; comments in `~/.codex/config.toml` are not preserved.
- **Claude Desktop** and **fx** are skipped: Claude Desktop only supports local (stdio) servers here and fx only sends bearer tokens. Add StackGuardian to Claude Desktop through _Settings → Connectors_ instead.
- **Claude Code** and **GitHub Copilot CLI** share `.mcp.json` in project scope.
- Mastra Code and MCPorter get the server but have no skills directory.

### How it works

1. `npx add-sg-mcp` starts a one-time callback listener on `127.0.0.1` and opens `https://app.stackguardian.io/orchestrator/cli-connect` (or the region you pick) in your browser.
2. You sign in if needed and choose the organization to connect.
3. The dashboard sends your organization API key back to the CLI on the loopback callback. The key is stored in `~/.config/add-sg-mcp/credentials.json` (mode `0600`).
4. The CLI writes the server entry into each selected agent's own config file:

   ```json
   {
     "mcpServers": {
       "StackGuardian-<org>": {
         "type": "http",
         "url": "https://api.app.stackguardian.io/api/v1/orgs/<org>/mcp/",
         "headers": { "Authorization": "apikey sgu_…" }
       }
     }
   }
   ```

   (Codex gets the TOML equivalent, Goose YAML, and so on — each agent's native format.)

5. The skills are copied to `~/.agents/skills/` and symlinked into each agent's skills directory (`~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, …), so a single copy serves every agent.

### Security

- On Windows there is no `0600` equivalent; the file relies on the ACL of your profile folder.
- With `--auth apikey` (the default) the credential is your **user API key for the selected organization**: it acts as you, with your roles, and it does not expire on its own. Rotate it from _Profile → API keys_ in the dashboard if a machine is lost.
- With `--auth grant` the credential is a **grant token bound to one organization and the roles you approved**, and it can carry an expiry. Revoke it from _Profile → Connected apps_. In both cases `logout` only deletes the local copy — it never invalidates the credential.
- By default nothing is written into project directories. `--project` warns and adds the generated files to `.gitignore`.
- The CLI accepts a callback only when its one-time `state` matches, and only API hosts under `stackguardian.io` (or the host you passed with `--dashboard-url`).
- `status` never prints the key or the grant token in full; the callback page strips the credential from the browser history, and a grant flow keeps its PKCE verifier off the front channel (only the one-time code travels through the browser).

## Contributing

```bash
bun install
bun run dev -- --help          # run from source
bun run typecheck && bun run test
bun run build:binary           # standalone executable for this machine
```

Tests are plain `tsx` scripts with `node:assert` (no mocks; the login test spins up a real loopback server), run by `tests/run.mjs` under a throwaway `HOME`. See `AGENTS.md` for the workflow, `docs/RELEASING.md` for releases and `docs/superpowers/specs/` for the design.

This project is a fork of [neon-solutions/add-mcp](https://github.com/neon-solutions/add-mcp) (Apache-2.0); the agent config writers come from upstream unchanged. Passing a URL or package name as the first argument still installs any other MCP server the way `add-mcp` does.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
