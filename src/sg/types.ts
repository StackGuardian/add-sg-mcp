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
