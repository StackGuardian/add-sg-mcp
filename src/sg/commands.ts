import * as p from "@clack/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import type { AgentType } from "../types.js";
import {
  agents,
  buildAgentSelectionChoices,
  detectGlobalAgents,
  detectProjectAgents,
  getAgentTypes,
  type InstallScope,
} from "../agents.js";
import { getLastSelectedAgents, saveSelectedAgents } from "../config.js";
import { listInstalledServers } from "../reader.js";
import { removeServer } from "../lib.js";
import {
  OAUTH_CAPABLE_AGENTS,
  PRESET_EXCLUDED_AGENTS,
  SG_ENVIRONMENTS,
  SG_SERVER_NAME_PREFIX,
  isStackGuardianServer,
  serverNameForOrg,
  buildAuthHeader,
  buildMcpUrl,
  environmentForRegion,
  isAllowedApiBase,
  isValidApiKey,
  isValidOrg,
  maskKey,
  normalizeApiBase,
} from "./preset.js";
import {
  deleteCredentials,
  getCredentialsPath,
  isExpired,
  readCredentials,
  writeCredentials,
  type SgCredentials,
} from "./credentials.js";
import { LoginError, loginViaBrowser } from "./auth.js";
import { loginViaGrant } from "./oauth.js";
import {
  SG_SKILL_NAMES,
  installSkills,
  removeSkills,
  skillsStatus,
} from "./skills.js";
import type { InstallOutcome, MainOptions } from "./types.js";

export interface SgAuthOptions {
  region?: string;
  dashboardUrl?: string;
  org?: string;
  token?: string;
  apiBase?: string;
  /** Commander sets this to false for --no-browser. */
  browser?: boolean;
  loginTimeout?: string;
}

export interface SgInstallOptions {
  agent?: string[];
  all?: boolean;
  yes?: boolean;
  project?: boolean;
  global?: boolean;
  name?: string;
  gitignore?: boolean;
  skipSkills?: boolean;
  auth?: string;
}

export type SgConnectOptions = SgAuthOptions & SgInstallOptions;

export interface SgCommandDeps {
  main: (
    target: string | undefined,
    options: MainOptions,
  ) => Promise<InstallOutcome | undefined>;
  resolveAgentFlags: (flags?: string[]) => AgentType[];
  collect: (value: string, previous: string[]) => string[];
  showLogo: () => void;
}

/** Empty environment variables count as unset. */
function envVar(name: string): string | undefined {
  return process.env[name] || undefined;
}

function isInteractive(): boolean {
  return Boolean(
    process.stdout.isTTY && process.stdin.isTTY && !process.env.CI,
  );
}

function fail(message: string, hint?: string): never {
  p.log.error(message);
  if (hint) p.log.info(hint);
  process.exit(1);
}

function serverUrl(config: Record<string, unknown>): string {
  for (const key of ["url", "serverUrl", "uri"]) {
    const value = config[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function shortenHome(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** `expires <date>`, `expired <date>`, `no expiry`, or `invalid expiry`. */
function grantValidity(credentials: SgCredentials): string {
  if (!credentials.expiresAt) return "no expiry";
  const at = Date.parse(credentials.expiresAt);
  if (!Number.isFinite(at)) return "invalid expiry";
  return `${isExpired(credentials) ? "expired" : "expires"} ${new Date(at).toLocaleString()}`;
}

async function chooseRegion(): Promise<string> {
  const choice = await p.select({
    message: "Where is your StackGuardian account?",
    options: SG_ENVIRONMENTS.filter((env) => env.id !== "qa").map((env) => ({
      value: env.id,
      label: env.label,
    })),
  });
  if (p.isCancel(choice)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return choice as string;
}

/** Dashboard URL for the login page plus the API hosts accepted from its callback. */
async function resolveDashboard(
  options: SgAuthOptions,
): Promise<{ dashboardUrl: string; allowedApiHosts: string[] }> {
  if (options.dashboardUrl) {
    let url: URL;
    try {
      url = new URL(options.dashboardUrl);
    } catch {
      return fail(`--dashboard-url is not a URL: ${options.dashboardUrl}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return fail("--dashboard-url must be http(s)");
    }
    return {
      dashboardUrl: url.origin,
      allowedApiHosts: [url.hostname, "localhost", "127.0.0.1"],
    };
  }
  const region =
    options.region ??
    envVar("SG_REGION") ??
    (isInteractive()
      ? await chooseRegion()
      : fail(
          "Pass --region eu|us (or --dashboard-url) when running without a terminal.",
        ));
  const env = environmentForRegion(region);
  if (!env) {
    return fail(
      `Unknown region "${region}". Use eu, us or qa (or --dashboard-url for another environment).`,
    );
  }
  return { dashboardUrl: env.dashboardUrl, allowedApiHosts: [] };
}

async function credentialsFromToken(
  options: SgAuthOptions,
  token: string,
): Promise<SgCredentials> {
  if (!isValidApiKey(token)) {
    fail("The token does not look like a StackGuardian API key.");
  }
  const org = options.org ?? envVar("SG_ORG");
  if (!org) fail("--org is required with --token (or set SG_ORG).");
  if (!isValidOrg(org)) fail(`Invalid organization name: ${org}`);
  let apiBase = options.apiBase ?? envVar("SG_API_BASE");
  let dashboardUrl = options.dashboardUrl ?? "";
  if (!apiBase) {
    const region = options.region ?? envVar("SG_REGION");
    if (!region) {
      fail("Pass --api-base or --region with --token.");
    }
    const env = environmentForRegion(region);
    if (!env) fail(`Unknown region "${region}". Use eu, us or qa.`);
    apiBase = env.apiBase;
    dashboardUrl = dashboardUrl || env.dashboardUrl;
  } else if (!isAllowedApiBase(apiBase, ["localhost", "127.0.0.1"])) {
    fail(
      `--api-base must be an https StackGuardian host, got ${apiBase}`,
      "Example: --api-base https://api.app.stackguardian.io/api/v1",
    );
  }
  const credentials: SgCredentials = {
    apiBase: normalizeApiBase(apiBase),
    dashboardUrl,
    org,
    obtainedAt: new Date().toISOString(),
    authType: "apikey",
    apiKey: token,
  };
  const path = writeCredentials(credentials);
  p.log.success(
    `Saved credentials for ${chalk.cyan(org)} to ${shortenHome(path)}`,
  );
  return credentials;
}

async function credentialsFromBrowser(
  options: SgAuthOptions,
): Promise<SgCredentials> {
  const { dashboardUrl, allowedApiHosts } = await resolveDashboard(options);
  if (options.org && !isValidOrg(options.org)) {
    fail(`Invalid organization name: ${options.org}`);
  }
  const timeoutSeconds = Number(options.loginTimeout ?? "300");
  const spinner = p.spinner();
  let result;
  try {
    result = await loginViaBrowser({
      dashboardUrl,
      org: options.org,
      allowedApiHosts,
      timeoutMs:
        (Number.isFinite(timeoutSeconds) ? timeoutSeconds : 300) * 1000,
      openBrowser: options.browser === false ? async () => false : undefined,
      onAuthUrl: (url) => {
        p.log.step(
          options.browser === false
            ? "Open this link in your browser to sign in:"
            : "Opening your browser to sign in to StackGuardian…",
        );
        p.log.message(chalk.cyan(url));
        if (options.browser !== false) {
          p.log.info("If the browser does not open, paste the link yourself.");
        }
        spinner.start(
          "Waiting for you to choose an organization in the browser…",
        );
      },
    });
  } catch (error) {
    spinner.stop("Sign-in did not complete");
    if (error instanceof LoginError && error.code === "cancelled") {
      fail("Cancelled in the browser.");
    }
    if (error instanceof LoginError) {
      fail(
        error.message,
        "Run again, or sign in without a browser: add-sg-mcp login --token <api-key> --org <org> --region eu|us",
      );
    }
    throw error;
  }
  spinner.stop(`Signed in · organization ${chalk.cyan(result.org)}`);
  const credentials: SgCredentials = {
    apiBase: result.apiBase,
    dashboardUrl,
    org: result.org,
    obtainedAt: new Date().toISOString(),
    authType: "apikey",
    apiKey: result.apiKey,
  };
  const path = writeCredentials(credentials);
  p.log.info(`Credentials saved to ${shortenHome(path)}`);
  return credentials;
}

/** Both URLs must be known before the browser opens, so --dashboard-url needs --api-base. */
async function resolveGrantEnvironment(
  options: SgAuthOptions,
): Promise<{ apiBase: string; dashboardUrl: string }> {
  const { dashboardUrl } = await resolveDashboard(options);
  const apiBase = options.apiBase ?? envVar("SG_API_BASE");
  if (apiBase) {
    if (!isAllowedApiBase(apiBase, ["localhost", "127.0.0.1"])) {
      fail(`--api-base must be an https StackGuardian host, got ${apiBase}`);
    }
    return { apiBase: normalizeApiBase(apiBase), dashboardUrl };
  }
  const env = SG_ENVIRONMENTS.find((e) => e.dashboardUrl === dashboardUrl);
  if (!env) {
    fail("Pass --api-base together with --dashboard-url for --auth grant.");
  }
  return { apiBase: env.apiBase, dashboardUrl };
}

/** A grant token from the StackGuardian OAuth broker (authorization code + PKCE). */
async function credentialsFromGrant(
  options: SgAuthOptions,
  forceLogin = false,
): Promise<SgCredentials> {
  if (options.token ?? envVar("SG_API_KEY")) {
    fail(
      "--token (or SG_API_KEY) cannot be used with --auth grant.",
      "Drop it to approve a grant in the browser, or pass --auth apikey to use the key.",
    );
  }
  if (options.org && !isValidOrg(options.org)) {
    fail(`Invalid organization name: ${options.org}`);
  }
  const { apiBase, dashboardUrl } = await resolveGrantEnvironment(options);
  const saved = forceLogin ? null : readCredentials();
  if (
    saved &&
    saved.authType === "grant" &&
    !isExpired(saved) &&
    saved.apiBase === apiBase &&
    (!options.org || options.org === saved.org)
  ) {
    p.log.info(
      `Using the saved grant for ${chalk.cyan(saved.org)} (${saved.dashboardUrl || saved.apiBase}). Run ${chalk.cyan("add-sg-mcp logout")} first to request a new one.`,
    );
    return saved;
  }

  const timeoutSeconds = Number(options.loginTimeout ?? "300");
  const spinner = p.spinner();
  let result;
  try {
    result = await loginViaGrant({
      apiBase,
      dashboardUrl,
      org: options.org,
      timeoutMs:
        (Number.isFinite(timeoutSeconds) ? timeoutSeconds : 300) * 1000,
      openBrowser: options.browser === false ? async () => false : undefined,
      onAuthUrl: (url) => {
        p.log.step(
          options.browser === false
            ? "Open this link in your browser to approve the access:"
            : "Opening your browser to approve access for this machine…",
        );
        p.log.message(chalk.cyan(url));
        if (options.browser !== false) {
          p.log.info("If the browser does not open, paste the link yourself.");
        }
        spinner.start(
          "Waiting for you to choose an organization, roles and expiry in the browser…",
        );
      },
    });
  } catch (error) {
    spinner.stop("The grant was not issued");
    if (error instanceof LoginError && error.code === "cancelled") {
      fail("Cancelled in the browser.");
    }
    fail(
      error instanceof Error ? error.message : String(error),
      "Run again, or use an API key instead: add-sg-mcp --auth apikey",
    );
  }
  spinner.stop(
    `Access granted · organization ${chalk.cyan(result.org)}${result.roles.length > 0 ? ` · roles ${result.roles.join(", ")}` : ""}`,
  );
  const credentials: SgCredentials = {
    apiBase,
    dashboardUrl,
    org: result.org,
    obtainedAt: new Date().toISOString(),
    authType: "grant",
    accessToken: result.accessToken,
    expiresAt:
      typeof result.expiresIn === "number"
        ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
        : null,
  };
  const path = writeCredentials(credentials);
  p.log.info(`Credentials saved to ${shortenHome(path)}`);
  return credentials;
}

/**
 * Order: explicit token → saved credentials (unless the caller asks for a
 * different org/environment or `forceLogin`) → browser login.
 */
export async function resolveCredentials(
  options: SgAuthOptions,
  forceLogin = false,
): Promise<SgCredentials> {
  const token = options.token ?? envVar("SG_API_KEY");
  if (token) return credentialsFromToken(options, token);

  // A grant belongs to --auth grant: apikey mode signs in for its own key.
  const saved = readCredentials();
  if (!forceLogin && saved?.authType === "apikey" && !isExpired(saved)) {
    let requestedOrigin: string | undefined;
    if (options.dashboardUrl) {
      try {
        requestedOrigin = new URL(options.dashboardUrl).origin;
      } catch {
        fail(`--dashboard-url is not a URL: ${options.dashboardUrl}`);
      }
    }
    const orgMatches = !options.org || options.org === saved.org;
    const envMatches =
      (!options.region ||
        environmentForRegion(options.region)?.dashboardUrl ===
          saved.dashboardUrl) &&
      (!requestedOrigin || requestedOrigin === saved.dashboardUrl);
    if (orgMatches && envMatches) {
      p.log.info(
        `Using saved credentials for ${chalk.cyan(saved.org)} (${saved.dashboardUrl || saved.apiBase}). Run ${chalk.cyan("add-sg-mcp login")} to switch.`,
      );
      return saved;
    }
  }
  if (saved?.authType === "grant" && !isExpired(saved)) {
    p.log.warn(
      `The saved grant for ${chalk.cyan(saved.org)} will be replaced; it stays active until you revoke it from Profile → Connected apps.`,
    );
  }
  return credentialsFromBrowser(options);
}

function scopeOf(options: SgInstallOptions): InstallScope {
  return options.project ? "local" : "global";
}

/** Agents for the preset: explicit flags, everything, or an interactive/detected pick — never the excluded ones. */
async function chooseAgents(
  options: SgInstallOptions,
  deps: SgCommandDeps,
  allowed: AgentType[],
): Promise<AgentType[]> {
  const excludedNames = PRESET_EXCLUDED_AGENTS.map(
    (a) => agents[a].displayName,
  ).join(", ");
  if (options.agent && options.agent.length > 0) {
    const requested = deps.resolveAgentFlags(options.agent);
    const dropped = requested.filter((a) => !allowed.includes(a));
    if (dropped.length > 0) {
      p.log.warn(
        `Skipping ${dropped.map((a) => agents[a].displayName).join(", ")}: not supported by the StackGuardian preset (${excludedNames} cannot use an API-key header).`,
      );
    }
    const kept = requested.filter((a) => allowed.includes(a));
    if (kept.length === 0) fail("No supported agents selected.");
    return kept;
  }
  if (options.all) return allowed;

  const scope = scopeOf(options);
  const detected = (
    scope === "global" ? await detectGlobalAgents() : detectProjectAgents()
  ).filter((a) => allowed.includes(a));

  if (options.yes || !isInteractive()) {
    if (detected.length === 0) {
      fail(
        "No coding agents detected on this machine.",
        "Pass -a <agent> (see list-agents) or --all.",
      );
    }
    p.log.info(
      `Installing to detected agents: ${detected.map((a) => agents[a].displayName).join(", ")}`,
    );
    return detected;
  }

  const routing = new Map<AgentType, InstallScope>();
  for (const a of allowed) routing.set(a, scope);
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // ignore
  }
  const { choices, initialValues } = buildAgentSelectionChoices({
    availableAgents: allowed,
    detectedAgents: detected,
    agentRouting: routing,
    lastSelected,
  });
  const selected = await p.multiselect({
    message: "Which coding agents should get the StackGuardian server?",
    options: choices,
    required: true,
    initialValues: initialValues.length > 0 ? initialValues : detected,
  });
  if (p.isCancel(selected)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  const picked = selected as AgentType[];
  try {
    await saveSelectedAgents(picked);
  } catch {
    // best effort
  }
  return picked;
}

function reportSkills(
  results: ReturnType<typeof installSkills>,
  scope: InstallScope,
): void {
  const byAgent = new Map<AgentType, ReturnType<typeof installSkills>>();
  for (const r of results) {
    const list = byAgent.get(r.agent) ?? [];
    list.push(r);
    byAgent.set(r.agent, list);
  }
  const lines: string[] = [];
  for (const [agent, list] of byAgent) {
    const ok = list.filter((r) => !r.error && r.mode !== "skipped");
    const errors = list.filter((r) => r.error);
    const skipped = list.filter((r) => !r.error && r.mode === "skipped");
    const name = agents[agent].displayName;
    if (ok.length > 0) {
      const where = ok[0]!.linkPath ?? ok[0]!.canonicalPath;
      const dir = where.slice(0, where.lastIndexOf("/"));
      lines.push(
        `${chalk.green("✓")} ${name}: ${ok.length} skills → ${chalk.dim(shortenHome(dir))}${ok.some((r) => r.mode === "copy") ? chalk.dim(" (copied)") : ""}`,
      );
    } else if (skipped.length === list.length) {
      lines.push(
        `${chalk.dim("–")} ${name}: no skills directory for this agent`,
      );
    }
    for (const r of errors) {
      lines.push(
        `${chalk.red("✗")} ${name}: ${r.skill}: ${chalk.dim(r.error)}`,
      );
    }
  }
  if (lines.length > 0) {
    p.note(
      lines.join("\n"),
      `Skills (${scope === "global" ? "user" : "project"} scope)`,
    );
  }
}

export async function runConnect(
  options: SgConnectOptions,
  deps: SgCommandDeps,
): Promise<void> {
  deps.showLogo();
  console.log();
  const auth = (options.auth ?? "apikey").toLowerCase();
  if (auth !== "apikey" && auth !== "grant" && auth !== "oauth") {
    fail(`--auth must be apikey, grant or oauth, got ${options.auth}`);
  }
  if (options.project) {
    p.log.warn(
      "Project scope writes the credential into files in this directory; they will be added to .gitignore.",
    );
  }

  let apiBase: string;
  let org: string;
  let headers: string[] = [];
  let allowed: AgentType[];

  if (auth === "oauth") {
    p.log.info(
      "OAuth mode (preview): no credential is stored; each agent signs in through the StackGuardian OAuth broker on first use.",
    );
    const orgInput =
      options.org ??
      envVar("SG_ORG") ??
      (isInteractive()
        ? await p.text({
            message: "Organization name",
            validate: (v) =>
              isValidOrg(v) ? undefined : "Letters, digits, - and _ only",
          })
        : fail("Pass --org with --auth oauth."));
    if (p.isCancel(orgInput)) {
      p.cancel("Cancelled");
      process.exit(0);
    }
    org = orgInput as string;
    if (!isValidOrg(org)) fail(`Invalid organization name: ${org}`);
    const region =
      options.region ??
      envVar("SG_REGION") ??
      (isInteractive() ? await chooseRegion() : fail("Pass --region eu|us."));
    const env = environmentForRegion(region);
    if (!env) fail(`Unknown region "${region}".`);
    if (options.apiBase && !isAllowedApiBase(options.apiBase)) {
      fail(
        `--api-base must be an https StackGuardian host, got ${options.apiBase}`,
      );
    }
    apiBase = options.apiBase ?? env.apiBase;
    allowed = OAUTH_CAPABLE_AGENTS.filter(
      (a) => !PRESET_EXCLUDED_AGENTS.includes(a),
    );
  } else {
    const credentials =
      auth === "grant"
        ? await credentialsFromGrant(options)
        : await resolveCredentials(options);
    apiBase = credentials.apiBase;
    org = credentials.org;
    headers = [buildAuthHeader(credentials)];
    allowed = getAgentTypes().filter(
      (a) => !PRESET_EXCLUDED_AGENTS.includes(a),
    );
  }

  const targetAgents = await chooseAgents(options, deps, allowed);
  const url = buildMcpUrl(apiBase, org);
  const outcome = await deps.main(url, {
    name: options.name ?? serverNameForOrg(org),
    transport: "http",
    header: headers,
    agent: targetAgents,
    global: !options.project,
    local: Boolean(options.project),
    yes: options.yes,
    gitignore: Boolean(options.project) || Boolean(options.gitignore),
    noLogo: true,
  });
  if (!outcome) return;

  const installed = [...outcome.results.entries()]
    .filter(([, r]) => r.success)
    .map(([agent]) => agent);
  if (installed.length === 0) return;
  const scope = outcome.routing.get(installed[0]!) ?? scopeOf(options);

  if (!options.skipSkills) {
    const results = installSkills(installed, scope, process.cwd());
    reportSkills(results, scope);
  }

  p.note(
    [
      `Restart your agents to pick up ${chalk.cyan(outcome.serverName)}.`,
      `Claude Code: ${chalk.cyan("/mcp")} lists the server; the skills appear as ${SG_SKILL_NAMES.map((s) => chalk.cyan(`/${s}`)).join(", ")}.`,
      `Check anytime with ${chalk.cyan("add-sg-mcp status")}; remove with ${chalk.cyan("add-sg-mcp remove")}.`,
    ].join("\n"),
    "Next steps",
  );
}

export async function runLogin(
  options: SgConnectOptions,
  deps: SgCommandDeps,
): Promise<void> {
  deps.showLogo();
  console.log();
  const auth = (options.auth ?? "apikey").toLowerCase();
  if (auth === "oauth") {
    fail(
      "login is not needed with --auth oauth: each agent signs in on first use",
    );
  }
  if (auth !== "apikey" && auth !== "grant") {
    fail(`--auth must be apikey, grant or oauth, got ${options.auth}`);
  }
  // login always signs in afresh, so a grant login always asks for consent again.
  const grant = auth === "grant";
  const credentials = grant
    ? await credentialsFromGrant(options, true)
    : await resolveCredentials(options, true);
  p.outro(
    grant
      ? `Grant saved for ${chalk.cyan(credentials.org)}. Run ${chalk.cyan("add-sg-mcp --auth grant")} to install the server and skills.`
      : `Signed in to ${chalk.cyan(credentials.org)}. Run ${chalk.cyan("add-sg-mcp")} to install the server and skills.`,
  );
}

export async function runLogout(
  options: SgInstallOptions & { purge?: boolean },
  deps: SgCommandDeps,
): Promise<void> {
  deps.showLogo();
  console.log();
  const saved = readCredentials();
  const removed = deleteCredentials();
  p.log[removed ? "success" : "info"](
    removed
      ? `Removed ${shortenHome(getCredentialsPath())}`
      : "No saved credentials.",
  );
  if (options.purge) {
    await runRemove({ ...options, yes: true }, deps, false);
  }
  p.outro(
    saved?.authType === "grant"
      ? "The grant stays active until you revoke it from Profile → Connected apps."
      : "The API key itself stays valid; rotate it from Profile → API keys in the dashboard if needed.",
  );
}

export async function runStatus(deps: SgCommandDeps): Promise<void> {
  deps.showLogo();
  console.log();
  const saved = readCredentials();
  if (saved) {
    const grant = saved.authType === "grant";
    const secret = (grant ? saved.accessToken : saved.apiKey) ?? "";
    p.note(
      [
        `Organization: ${saved.org}`,
        `API: ${saved.apiBase}`,
        `Dashboard: ${saved.dashboardUrl || "-"}`,
        `${grant ? "Grant token" : "Key"}: ${maskKey(secret)} (obtained ${saved.obtainedAt})`,
        ...(grant ? [`Validity: ${grantValidity(saved)}`] : []),
        `File: ${shortenHome(getCredentialsPath())}`,
      ].join("\n"),
      "Credentials",
    );
  } else {
    p.log.info("Not signed in. Run add-sg-mcp login.");
  }

  const allAgents = getAgentTypes().filter(
    (a) => !PRESET_EXCLUDED_AGENTS.includes(a),
  );
  const lines: string[] = [];
  for (const scope of ["global", "local"] as InstallScope[]) {
    const servers = await listInstalledServers({
      global: scope === "global",
      agents: allAgents,
      cwd: process.cwd(),
    });
    const skills = skillsStatus(allAgents, scope, process.cwd());
    for (const entry of servers) {
      const match = entry.servers.find((s) =>
        isStackGuardianServer(s.serverName, serverUrl(s.config)),
      );
      const skillCount = skills.get(entry.agentType)?.length ?? 0;
      if (!match && skillCount === 0) continue;
      lines.push(
        `${match ? chalk.green("✓") : chalk.yellow("–")} ${entry.displayName} (${scope === "global" ? "user" : "project"}): ${match ? `${match.serverName} → ${serverUrl(match.config)}` : "no server"}${skillCount > 0 ? chalk.dim(` · ${skillCount} skills`) : ""}`,
      );
    }
  }
  if (lines.length > 0) {
    p.note(lines.join("\n"), "Installed");
  } else {
    p.log.info("The StackGuardian server is not installed in any agent yet.");
  }
  p.outro("Done");
}

export async function runRemove(
  options: SgInstallOptions,
  deps: SgCommandDeps,
  banner = true,
): Promise<void> {
  if (banner) {
    deps.showLogo();
    console.log();
  }
  const scope = scopeOf(options);
  const explicitName = options.name;
  const targets =
    options.agent && options.agent.length > 0
      ? deps.resolveAgentFlags(options.agent)
      : getAgentTypes().filter((a) => !PRESET_EXCLUDED_AGENTS.includes(a));

  if (!options.yes && isInteractive()) {
    const confirmed = await p.confirm({
      message: `Remove ${explicitName ? `the ${explicitName} server` : "the StackGuardian MCP server entries"} and the StackGuardian skills from ${targets.length} agent${targets.length === 1 ? "" : "s"} (${scope === "global" ? "user" : "project"} scope)?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled");
      process.exit(0);
    }
  }

  const lines: string[] = [];
  let failures = 0;
  for (const agent of targets) {
    if (scope === "local" && !agents[agent].localConfigPath) continue;
    // Without --name, remove every entry of ours in this agent (any org, either name generation).
    const names = explicitName
      ? [explicitName]
      : await stackGuardianServerNames(agent, scope);
    for (const name of names) {
      const result = removeServer(agent, name, {
        local: scope === "local",
        cwd: process.cwd(),
      });
      if (!result.success) {
        failures++;
        lines.push(
          `${chalk.red("✗")} ${agents[agent].displayName}: ${chalk.dim(result.error)}`,
        );
      } else if (result.removed) {
        lines.push(
          `${chalk.green("✓")} ${agents[agent].displayName}: removed ${name} from ${chalk.dim(shortenHome(result.path))}`,
        );
      }
    }
  }
  const skills = removeSkills(targets, scope, process.cwd());
  if (skills.removed.length > 0) {
    lines.push(
      `${chalk.green("✓")} skills: removed ${skills.removed.length} entr${skills.removed.length === 1 ? "y" : "ies"}`,
    );
  }
  for (const error of skills.errors) {
    failures++;
    lines.push(`${chalk.red("✗")} skills: ${chalk.dim(error)}`);
  }
  if (lines.length > 0) p.note(lines.join("\n"), "Removed");
  else p.log.info("Nothing to remove.");
  if (failures > 0) process.exitCode = 1;
  if (banner)
    p.outro(failures > 0 ? chalk.yellow("Removed with errors") : "Done");
}

async function stackGuardianServerNames(
  agent: AgentType,
  scope: InstallScope,
): Promise<string[]> {
  const listed = await listInstalledServers({
    global: scope === "global",
    agents: [agent],
    cwd: process.cwd(),
  });
  return listed.flatMap((entry) =>
    entry.servers
      .filter((s) => isStackGuardianServer(s.serverName, serverUrl(s.config)))
      .map((s) => s.serverName),
  );
}

function addAuthOptions(command: Command): Command {
  return command
    .option(
      "--region <eu|us|qa>",
      "StackGuardian region (prompted when omitted)",
    )
    .option(
      "--dashboard-url <url>",
      "Dashboard URL for another environment (e.g. http://localhost:3000)",
    )
    .option(
      "--org <org>",
      "Organization to connect (pre-selected in the browser; required with --token)",
    )
    .option(
      "--token <api-key>",
      "Use this API key instead of signing in through the browser (needs --org and --region or --api-base)",
    )
    .option(
      "--api-base <url>",
      "API base for --token or --auth grant, e.g. https://api.app.stackguardian.io/api/v1",
    )
    .option(
      "--no-browser",
      "Print the sign-in link instead of opening a browser",
    )
    .option(
      "--login-timeout <seconds>",
      "How long to wait for the browser (default 300)",
    );
}

export function registerSgCommands(
  program: Command,
  deps: SgCommandDeps,
): void {
  addAuthOptions(program)
    .option(
      "--project",
      "Install into the current project instead of your user profile (implies --gitignore)",
    )
    .option("--skip-skills", "Do not install the StackGuardian skills")
    .option(
      "--auth <apikey|grant|oauth>",
      "Credential mode; grant asks the browser for a scoped grant token, oauth is a preview for agents with built-in MCP OAuth",
    );

  addAuthOptions(
    program
      .command("login")
      .description(
        "Sign in through the StackGuardian dashboard and save the credential",
      ),
  ).action(async (_options: SgAuthOptions, command: Command) => {
    await runLogin(command.optsWithGlobals() as SgConnectOptions, deps);
  });

  program
    .command("logout")
    .description("Forget the saved credential")
    .option(
      "--purge",
      "Also remove the server entry and skills from every agent",
    )
    .option("--project", "With --purge: project scope instead of user scope")
    .option(
      "-a, --agent <agent>",
      "With --purge: only these agents",
      deps.collect,
      [],
    )
    .action(async (_options: unknown, command: Command) => {
      await runLogout(
        command.optsWithGlobals() as SgInstallOptions & { purge?: boolean },
        deps,
      );
    });

  program
    .command("status")
    .description(
      "Show the saved credential and where the server and skills are installed",
    )
    .action(async () => {
      await runStatus(deps);
    });

  program
    .command("remove")
    .description("Remove the StackGuardian server and skills from your agents")
    .option(
      "-a, --agent <agent>",
      "Only these agents (repeatable)",
      deps.collect,
      [],
    )
    .option("--project", "Project scope instead of user scope")
    .option(
      "-n, --name <name>",
      `Only this server entry (default: every ${SG_SERVER_NAME_PREFIX}-<org> entry)`,
    )
    .option("-y, --yes", "Do not ask for confirmation")
    .action(async (_options: unknown, command: Command) => {
      await runRemove(command.optsWithGlobals() as SgInstallOptions, deps);
    });
}
