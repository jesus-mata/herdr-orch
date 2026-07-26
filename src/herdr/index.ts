export { HerdrClient } from './client.ts';
export type {
  CreateTabOptions,
  CreateWorktreeWorkspaceOptions,
  CreatedTab,
  HerdrClientOptions,
  Pong,
  PromptAgentOptions,
  ReadPaneOptions,
  SplitPaneOptions,
  StartAgentOptions,
  WaitForAgentOptions,
  WorktreeWorkspace,
} from './client.ts';

export { AgentStatusWatcher } from './agent-status-watcher.ts';
export type { AgentStatusWatcherOptions, ReconnectPolicy } from './agent-status-watcher.ts';

export { HerdrRequestTransport } from './transport.ts';
export type { HerdrRequestTransportOptions, SendOptions } from './transport.ts';

export { resolveSocketPath } from './socket-path.ts';
export type { SocketPathEnv, SocketPathOptions } from './socket-path.ts';

export { NdjsonDecoder } from './framing.ts';
export { HerdrConnection } from './connection.ts';

export {
  HerdrError,
  HerdrConnectionError,
  HerdrProtocolError,
  HerdrRequestError,
  HerdrTimeoutError,
} from './errors.ts';

export {
  BLOCKED_AGENT_STATUS,
  HERDR_PROTOCOL_VERSION,
  SETTLED_AGENT_STATUSES,
  isAgentStatus,
  toAgentStatusChange,
} from './protocol.ts';
export type {
  AgentInfo,
  AgentStatus,
  AgentStatusChange,
  PaneInfo,
  PaneReadResult,
  ReadSource,
  SessionSnapshot,
  TabInfo,
  WorkspaceInfo,
  WorktreeInfo,
} from './protocol.ts';
