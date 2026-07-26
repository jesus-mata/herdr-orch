import { HerdrConnection } from './connection.ts';
import { HerdrConnectionError, type HerdrError } from './errors.ts';
import type { HerdrRequestTransport } from './transport.ts';
import {
  AGENT_STATUS_CHANGED_EVENT,
  isAgentStatus,
  toAgentStatusChange,
  type AgentStatus,
  type AgentStatusChange,
  type PaneAgentStatusChangedEvent,
  type SessionSnapshot,
} from './protocol.ts';

export interface ReconnectPolicy {
  readonly initialDelayMs?: number | undefined;
  readonly maxDelayMs?: number | undefined;
  /** Attempts per outage, reset once a subscription is established. */
  readonly maxAttempts?: number | undefined;
}

export interface AgentStatusWatcherOptions {
  readonly transport: HerdrRequestTransport;
  /** Defaults to the transport's socket. */
  readonly socketPath?: string | undefined;
  readonly reconnect?: ReconnectPolicy | undefined;
  readonly connectTimeoutMs?: number | undefined;
}

/** `Required<ReconnectPolicy>` would keep the explicit `| undefined`. */
interface ResolvedReconnectPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
}

const DEFAULT_RECONNECT: ResolvedReconnectPolicy = {
  initialDelayMs: 250,
  maxDelayMs: 10_000,
  maxAttempts: 10,
};

type ChangeListener = (change: AgentStatusChange) => void;
type ErrorListener = (error: HerdrError) => void;
type ReconnectListener = () => void;

/**
 * Watches the Liveness of Worker panes.
 *
 * herdr's `pane.agent_status_changed` subscription is per pane and lives on a
 * connection that accepts no further requests, so adding a pane means replacing
 * the subscription. That is handled here, along with the consequence nobody
 * above wants to think about: every time the subscription is established there
 * is a window in which events were not being delivered, so the watcher re-reads
 * the session snapshot and reports any watched pane whose status differs from the
 * last one it delivered.
 *
 * The contract that buys is worth stating plainly: a caller is told a pane's
 * status when it starts watching, and every time it changes thereafter. Neither
 * a pane that was already `blocked` before anyone looked, nor one that went
 * `blocked` while the connection was down, can hide — and hiding is the failure
 * that matters, because a Worker stopped at a permission prompt emits nothing at
 * all and would otherwise burn its Phase's whole timeout.
 *
 * A watcher that cannot re-establish its subscription gives up loudly. Silence
 * is never an acceptable outcome for an unattended Run.
 */
export class AgentStatusWatcher {
  readonly #transport: HerdrRequestTransport;
  readonly #socketPath: string;
  readonly #reconnect: ResolvedReconnectPolicy;
  readonly #connectTimeoutMs: number | undefined;

  readonly #watched = new Set<string>();
  readonly #lastStatus = new Map<string, AgentStatus>();
  readonly #changeListeners: ChangeListener[] = [];
  readonly #errorListeners: ErrorListener[] = [];
  readonly #reconnectListeners: ReconnectListener[] = [];

  #connection: HerdrConnection | undefined;
  /** One that has been opened but not yet finished its `events.subscribe`. */
  #connecting: HerdrConnection | undefined;
  #retryTimer: NodeJS.Timeout | undefined;
  #closed = false;
  #failed = false;
  /** Serialises subscription replacement so two watch() calls cannot race. */
  #pending: Promise<void> = Promise.resolve();

  constructor(options: AgentStatusWatcherOptions) {
    this.#transport = options.transport;
    this.#socketPath = options.socketPath ?? options.transport.socketPath;
    // Spreading would reintroduce `undefined` for any key the caller set
    // explicitly to it, so each field is defaulted on its own.
    const reconnect = options.reconnect ?? {};
    this.#reconnect = {
      initialDelayMs: reconnect.initialDelayMs ?? DEFAULT_RECONNECT.initialDelayMs,
      maxDelayMs: reconnect.maxDelayMs ?? DEFAULT_RECONNECT.maxDelayMs,
      maxAttempts: reconnect.maxAttempts ?? DEFAULT_RECONNECT.maxAttempts,
    };
    this.#connectTimeoutMs = options.connectTimeoutMs;
  }

  /** True once reconnection has been abandoned. The watcher is then inert. */
  get failed(): boolean {
    return this.#failed;
  }

  get watched(): readonly string[] {
    return [...this.#watched];
  }

  lastStatus(paneId: string): AgentStatus | undefined {
    return this.#lastStatus.get(paneId);
  }

  onChange(listener: ChangeListener): void {
    this.#changeListeners.push(listener);
  }

  /** Fires once, when reconnection has been abandoned. */
  onError(listener: ErrorListener): void {
    this.#errorListeners.push(listener);
  }

  /** Fires after each re-established subscription, before any missed change. */
  onReconnect(listener: ReconnectListener): void {
    this.#reconnectListeners.push(listener);
  }

  async watch(paneId: string): Promise<void> {
    // Giving up is terminal, and a watcher that accepted new panes afterwards
    // would look healthy while never reconnecting again — the caller has to be
    // told to build a new one rather than handed a quiet one.
    if (this.#failed) {
      throw new HerdrConnectionError(
        `this watcher gave up reconnecting to the herdr socket at ${this.#socketPath}; ` +
          'pane agent status is no longer observable through it',
      );
    }
    if (this.#watched.has(paneId)) return;
    this.#watched.add(paneId);
    await this.#resubscribe();
  }

  async unwatch(paneId: string): Promise<void> {
    if (!this.#watched.delete(paneId)) return;
    this.#lastStatus.delete(paneId);
    await this.#resubscribe();
  }

  /**
   * Stops watching and releases the subscription.
   *
   * Awaits any replacement already in flight: a subscribe that was mid-connect
   * when this was called would otherwise install its socket afterwards, leaving
   * a connection nobody owns holding the event loop open.
   */
  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#releaseConnection();
    // Dropping the half-established connection above makes its `events.subscribe`
    // reject, so this settles rather than waiting on a handshake nobody will
    // finish. `#pending` never rejects — `#resubscribe` wraps it.
    await this.#pending;
    this.#releaseConnection();
  }

  #releaseConnection(): void {
    this.#connecting?.close();
    this.#connecting = undefined;
    this.#connection?.close();
    this.#connection = undefined;
  }

  /**
   * Read through a method, not the field: narrowing `this.#closed` survives an
   * `await` in TypeScript's control-flow analysis, which is precisely the
   * assumption a close() landing during that await breaks.
   */
  #isClosed(): boolean {
    return this.#closed;
  }

  /** Replaces the subscription, awaiting any replacement already in flight. */
  #resubscribe(): Promise<void> {
    const run = this.#pending.then(async () => {
      if (this.#isClosed() || this.#failed) return;
      this.#releaseConnection();
      if (this.#watched.size === 0) return;
      await this.#subscribe();
      if (this.#isClosed()) return;
      await this.#reconcile();
    });
    // Keep the chain alive even when this attempt rejects, so a later watch()
    // is not poisoned by an earlier failure.
    this.#pending = run.catch(() => undefined);
    return run;
  }

  async #subscribe(): Promise<void> {
    const paneIds = [...this.#watched];
    const connection = await HerdrConnection.connect({
      socketPath: this.#socketPath,
      connectTimeoutMs: this.#connectTimeoutMs,
    });

    // Tracked before the handshake, not after: close() has to be able to reach a
    // connection that is still being established, or it outlives the watcher.
    this.#connecting = connection;
    try {
      await subscribeOn(connection, paneIds);
    } catch (error) {
      connection.close();
      throw error;
    } finally {
      if (this.#connecting === connection) this.#connecting = undefined;
    }

    // close() landed in the gap between the handshake finishing and this line.
    // Installing the connection now would leak it past the watcher's lifetime.
    if (this.#isClosed()) {
      connection.close();
      return;
    }

    this.#connection = connection;
    connection.onMessage((message) => {
      this.#handleEvent(message);
    });
    connection.onClose(() => {
      if (this.#connection !== connection) return; // We replaced it deliberately.
      this.#connection = undefined;
      this.#scheduleReconnect(1);
    });
  }

  #handleEvent(message: Record<string, unknown>): void {
    if (message['event'] !== AGENT_STATUS_CHANGED_EVENT) return;

    const data = message['data'];
    if (typeof data !== 'object' || data === null) return;
    const event = data as unknown as PaneAgentStatusChangedEvent;
    if (typeof event.pane_id !== 'string' || !isAgentStatus(event.agent_status)) return;
    // herdr filters by pane already; this guards against a stale subscription
    // still delivering for a pane we have since stopped watching.
    if (!this.#watched.has(event.pane_id)) return;

    this.#emit(toAgentStatusChange(event));
  }

  #emit(change: AgentStatusChange): void {
    this.#lastStatus.set(change.paneId, change.status);
    for (const listener of this.#changeListeners) listener(change);
  }

  #scheduleReconnect(attempt: number): void {
    if (this.#closed || this.#failed) return;

    if (attempt > this.#reconnect.maxAttempts) {
      this.#fail(
        new HerdrConnectionError(
          `gave up trying to reconnect to the herdr socket at ${this.#socketPath} after ` +
            `${String(this.#reconnect.maxAttempts)} attempts; pane agent status is no longer observable`,
        ),
      );
      return;
    }

    const delayMs = Math.min(
      this.#reconnect.initialDelayMs * 2 ** (attempt - 1),
      this.#reconnect.maxDelayMs,
    );

    this.#retryTimer = setTimeout(() => {
      this.#attemptReconnect(attempt);
    }, delayMs);
    this.#retryTimer.unref();
  }

  #attemptReconnect(attempt: number): void {
    const run = this.#pending.then(async () => {
      if (this.#isClosed() || this.#failed) return;
      if (this.#connection !== undefined) return; // A watch() call got there first.
      if (this.#watched.size === 0) return;

      try {
        await this.#subscribe();
      } catch {
        this.#scheduleReconnect(attempt + 1);
        return;
      }
      if (this.#isClosed()) return;

      for (const listener of this.#reconnectListeners) listener();
      await this.#reconcile();
    });
    this.#pending = run.catch(() => undefined);
  }

  /**
   * Reads the live snapshot and reports any watched pane whose status differs
   * from the last one we delivered. Run after every successful subscribe, which
   * covers both the first look at a pane and the gap left by an outage.
   *
   * herdr renders the snapshot before the reply reaches us, and the subscription
   * is a separate socket, so an event fired after the snapshot was taken can be
   * delivered before it arrives. Any pane an event moved while the request was
   * in flight is therefore left alone: the event is the newer truth, and
   * overwriting it with the snapshot would report a blocked Worker as working
   * and then never correct itself, herdr having already spent its one event on
   * that transition.
   */
  async #reconcile(): Promise<void> {
    const before = new Map(this.#lastStatus);

    let snapshot: { snapshot: SessionSnapshot };
    try {
      snapshot = await this.#transport.send<{ snapshot: SessionSnapshot }>(
        'session.snapshot',
        {},
      );
    } catch {
      // The subscription is live, which is what matters; a failed reconcile just
      // means we may still be a status behind, and the next event corrects that.
      return;
    }

    for (const pane of snapshot.snapshot.panes) {
      if (!this.#watched.has(pane.pane_id)) continue;
      const delivered = this.#lastStatus.get(pane.pane_id);
      if (delivered !== before.get(pane.pane_id)) continue; // An event overtook the reply.
      if (delivered === pane.agent_status) continue;

      this.#emit({
        paneId: pane.pane_id,
        workspaceId: pane.workspace_id,
        status: pane.agent_status,
        agent: pane.agent ?? undefined,
        displayAgent: pane.display_agent ?? undefined,
        title: pane.title ?? undefined,
        stateLabels: pane.state_labels ?? {},
      });
    }
  }

  #fail(error: HerdrError): void {
    if (this.#failed) return;
    this.#failed = true;
    for (const listener of this.#errorListeners) listener(error);
  }
}

function subscribeOn(connection: HerdrConnection, paneIds: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    connection.onMessage((message) => {
      if (message['id'] !== 'orch-subscribe') return;
      const error = message['error'];
      if (error !== undefined) {
        reject(
          new HerdrConnectionError(
            `herdr refused the agent status subscription: ${JSON.stringify(error)}`,
          ),
        );
        return;
      }
      resolve();
    });

    connection.onClose((closeError) => {
      reject(
        closeError ??
          new HerdrConnectionError('herdr closed the connection before starting the subscription'),
      );
    });

    connection.send({
      id: 'orch-subscribe',
      method: 'events.subscribe',
      params: {
        subscriptions: paneIds.map((paneId) => ({
          type: AGENT_STATUS_CHANGED_EVENT,
          pane_id: paneId,
        })),
      },
    });
  });
}
