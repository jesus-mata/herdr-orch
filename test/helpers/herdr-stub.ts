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
  /**
   * Renders `session.snapshot` replies as usual but holds the bytes back, which
   * is the window herdr always has between taking a snapshot and it arriving.
   */
  deferSnapshots(): void;
  /** Delivers every held snapshot, as it was rendered when it was requested. */
  releaseSnapshots(): void;
  /** How many rendered snapshots are being held. */
  heldSnapshots(): number;
  /**
   * Accepts `events.subscribe` but withholds the acknowledgement, leaving the
   * client's subscribe genuinely in flight instead of racing it with a timer.
   */
  deferSubscribes(): void;
  /** Acknowledges every held subscription. */
  releaseSubscribes(): void;
  /** How many subscriptions are waiting to be acknowledged. */
  heldSubscribes(): number;
}

interface HeldSnapshot {
  readonly connection: StubConnection;
  readonly id: unknown;
  /** The panes as they were when the request arrived, not as they are now. */
  readonly panes: StubPane[];
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
  let deferringSnapshots = false;
  let deferringSubscribes = false;
  const held: HeldSnapshot[] = [];
  const heldSubscribes: { connection: StubConnection; id: unknown }[] = [];

  const sendSnapshot = (connection: StubConnection, id: unknown, panes: StubPane[]): void => {
    connection.send({
      id,
      result: {
        type: 'session_snapshot',
        snapshot: {
          version: '0.7.5',
          protocol: 17,
          workspaces: [],
          tabs: [],
          panes,
          layouts: [],
          agents: [],
        },
      },
    });
    connection.end();
  };

  const handler: StubHandler = (connection, message) => {
    const method = message['method'];
    const id = message['id'];
    const params = (message['params'] ?? {}) as Record<string, unknown>;

    if (method === 'events.subscribe') {
      subscribeCount += 1;
      subscriptions = (params['subscriptions'] ?? []) as Record<string, unknown>[];
      subscriptionConnection = connection;
      if (deferringSubscribes) heldSubscribes.push({ connection, id });
      else connection.send({ id, result: { type: 'subscription_started' } });
      return; // Stays open: this connection is now an event stream.
    }

    if (method === 'session.snapshot') {
      const panes = [...paneMap.values()].map((pane) => ({ ...pane }));
      if (deferringSnapshots) held.push({ connection, id, panes });
      else sendSnapshot(connection, id, panes);
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
    deferSnapshots: () => {
      deferringSnapshots = true;
    },
    releaseSnapshots: () => {
      deferringSnapshots = false;
      for (const snapshot of held.splice(0)) {
        sendSnapshot(snapshot.connection, snapshot.id, snapshot.panes);
      }
    },
    heldSnapshots: () => held.length,
    deferSubscribes: () => {
      deferringSubscribes = true;
    },
    releaseSubscribes: () => {
      deferringSubscribes = false;
      for (const subscribe of heldSubscribes.splice(0)) {
        subscribe.connection.send({
          id: subscribe.id,
          result: { type: 'subscription_started' },
        });
      }
    },
    heldSubscribes: () => heldSubscribes.length,
  };
}
