import type {
  CreateTabOptions,
  CreateWorktreeWorkspaceOptions,
  CreatedTab,
  PromptAgentOptions,
  StartAgentOptions,
  WorktreeWorkspace,
} from './client.ts';
import type { AgentInfo } from './protocol.ts';

/**
 * The slice of herdr the Orchestrator drives.
 *
 * `HerdrClient` implements this; the tests substitute a scripted agent that
 * performs a Worker's real side effects in a real temporary repository. The port
 * exists so that substitution is a type-checked fact rather than a convention,
 * and so the surface a Run depends on stays visible and small: the wider client
 * also speaks framing, correlation and subscriptions, none of which a Run knows
 * about.
 *
 * Everything here is named as herdr names it, because this is herdr's contract,
 * not the Orchestrator's vocabulary.
 */
export interface HerdrApi {
  /** One [[Run]]: a worktree, its branch, and the workspace opened on it. */
  createWorktreeWorkspace(options: CreateWorktreeWorkspaceOptions): Promise<WorktreeWorkspace>;
  /** One [[Ticket]]: a tab inside the Run's workspace. */
  createTab(options?: CreateTabOptions): Promise<CreatedTab>;
  /**
   * Labels a [[Worker]]'s pane. Every Worker pane carries the Orchestrator's
   * prefix so that agents orphaned by a crash can be found and stopped.
   */
  renamePane(paneId: string, label: string | undefined): Promise<void>;
  /** One [[Phase]]: a fresh Worker in its own pane. */
  startAgent(options: StartAgentOptions): Promise<AgentInfo>;
  /**
   * Prompts a Worker and waits for it to settle. The returned `agent_status` is
   * [[Liveness]], not outcome — `done` says only that it stopped talking.
   */
  promptAgent(options: PromptAgentOptions): Promise<AgentInfo>;
}
