# add-sg-mcp

Connect your coding agents to [StackGuardian](https://www.stackguardian.io) with one command.

```bash
npx add-sg-mcp
```

It opens the StackGuardian dashboard so you can sign in and pick an organization, hands the credential back to your terminal, and then:

- adds the **StackGuardian MCP server** (`stackguardian`) to the coding agents you choose, and
- installs the **StackGuardian skills** (`sg-create-workflow`, `sg-update-workflow`, `sg-upgrade-workflow`) so those agents know how to create, change and upgrade workflows through the MCP tools.

Supported agents: Claude Code, Codex, Cursor, VS Code (Copilot), Gemini CLI, OpenCode, GitHub Copilot CLI, Windsurf, Kiro CLI, Zed, Cline, Goose, Grok Build, Kilo Code, Kimi Code, Antigravity, Pi, Mastra Code, MCPorter. Run `npx add-sg-mcp list-agents` for the current list.

## How it works

1. `npx add-sg-mcp` starts a one-time callback listener on `127.0.0.1` and opens `https://app.stackguardian.io/orchestrator/cli-connect` (or the region you pick) in your browser.
2. You sign in if needed and choose the organization to connect.
3. The dashboard sends your organization API key back to the CLI on the loopback callback. The key is stored in `~/.config/add-sg-mcp/credentials.json` (mode `0600`).
4. The CLI writes the server entry into each selected agent's own config file:

   ```json
   {
     "mcpServers": {
       "stackguardian": {
         "type": "http",
         "url": "https://api.app.stackguardian.io/api/v1/orgs/<org>/mcp/",
         "headers": { "Authorization": "apikey sgu_…" }
       }
     }
   }
   ```

   (Codex gets the TOML equivalent, Goose YAML, and so on — each agent's native format.)

5. The skills are copied to `~/.agents/skills/` and symlinked into each agent's skills directory (`~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, …), so a single copy serves every agent.

Restart your agents afterwards. In Claude Code, `/mcp` lists the server and the skills appear as `/sg-create-workflow`, `/sg-update-workflow` and `/sg-upgrade-workflow`.

## Options

```
npx add-sg-mcp [options]

  --region <eu|us|qa>        StackGuardian region (prompted when omitted)
  --org <org>                Organization to connect (pre-selected in the browser)
  -a, --agent <agent>        Agents to install to (repeatable; default: the ones detected)
  --all                      Every supported agent
  -y, --yes                  No prompts (installs to all detected agents)
  --project                  Project scope (current directory) instead of your user profile;
                             the generated files are added to .gitignore
  -n, --name <name>          Server entry name (default: stackguardian)
  --skip-skills              Do not install the skills
  --no-browser               Print the sign-in link instead of opening a browser
  --login-timeout <seconds>  How long to wait for the browser (default 300)
  --dashboard-url <url>      Another dashboard (other environments, local dev)
```

Other commands:

| Command                                          | What it does                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `npx add-sg-mcp login`                           | Sign in again (switch organization or region) without touching agent configs   |
| `npx add-sg-mcp status`                          | Show the saved credential (masked) and which agents have the server and skills |
| `npx add-sg-mcp remove [-a <agent>] [--project]` | Remove the server entry and the skills from your agents                        |
| `npx add-sg-mcp logout [--purge]`                | Forget the credential; `--purge` also runs `remove`                            |
| `npx add-sg-mcp list-agents`                     | List supported agents and their config files                                   |

### Headless / CI

Skip the browser with an API key from **Profile → API keys** in the dashboard:

```bash
npx add-sg-mcp --token sgu_… --org my-org --region eu -y --all
# or
SG_API_KEY=sgu_… SG_ORG=my-org SG_REGION=eu npx add-sg-mcp -y -a claude-code
```

`--api-base https://…/api/v1` replaces `--region` for non-standard environments.

### Several organizations

Each server entry points at one organization. To keep two side by side, name the second one:

```bash
npx add-sg-mcp login --org other-org --region eu
npx add-sg-mcp --name stackguardian-other -a claude-code
```

### OAuth (preview)

`npx add-sg-mcp --auth oauth --org my-org --region eu` writes the server URL without a credential for agents that implement MCP OAuth themselves (Claude Code, VS Code, Cursor, Codex, Gemini CLI, Windsurf). The agent then signs you in on first use. This needs the StackGuardian OAuth broker to be enabled for your environment.

## Notes per agent

- **Codex** and **Grok Build** store MCP servers in a TOML file that is rewritten as a whole; comments in `~/.codex/config.toml` are not preserved.
- **Claude Desktop** and **fx** are skipped: Claude Desktop only supports local (stdio) servers here and fx only sends bearer tokens. Add StackGuardian to Claude Desktop through _Settings → Connectors_ instead.
- **Claude Code** and **GitHub Copilot CLI** share `.mcp.json` in project scope.
- Mastra Code and MCPorter get the server but have no skills directory.

## Security

- The credential is your **user API key for the selected organization**: it acts as you, with your roles, and it does not expire on its own. Rotate it from _Profile → API keys_ in the dashboard if a machine is lost; `logout` only deletes the local copy.
- By default nothing is written into project directories. `--project` warns and adds the generated files to `.gitignore`.
- The CLI accepts a callback only when its one-time `state` matches, and only API hosts under `stackguardian.io` (or the host you passed with `--dashboard-url`).
- `status` never prints the key; the callback page strips the key from the browser history.

## Development

```bash
bun install
bun run dev -- --help          # run from source
bun run typecheck && bun run test
```

Tests are plain `tsx` scripts with `node:assert` (no mocks; the login test spins up a real loopback server), run by `tests/run.mjs` under a throwaway `HOME`. See `AGENTS.md` for the workflow and `docs/superpowers/specs/` for the design.

This project is a fork of [neon-solutions/add-mcp](https://github.com/neon-solutions/add-mcp) (Apache-2.0); the agent config writers come from upstream unchanged. Passing a URL or package name as the first argument still installs any other MCP server the way `add-mcp` does.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
