/**
 * The slice of herdr's socket API the Orchestrator uses, as types.
 *
 * Taken from the bundled schema of herdr 0.7.5 (`herdr api schema`), protocol
 * 17. Only the methods and fields in use are modelled; herdr's API is much
 * wider, and typing all of it would be a maintenance cost with no reader.
 */

export const HERDR_PROTOCOL_VERSION = 17;

/**
 * herdr's own observation of a pane's agent. Liveness, not outcome: a Worker
 * that crashed, refused the task or hallucinated success all reach `done`.
 */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

/**
 * The states that mean a Worker has stopped producing and is waiting on us.
 *
 * `blocked` belongs here and its absence is a bug, not a tuning choice: a Worker
 * stopped at a permission prompt never reaches `done`, so waiting on the
 * finished states alone burns the Phase's entire timeout on a dialog nobody is
 * going to answer.
 */
export const SETTLED_AGENT_STATUSES: readonly AgentStatus[] = ['idle', 'done', 'blocked'];

/** The state a Worker is in when it is stopped, waiting for a human. */
export const BLOCKED_AGENT_STATUS: AgentStatus = 'blocked';

export interface PaneInfo {
  readonly pane_id: string;
  readonly terminal_id: string;
  readonly workspace_id: string;
  readonly tab_id: string;
  readonly focused: boolean;
  readonly agent_status: AgentStatus;
  readonly revision: number;
  readonly agent?: string | null;
  readonly display_agent?: string | null;
  readonly cwd?: string | null;
  readonly label?: string | null;
  readonly title?: string | null;
  readonly state_labels?: Record<string, string>;
}

export interface TabInfo {
  readonly tab_id: string;
  readonly workspace_id: string;
  readonly number?: number;
  readonly label?: string | null;
  readonly focused?: boolean;
  readonly pane_count?: number;
  readonly agent_status?: AgentStatus;
}

export interface WorkspaceInfo {
  readonly workspace_id: string;
  readonly label?: string | null;
  readonly tab_count?: number;
  readonly active_tab_id?: string | null;
}

export interface WorktreeInfo {
  readonly path: string;
  readonly branch?: string | null;
  readonly is_prunable?: boolean;
  readonly is_linked_worktree?: boolean;
  readonly open_workspace_id?: string | null;
}

export interface AgentInfo {
  readonly pane_id: string;
  readonly terminal_id: string;
  readonly workspace_id: string;
  readonly tab_id: string;
  readonly focused: boolean;
  readonly agent_status: AgentStatus;
  readonly revision: number;
  readonly name?: string | null;
  readonly agent?: string | null;
  readonly display_agent?: string | null;
  readonly interactive_ready?: boolean;
  readonly launch_pending?: boolean;
  readonly title?: string | null;
  readonly state_labels?: Record<string, string>;
}

export interface SessionSnapshot {
  readonly version: string;
  readonly protocol: number;
  readonly workspaces: readonly WorkspaceInfo[];
  readonly tabs: readonly TabInfo[];
  readonly panes: readonly PaneInfo[];
  readonly agents: readonly AgentInfo[];
  readonly focused_workspace_id?: string | null;
  readonly focused_tab_id?: string | null;
  readonly focused_pane_id?: string | null;
}

export type ReadSource = 'visible' | 'recent' | 'recent_unwrapped' | 'detection';

export interface PaneReadResult {
  readonly pane_id: string;
  readonly workspace_id: string;
  readonly tab_id: string;
  readonly source: ReadSource;
  readonly format: 'text' | 'ansi';
  readonly text: string;
  readonly revision: number;
  readonly truncated: boolean;
}

/**
 * A pane's agent status changing, as delivered to a caller.
 *
 * Named in the Orchestrator's terms rather than herdr's wire names, because this
 * crosses out of the client and everything above it speaks camelCase.
 */
export interface AgentStatusChange {
  readonly paneId: string;
  readonly workspaceId: string;
  readonly status: AgentStatus;
  readonly agent: string | undefined;
  readonly displayAgent: string | undefined;
  readonly title: string | undefined;
  readonly stateLabels: Record<string, string>;
}

/** herdr's wire form of a subscribed pane agent status change. */
export interface PaneAgentStatusChangedEvent {
  readonly pane_id: string;
  readonly workspace_id: string;
  readonly agent_status: AgentStatus;
  readonly agent?: string | null;
  readonly display_agent?: string | null;
  readonly title?: string | null;
  readonly state_labels?: Record<string, string>;
}

export const AGENT_STATUS_CHANGED_EVENT = 'pane.agent_status_changed';

const AGENT_STATUSES = new Set<string>(['idle', 'working', 'blocked', 'done', 'unknown']);

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && AGENT_STATUSES.has(value);
}

export function toAgentStatusChange(event: PaneAgentStatusChangedEvent): AgentStatusChange {
  return {
    paneId: event.pane_id,
    workspaceId: event.workspace_id,
    status: event.agent_status,
    agent: event.agent ?? undefined,
    displayAgent: event.display_agent ?? undefined,
    title: event.title ?? undefined,
    stateLabels: event.state_labels ?? {},
  };
}
