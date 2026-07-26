import type { StubConnection, StubHandler } from './stub-server.ts';

export interface StubPane {
  pane_id: string;
  workspace_id: string;
  agent_status: string;
}

export interface HerdrStub {
  readonly handler: StubHandler;
  /** Panes `session.snapshot` will report. Tests mutate this directly. */
  readonly panes: Map<string, StubPane>;
  /** The connection currently holding an event subscription, if any. */
  subscriptionConnection(): StubConnection | undefined;
  /** The `subscriptions` array of the newest `events.subscribe`. */
  subscriptions(): Record<string, unknown>[];
  /** How many `events.subscribe` requests have been served. */
  subscribeCount(): number;
  /** Pushes a pane agent status change down the subscription connection. */
  emitStatusChange(pane: StubPane, extra?: Record<string, unknown>): void;
}

/**
 * A stub that behaves like herdr 0.7.5 on the two points that shape the client:
 * an ordinary request is answered once and the connection is then closed, and an
 * `events.subscribe` connection stays open to stream events instead.
 */
export function createHerdrStub(panes: StubPane[] = []): HerdrStub {
  const paneMap = new Map(panes.map((pane) => [pane.pane_id, pane]));
  let subscriptionConnection: StubConnection | undefined;
  let subscriptions: Record<string, unknown>[] = [];
  let subscribeCount = 0;

  const handler: StubHandler = (connection, message) => {
    const method = message['method'];
    const id = message['id'];
    const params = (message['params'] ?? {}) as Record<string, unknown>;

    if (method === 'events.subscribe') {
      subscribeCount += 1;
      subscriptions = (params['subscriptions'] ?? []) as Record<string, unknown>[];
      subscriptionConnection = connection;
      connection.send({ id, result: { type: 'subscription_started' } });
      return; // Stays open: this connection is now an event stream.
    }

    if (method === 'session.snapshot') {
      connection.send({
        id,
        result: {
          type: 'session_snapshot',
          snapshot: {
            version: '0.7.5',
            protocol: 17,
            workspaces: [],
            tabs: [],
            panes: [...paneMap.values()],
            layouts: [],
            agents: [],
          },
        },
      });
      connection.end();
      return;
    }

    connection.send({ id, result: { type: 'ok' } });
    connection.end();
  };

  return {
    handler,
    panes: paneMap,
    subscriptionConnection: () => subscriptionConnection,
    subscriptions: () => subscriptions,
    subscribeCount: () => subscribeCount,
    emitStatusChange: (pane, extra = {}) => {
      paneMap.set(pane.pane_id, pane);
      subscriptionConnection?.send({
        event: 'pane.agent_status_changed',
        data: {
          pane_id: pane.pane_id,
          workspace_id: pane.workspace_id,
          agent_status: pane.agent_status,
          state_labels: {},
          ...extra,
        },
      });
    },
  };
}
