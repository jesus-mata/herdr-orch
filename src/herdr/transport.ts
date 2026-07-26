import { randomUUID } from 'node:crypto';

import { HerdrConnection } from './connection.ts';
import {
  HerdrConnectionError,
  HerdrProtocolError,
  HerdrRequestError,
  HerdrTimeoutError,
} from './errors.ts';
import { resolveSocketPath, type SocketPathEnv } from './socket-path.ts';

/**
 * 30s suits the ordinary methods. The long ones — `agent.prompt` with a wait,
 * `agent.wait`, `pane.wait_for_output` — are given their own deadline by the
 * caller, or `null` for none.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface HerdrRequestTransportOptions {
  /** Bypasses socket-path resolution. */
  readonly socketPath?: string | undefined;
  /** Names a herdr session, as `--session` does. */
  readonly session?: string | undefined;
  /** Defaults to `process.env`. */
  readonly env?: SocketPathEnv | undefined;
  /** `null` disables the default deadline. */
  readonly defaultTimeoutMs?: number | null | undefined;
  readonly connectTimeoutMs?: number | undefined;
}

export interface SendOptions {
  /** `null` waits indefinitely, for the methods herdr lets block. */
  readonly timeoutMs?: number | null | undefined;
}

/**
 * Sends one request to herdr and returns its reply.
 *
 * herdr answers exactly one request per connection and then sends EOF (see
 * ADR-0004), so each request gets its own connection and correlation is
 * structural rather than a matter of bookkeeping. The reply's id is still
 * checked against the request's: a mismatch means we are not talking to the
 * herdr we think we are, and that is worth failing on rather than acting on.
 */
export class HerdrRequestTransport {
  readonly #socketPath: string;
  readonly #defaultTimeoutMs: number | null;
  readonly #connectTimeoutMs: number | undefined;
  readonly #idPrefix = randomUUID().slice(0, 8);
  #nextId = 0;

  constructor(options: HerdrRequestTransportOptions = {}) {
    this.#socketPath = resolveSocketPath(options.env ?? process.env, {
      socketPath: options.socketPath,
      session: options.session,
    });
    this.#defaultTimeoutMs =
      options.defaultTimeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.defaultTimeoutMs;
    this.#connectTimeoutMs = options.connectTimeoutMs;
  }

  get socketPath(): string {
    return this.#socketPath;
  }

  async send<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    options: SendOptions = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs === undefined ? this.#defaultTimeoutMs : options.timeoutMs;
    const id = `orch-${this.#idPrefix}-${String(++this.#nextId)}`;

    const connection = await HerdrConnection.connect({
      socketPath: this.#socketPath,
      connectTimeoutMs:
        this.#connectTimeoutMs ?? (timeoutMs === null ? undefined : Math.max(timeoutMs, 1)),
    });

    try {
      return await this.#awaitReply<T>(connection, { id, method, params, timeoutMs });
    } finally {
      connection.close();
    }
  }

  #awaitReply<T>(
    connection: HerdrConnection,
    request: {
      id: string;
      method: string;
      params: Record<string, unknown>;
      timeoutMs: number | null;
    },
  ): Promise<T> {
    const { id, method, params, timeoutMs } = request;

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };

      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              settle(() => {
                reject(
                  new HerdrTimeoutError(
                    `${method} did not reply within ${String(timeoutMs)}ms`,
                    timeoutMs,
                  ),
                );
              });
            }, timeoutMs);
      timer?.unref();

      connection.onMessage((message) => {
        // Frames without an id are events, not replies; herdr can interleave
        // them, so they are skipped rather than mistaken for the answer.
        if (message['id'] === undefined) return;

        settle(() => {
          if (message['id'] !== id) {
            reject(
              new HerdrProtocolError(
                `herdr replied to ${method} with id ${JSON.stringify(message['id'])}, expected ${JSON.stringify(id)}`,
              ),
            );
            return;
          }

          const error = message['error'];
          if (isErrorBody(error)) {
            reject(new HerdrRequestError(error.code, error.message, method));
            return;
          }

          if (message['result'] === undefined) {
            reject(
              new HerdrProtocolError(
                `herdr replied to ${method} with neither a result nor an error`,
              ),
            );
            return;
          }

          resolve(message['result'] as T);
        });
      });

      connection.onClose((closeError) => {
        settle(() => {
          reject(
            closeError ??
              new HerdrConnectionError(`herdr closed the connection before replying to ${method}`),
          );
        });
      });

      connection.send({ id, method, params });
    });
  }
}

function isErrorBody(value: unknown): value is { code: string; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body['code'] === 'string' && typeof body['message'] === 'string';
}
