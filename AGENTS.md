# add-sg-mcp

A CLI that connects coding agents (Claude Code, Codex, Cursor, VS Code, Gemini CLI, OpenCode and more) to the StackGuardian MCP server and installs the StackGuardian skills. Fork of `neon-solutions/add-mcp` 2.4.0.

## Layout

- `src/sg/` — everything StackGuardian-specific: `preset.ts` (URLs, header, validation), `credentials.ts` (credential store), `auth.ts` (loopback browser login), `skills.ts` (skills installer), `commands.ts` (Commander wiring for the default connect flow, `login`, `logout`, `status`, `remove`), `types.ts`.
- `src/agents.ts`, `src/installer.ts`, `src/formats/*`, `src/schema.ts`, `src/reader.ts`, `src/opencode-config.ts`, `src/source-parser.ts`, `src/template.ts` — upstream, kept byte-identical so `git merge upstream/main` stays cheap. Do not put StackGuardian logic there.
- `src/index.ts` — the bin. Upstream's `main()` install flow plus the registration of the `sg` commands (`registerSgCommands`, dependencies injected to avoid an import cycle).
- `skills/` — the bundled `SKILL.md` folders shipped in the npm package.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design and implementation plan.

## Dev environment

- Use bun as package manager and to run package.json scripts.
- [Fallow](https://github.com/fallow-rs/fallow) is a local dev dependency (`bun run fallow`). It reports unused code, duplication, and complexity; fix what matters locally and ignore noise when appropriate. It does not run in GitHub Actions.

## Changelog

`CHANGELOG.md` is for **user-facing** changes only. Add an entry in the same tone as existing ones and bump `package.json` per semver.

## Dev and PR workflow

1. **Branch from up-to-date `main`** — `git checkout main && git pull`.
2. **Implement the change** — keep the diff focused; match existing style and patterns. StackGuardian changes go in `src/sg/`.
3. **Tests** — prefer **unit tests without mocks** and **e2e tests without mocks** (hand-rolled `test()` + `node:assert`, run with `tsx`). Every new test file must be added to the `test`/`test:unit`/`test:e2e` scripts in `package.json` — there is no glob.
4. **Typecheck** — `bun run typecheck`.
5. **Tests** — `bun run test`.
6. **Quality pass** — `bun run fmt`, then `bun run build`, `bun run typecheck`, `bun run test`.
7. **Fallow** — `bun run fallow -- --summary`; address findings that are clearly worth it.
8. **Release notes** — user-facing change → `CHANGELOG.md` entry + version bump.
9. **README** — update only if end users need to know.
10. **PR** — push your branch and open a pull request against `main`.

## Releasing

Through GitHub Actions with npm Trusted Publishing; see [docs/RELEASING.md](docs/RELEASING.md). No `npm publish` from a laptop.
