import net from 'node:net';

import { NdjsonDecoder } from './framing.ts';
import { HerdrConnectionError, HerdrError } from './errors.ts';

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export interface HerdrConnectionOptions {
  readonly socketPath: string;
  readonly connectTimeoutMs?: number | undefined;
}

export type MessageListener = (message: Record<string, unknown>) => void;

/**
 * How a connection ended. `undefined` means the peer closed it cleanly on a
 * frame boundary — which for herdr is the normal end of a request, not a fault.
 */
export type CloseListener = (error: HerdrError | undefined) => void;

/**
 * One connection to the herdr socket, delivering whole messages.
 *
 * Deliberately ignorant of what the messages mean: it owns the socket, the
 * framing and the end-of-stream rules, and nothing else. Both the one-shot
 * request path and the long-lived subscription path are built on it.
 */
export class HerdrConnection {
  readonly #socket: net.Socket;
  readonly #decoder = new NdjsonDecoder();
  #messageListener: MessageListener | undefined;
  #closeListener: CloseListener | undefined;
  #closeError: HerdrError | undefined;
  #closed = false;

  private constructor(socket: net.Socket) {
    this.#socket = socket;

    socket.on('data', (chunk: Buffer) => {
      let messages: Record<string, unknown>[];
      try {
        messages = this.#decoder.push(chunk);
      } catch (error) {
        this.#fail(error);
        return;
      }
      for (const message of messages) this.#messageListener?.(message);
    });

    socket.on('end', () => {
      try {
        this.#decoder.end();
      } catch (error) {
        this.#fail(error);
      }
    });

    socket.on('error', (error: Error) => {
      this.#fail(new HerdrConnectionError(`herdr connection failed: ${error.message}`));
    });

    socket.on('close', () => {
      this.#closed = true;
      const listener = this.#closeListener;
      this.#closeListener = undefined;
      this.#messageListener = undefined;
      listener?.(this.#closeError);
    });
  }

  static connect(options: HerdrConnectionOptions): Promise<HerdrConnection> {
    const { socketPath } = options;
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    return new Promise<HerdrConnection>((resolve, reject) => {
      const socket = net.createConnection({ path: socketPath });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new HerdrConnectionError(
            `timed out after ${String(connectTimeoutMs)}ms connecting to the herdr socket at ${socketPath}`,
          ),
        );
      }, connectTimeoutMs);
      timer.unref();

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeListener('error', onEarlyError);
        resolve(new HerdrConnection(socket));
      });

      function onEarlyError(error: Error): void {
        clearTimeout(timer);
        socket.destroy();
        reject(
          new HerdrConnectionError(
            `cannot reach the herdr socket at ${socketPath}: ${error.message}`,
          ),
        );
      }
      socket.once('error', onEarlyError);
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  onMessage(listener: MessageListener): void {
    this.#messageListener = listener;
  }

  /** Fires once, with the reason the connection ended. */
  onClose(listener: CloseListener): void {
    if (this.#closed) {
      listener(this.#closeError);
      return;
    }
    this.#closeListener = listener;
  }

  send(message: unknown): void {
    this.#socket.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.#socket.destroy();
  }

  #fail(error: unknown): void {
    this.#closeError ??=
      error instanceof HerdrError
        ? error
        : new HerdrConnectionError(`herdr connection failed: ${String(error)}`);
    this.#socket.destroy();
  }
}
