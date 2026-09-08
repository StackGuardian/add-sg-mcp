import type { AgentType } from "../types.js";
import type { InstallScope } from "../agents.js";
import type { InstallResult } from "../installer.js";

/** What upstream's install flow (`main` in src/index.ts) wrote, so the skills step can follow it. */
export interface InstallOutcome {
  serverName: string;
  targetAgents: AgentType[];
  routing: Map<AgentType, InstallScope>;
  results: Map<AgentType, InstallResult>;
}

/** The subset of upstream's CLI options the StackGuardian flow hands to `main`. */
export interface MainOptions {
  global?: boolean;
  local?: boolean;
  agent?: string[];
  name?: string;
  transport?: string;
  header?: string[];
  yes?: boolean;
  all?: boolean;
  gitignore?: boolean;
  noLogo?: boolean;
}
