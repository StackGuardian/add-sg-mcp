# Deploy Terraform, OpenTofu and Ansible with your AI coding agent

One-command MCP setup and ready-to-use agent skills for Claude Code, Cursor, Codex and [more](#supported-agents).

Connect your coding agent to [StackGuardian](https://www.stackguardian.io), the platform that runs and governs your infrastructure deployments. Then ask in plain language to turn your existing infrastructure code into deployment workflows, review changes, require approvals, add policies and find out why a run failed.

```bash
npx add-sg-mcp
```

No Node.js? Use the [one-line installer](#install) for macOS, Linux or Windows.

**Then try asking your agent:**

> Deploy the Terraform in my `infra` repository, folder `envs/dev`, to AWS.

> Create an OpenTofu workflow for this repository that waits for my approval before every apply.

> Find out why my last infrastructure deployment failed.

[Get started](#get-started) · [Supported agents](#supported-agents) · [Skills](#mcp-and-skills) · [Skills guide](skills/README.md)

## What you can do

| Goal                           | Ask your agent, for example                                                                          | What happens                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy Terraform               | "Create a workflow for the Terraform in `github.com/acme/infra`, folder `envs/staging`."             | A Terraform workflow that runs your own repository's code. The agent asks for the branch, the cloud connector and any variables.                                                 |
| Deploy OpenTofu                | "Create an OpenTofu workflow from our repo that needs approval before every apply."                  | The same, with OpenTofu as the engine.                                                                                                                                           |
| Run Ansible playbooks          | "Set up a workflow that runs our Ansible playbook as a custom step."                                 | A custom step pipeline built from workflow step templates in your StackGuardian library. Helm, Kubernetes manifests and CloudFormation work the same way.                        |
| Start from a template          | "Deploy the S3 bucket template from our library into the `dev` workflow group."                      | A workflow from a library template. You see every input and its default before anything is created.                                                                              |
| Deploy related pieces together | "Create a stack that sets up a VPC, a security group and an EC2 instance in `staging`."              | Several workflows from a stack template, run in the order the template sets.                                                                                                     |
| Govern deployments             | "Block any deployment in the `prod` group that makes an S3 bucket public."                           | A policy that blocks, warns on or requires approval for a change, written in [Tirith](https://github.com/StackGuardian/tirith) or Rego, or taken from a library policy template. |
| Approve or stop runs           | "Approve the run of `prod-vpc` that's waiting for approval."                                         | The agent always asks you before it approves, rejects or cancels a run.                                                                                                          |
| Troubleshoot                   | "Why did the last run of `prod-vpc` fail?" · "Show the outputs of that run."                         | The agent reads the run's status, logs and outputs.                                                                                                                              |
| Manage what you deployed       | "Add a nightly 2 AM schedule to `prod-vpc`." · "Upgrade `prod-vpc` to the latest template revision." | Changes only the settings you name, or moves the workflow to another template revision after a dry run.                                                                          |
| Keep secrets out of code       | "Store a GitHub token as a secret called `GITHUB_TOKEN`."                                            | The value goes into the StackGuardian vault, and workflows refer to it by name.                                                                                                  |
| Check your cloud               | "How are we doing on cloud posture?" · "What isn't managed by IaC?"                                  | The agent reads your cloud inventory and posture data.                                                                                                                           |

**Creating a workflow doesn't deploy anything.** A deployment happens when a run starts: when you or your agent start a plan or apply, or when a schedule you set fires. Most agents ask you to approve each tool call, so you see a run request before it starts.

## Get started

### Before you start

- **A StackGuardian account** with access to the organization you want to connect, and roles that let you create and run workflows. Your region is **Europe** (`app.stackguardian.io`) or **United States** (`us.stackguardian.io`).
- **Connectors** for what you deploy: a cloud connector for the account you deploy to (AWS, for example), and a git (VCS) connector if your infrastructure code is in a private repository. The agent lists the connectors your organization already has.
- At least one [supported coding agent](#supported-agents) on this machine.
- Node.js 18 or later for `npx`, or the standalone executable below.

### Install

With Node.js:

```bash
npx add-sg-mcp
```

Without Node.js, the installer downloads a standalone executable, checks it against the release's `SHA256SUMS`, installs it and runs it:

```bash
# macOS and Linux
curl -fsSL https://dl.stackguardian.io/add-sg-mcp/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://dl.stackguardian.io/add-sg-mcp/install.ps1 | iex
```

Then:

1. **Sign in.** Pick your region. The StackGuardian dashboard opens in your browser; sign in if needed, then choose the organization, the roles the agent may use and how long the access lasts.
2. **Connect your agents.** Back in the terminal, choose the agents to connect. The ones found on this machine (or those you picked last time) are preselected.
3. **Restart those agents.** Most read their MCP configuration only at startup.
4. **Ask.** Describe what you want to deploy, change or investigate. The agent looks up your workflow groups, templates and connectors, and checks with you before it creates or changes anything.

With the standalone executable, run `add-sg-mcp` wherever this README says `npx add-sg-mcp`. See [Install script options](#install-script-options) to pin a version, change the install folder or use a mirror.

### Check that it works

- **Claude Code:** run `/mcp`. `StackGuardian-<org>` should be listed, and the skills show up as `/sg-create-workflow`, `/sg-update-workflow`, `/sg-upgrade-workflow`, `/sg-create-stack`, `/sg-create-policy` and `/sg-manage-secrets`.
- **Any agent:** `npx add-sg-mcp status` shows your saved sign-in and which agents have the server and the skills.
- Ask your agent something small, such as _"Show my five most recent StackGuardian workflow runs and their status."_

Nothing there? See [Troubleshooting](#troubleshooting).

## Supported agents

**Claude Code, Cursor, Codex, VS Code (Copilot), Gemini CLI, OpenCode, Windsurf**, plus GitHub Copilot CLI, Kiro CLI, Zed, Cline, Goose, Grok Build, Kilo Code, Kimi Code, Antigravity, Pi, Mastra Code and MCPorter. Run `npx add-sg-mcp list-agents` for the current list and each agent's config file.

Every agent gets the MCP server. Skills are installed into each agent's skills directory where the agent has one; Mastra Code and MCPorter get the server only. How a skill starts differs by agent: Claude Code offers each one as a slash command, and other agents pick up a skill when your request matches it. See [Agent-specific notes](#agent-specific-notes) for other differences.

## MCP and skills

**MCP provides the tools. Skills provide the playbooks.**

- **The StackGuardian MCP server** gives your agent tools for your StackGuardian organization: search workflows, read run logs, create a workflow, start a run, store a secret and more. The server is hosted by StackGuardian; this repository contains the installer that connects your agents to it. In Claude Code, `/mcp` lists the server's current tools.
- **The skills** are playbooks for multi-step tasks, bundled in [`skills/`](skills/). Each one tells the agent which tools to use, in what order, and what to ask you along the way, so it brings you choices instead of guessing IDs or defaults.

| Skill                                                        | Use it to                                                                                                                                                                                | Try saying                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`sg-create-workflow`](skills/sg-create-workflow/SKILL.md)   | Create a workflow from your own git repository or a library template: Terraform, OpenTofu or a custom step pipeline (Ansible, Helm and so on). You review the inputs and defaults first. | "Create a workflow for the Terraform in `github.com/acme/infra`, folder `envs/staging`, branch `main`." |
| [`sg-update-workflow`](skills/sg-update-workflow/SKILL.md)   | Change an existing workflow's connector, variables, schedules, approvals, runner, notifications, sizing and more. Only what you change is touched.                                       | "Require approval from alice@example.com or bob@example.com before `prod-vpc` applies."                 |
| [`sg-upgrade-workflow`](skills/sg-upgrade-workflow/SKILL.md) | Move a workflow to another template revision, with a dry run that shows the exact change first.                                                                                          | "What would change if I moved `prod-vpc` to revision 5 of its template?"                                |
| [`sg-create-stack`](skills/sg-create-stack/SKILL.md)         | Create several workflows together from a stack template, reviewing each workflow's inputs. Nothing runs until you start it.                                                              | "Create a stack that sets up a VPC, a security group and an EC2 instance in `staging`."                 |
| [`sg-create-policy`](skills/sg-create-policy/SKILL.md)       | Add a guardrail that blocks, warns on or requires approval for infrastructure changes, from a library policy, a Tirith rule or your own Rego.                                            | "Warn when the estimated monthly cost of an EC2 instance goes over $100."                               |
| [`sg-manage-secrets`](skills/sg-manage-secrets/SKILL.md)     | Store, rotate or delete vault secrets, and use them in workflows.                                                                                                                        | "Store this API token and add it to `prod-vpc` as the `API_TOKEN` environment variable."                |

The [skills guide](skills/README.md) walks through each skill step by step, with more examples and the StackGuardian terms you'll meet.

## Why run deployments through StackGuardian?

Terraform, OpenTofu and Ansible still do the work. Running them as StackGuardian workflows instead of from your laptop adds the parts a team needs around them:

- **Managed execution.** Runs happen on StackGuardian-managed runners or on your own private runner group, not on the machine your agent runs on.
- **Run history.** Every plan and apply is recorded with its logs and outputs, so you, your teammates and your agent can look back at what happened.
- **Reviews and approvals.** A Terraform or OpenTofu workflow can pause after the plan until named approvers release it; a custom pipeline can pause before any step.
- **Policies.** Tirith or Rego rules check infrastructure changes and block them, warn or ask for approval.
- **Reusable templates.** Library templates and stack templates give teams a reviewed starting point, with revisions you can upgrade to.
- **After the deploy.** Schedules, drift detection for Terraform and OpenTofu workflows, notifications, webhooks and chained workflows.
- **Secrets and connectors.** Workflows use cloud and git connectors and vault secrets by reference, so credentials don't have to sit in your repository.

These are per-workflow settings: none is switched on just by connecting your agent, and some apply only to certain workflow types.

## Choose how your agent signs in

|                     | Grant token (default)                                         | API key                                                          | OAuth (preview)                                             |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Command             | `npx add-sg-mcp`                                              | `npx add-sg-mcp --token <api-key> --org <org> --region <eu\|us>` | `npx add-sg-mcp --auth oauth --org <org> --region <eu\|us>` |
| How you sign in     | In the browser                                                | No browser: you pass a key from _Profile → API keys_             | In the agent, on first use                                  |
| What the agent gets | A token for one organization and the roles you approve        | Your user API key for the organization                           | No stored credential; the agent signs you in on first use   |
| Access              | Only the roles you approved                                   | Everything your roles allow                                      | Your access, through the agent's own sign-in                |
| Expiry and revoking | You choose the expiry; revoke from _Profile → Connected apps_ | No expiry; rotate it from _Profile → API keys_                   | Handled through the agent's own sign-in                     |

Only the grant sign-in opens the dashboard. An API key is never fetched for you: pass it with `--token` (or `SG_API_KEY`). Without `--auth`, a key you pass, or one saved by an earlier `--token` run, selects the API key; otherwise you sign in for a grant.

The tools that create, change, run or delete things act on your real StackGuardian organization, with the access of the credential you chose. Read what the agent is about to do before you approve a tool call.

### Grant tokens

`npx add-sg-mcp` (optionally `--region eu --org my-org`) asks the StackGuardian OAuth broker for a **grant token** instead of using your API key. The browser opens a consent page where you pick the organization, the roles the agent may use and how long the grant should last; the CLI receives an `sgat_` token on a loopback callback and writes it to each agent as an `Authorization: Bearer` header.

- The token is bound to **one organization and the roles you approved** — it is not your full user key, so an agent can be given less than you have.
- `npx add-sg-mcp status` shows `expires <date>`, `no expiry` or `expired`. An expired grant is never reused; the next run asks for a new one.
- `logout` revokes the saved grant and deletes the local copy. Revoke a grant any time from _Profile → Connected apps_ in the dashboard.
- `npx add-sg-mcp login` requests a fresh grant, then asks which agents to install it to.
- If an API key is saved from an earlier `--token` run, `npx add-sg-mcp` keeps using it. Pass `--auth grant` to switch to a grant.

### OAuth (preview)

`npx add-sg-mcp --auth oauth --org my-org --region eu` writes the server URL without a credential for agents that implement MCP OAuth themselves (Claude Code, VS Code, Cursor, Codex, Gemini CLI, Windsurf). The agent then signs you in on first use. This needs the StackGuardian OAuth broker to be enabled for your environment.

## Everyday tasks

| To                             | Run                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect another agent          | `npx add-sg-mcp -a cursor` (`npx add-sg-mcp list-agents` shows the names)                                                                                                                                               |
| Connect another organization   | `npx add-sg-mcp login --org other-org --region eu`, then pick your agents. It gets its own `StackGuardian-other-org` entry next to the first.                                                                           |
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

`--api-base https://…/api/v1` replaces `--region` for non-standard environments. In a Docker image, `curl -fsSL https://dl.stackguardian.io/add-sg-mcp/install.sh | ADD_SG_MCP_NO_RUN=1 sh` installs the executable without running it.

## Troubleshooting

**The server doesn't show up in my agent.** Restart the agent; most read their MCP config only at startup. Then run `npx add-sg-mcp status`. If the agent isn't listed, it wasn't selected: run `npx add-sg-mcp -a <agent>`. With `--project`, the server is only in that project's config.

**"No coding agents detected on this machine."** With `-y`, or when there's no terminal to prompt in, only detected agents are used. Name them instead (`-a claude-code -a cursor`) or pass `--all`.

**The browser doesn't open, or sign-in times out.** Add `--no-browser` and open the printed link in a browser on the same machine; the sign-in returns to a listener on `127.0.0.1`. Sign-in waits five minutes (`--login-timeout <seconds>` changes that). On a remote server or in CI, use an API key instead ([Headless / CI](#headless--ci)).

**My agent gets "unauthorized" errors.** The credential in the agent's config no longer works:

- API key rotated or deleted: run `npx add-sg-mcp --token <new-key> --org <org> --region <eu|us>` to write the new key to your agents.
- Grant expired: `npx add-sg-mcp` asks for a new one.
- Grant revoked: run `npx add-sg-mcp login` and pick your agents.

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
  --token <api-key>          Use this API key instead of signing in (or SG_API_KEY); needs --org
  --api-base <url>           API base for --token or --auth grant, in place of --region
  --no-browser               Print the sign-in link instead of opening a browser
  --login-timeout <seconds>  How long to wait for the browser (default 300)
  --dashboard-url <url>      Another dashboard (other environments, local dev)
  --auth <apikey|grant|oauth> Credential mode (default: apikey when a key is given, otherwise grant)
```

| Command                                          | What it does                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npx add-sg-mcp login`                           | Sign in again (switch organization or region), then pick the agents to install to. Without a terminal it only saves the credential |
| `npx add-sg-mcp status`                          | Show the saved credential (masked) and which agents have the server and skills                                                     |
| `npx add-sg-mcp remove [-a <agent>] [--project]` | Remove the server entry and the skills from your agents                                                                            |
| `npx add-sg-mcp logout [--purge]`                | Forget the credential; `--purge` also runs `remove`                                                                                |
| `npx add-sg-mcp list-agents`                     | List supported agents and their config files                                                                                       |

`remove` and `logout --purge` take every `StackGuardian-<org>` entry and the skills out. `remove --name <entry>` takes out just that entry and keeps the skills.

### Install script options

Pass options to the first run:

```bash
curl -fsSL https://dl.stackguardian.io/add-sg-mcp/install.sh | sh -s -- --region eu -a claude-code
```

```powershell
& ([scriptblock]::Create((irm https://dl.stackguardian.io/add-sg-mcp/install.ps1))) --region eu -a claude-code
```

Environment variables (with `curl | sh`, set them on the `sh` side: `… | ADD_SG_MCP_NO_RUN=1 sh`):

| Variable                  | Effect                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ADD_SG_MCP_VERSION`      | Release to install, e.g. `v1.0.4` (default: latest)                                                                       |
| `ADD_SG_MCP_INSTALL_DIR`  | Install directory. Default `~/.local/bin`; on Windows `%LOCALAPPDATA%\add-sg-mcp\bin`, which is added to your user `PATH` |
| `ADD_SG_MCP_DOWNLOAD_URL` | Base URL of a mirror that serves the release files                                                                        |
| `ADD_SG_MCP_NO_RUN`       | `1` installs without running `add-sg-mcp`                                                                                 |

Builds exist for macOS (Apple Silicon, Intel), Linux with glibc (x64, arm64) and Windows x64. To install by hand, download `https://dl.stackguardian.io/add-sg-mcp/v<version>/add-sg-mcp-<os>-<arch>.tar.gz` (or `add-sg-mcp-windows-x64.zip`) and put the executable on your `PATH`; `https://dl.stackguardian.io/add-sg-mcp/latest` names the newest version, and `SHA256SUMS` sits next to the archives.

`gh attestation verify <file> --repo StackGuardian/stackguardian-mcp` confirms that a file was built by this repository's workflow. Releases up to and including 1.0.6 were built before the repository was renamed from `add-sg-mcp`; verify those with `--repo StackGuardian/add-sg-mcp`.

`dl.stackguardian.io` has every release from 1.0.4 on.

The executables are not yet notarized by Apple or code-signed for Windows. The install scripts are not affected, but a browser download is quarantined on macOS and may show a SmartScreen prompt on Windows (_More info → Run anyway_).

### Agent-specific notes

- **Codex** and **Grok Build** store MCP servers in a TOML file that is rewritten as a whole; comments in `~/.codex/config.toml` are not preserved.
- **Claude Desktop** and **fx** are skipped: Claude Desktop only supports local (stdio) servers here and fx only sends bearer tokens. Add StackGuardian to Claude Desktop through _Settings → Connectors_ instead.
- **Claude Code** and **GitHub Copilot CLI** share `.mcp.json` in project scope.
- **Mastra Code** and **MCPorter** get the server but have no skills directory.

### How it works

1. `npx add-sg-mcp` starts a one-time callback listener on `127.0.0.1` and opens the StackGuardian sign-in for your region in your browser.
2. You sign in if needed and choose the organization, the roles the agent may use and how long the grant lasts.
3. The browser returns a one-time code to the loopback callback, and the CLI exchanges it for a grant token. The token is stored in `~/.config/add-sg-mcp/credentials.json` (mode `0600`). With `--token`, steps 1 to 3 are skipped and the key you passed is stored instead.
4. The CLI writes the server entry into each selected agent's own config file:

   ```json
   {
     "mcpServers": {
       "StackGuardian-<org>": {
         "type": "http",
         "url": "https://api.app.stackguardian.io/api/v1/orgs/<org>/mcp/",
         "headers": { "Authorization": "Bearer sgat_…" }
       }
     }
   }
   ```

   (Codex gets the TOML equivalent, Goose YAML, and so on — each agent's native format. With an API key the header is `apikey sgu_…`.)

5. The skills are copied to `~/.agents/skills/` and symlinked into each agent's skills directory (`~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, …), so a single copy serves every agent.

### Security

- On Windows there is no `0600` equivalent; the file relies on the ACL of your profile folder.
- With an API key (`--token`) the credential is your **user API key for the selected organization**: it acts as you, with your roles, and it does not expire on its own. Rotate it from _Profile → API keys_ in the dashboard if a machine is lost.
- With a grant (the default) the credential is a **grant token bound to one organization and the roles you approved**, and it can carry an expiry. `logout` revokes it; you can also revoke it from _Profile → Connected apps_. For an API key `logout` only deletes the local copy — it never invalidates the key.
- By default nothing is written into project directories. `--project` warns and adds the generated files to `.gitignore`.
- The CLI accepts a callback only when its one-time `state` matches, and sends the code and the credential only to API hosts under `stackguardian.io` (or `localhost`, for local development).
- `status` never prints the key or the grant token in full; the callback page strips the one-time code from the browser history, and the grant flow keeps its PKCE verifier off the front channel (only the one-time code travels through the browser).

## Contributing

Pull requests are welcome: fixes to the installer, support for more agents, and improvements to the skills in [`skills/`](skills/). For a problem with your StackGuardian account or the hosted MCP server, contact support@stackguardian.io.

```bash
bun install
bun run dev -- --help          # run from source
bun run typecheck && bun run test
bun run build:binary           # standalone executable for this machine
```

Tests are plain `tsx` scripts with `node:assert` (no mocks; the login test spins up a real loopback server), run by `tests/run.mjs` under a throwaway `HOME`. See [`AGENTS.md`](AGENTS.md) for the workflow, [`docs/RELEASING.md`](docs/RELEASING.md) for releases and [`docs/superpowers/specs/`](docs/superpowers/specs/) for the design.

If this project is useful to you, starring the repository helps other developers find it.

This project is a fork of [neon-solutions/add-mcp](https://github.com/neon-solutions/add-mcp) (Apache-2.0); the agent config writers come from upstream unchanged. Passing a URL or package name as the first argument still installs any other MCP server the way `add-mcp` does.

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
