import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A stub herdr server on a real unix socket.
 *
 * The scripted-agent fake used by the Orchestrator's own tests sits above the
 * wire and so cannot catch a framing, correlation or reconnection bug. This can:
 * it lets a test choose the exact bytes and the exact read boundaries herdr
 * would produce, including the ones a well-behaved server never produces.
 */
export interface StubConnection {
  /** 1 for the first connection the server accepted, 2 for the next, and so on. */
  readonly index: number;
  /** Messages this connection has received, in order. */
  readonly received: Record<string, unknown>[];
  /** Writes raw bytes, newlines and all. The test decides the framing. */
  writeRaw(bytes: string | Buffer): void;
  /** Writes one JSON message followed by a newline. */
  send(message: unknown): void;
  /** Writes bytes in the given pieces, pausing between them. */
  writeInPieces(bytes: string, pieces: number[], gapMs?: number): Promise<void>;
  /** Half-closes, the way herdr does after answering a request. */
  end(): void;
  /** Drops the connection without a FIN, the way a crash does. */
  destroy(): void;
}

export interface StubServer {
  readonly socketPath: string;
  /** How many connections have been accepted over the server's lifetime. */
  connectionCount(): number;
  connection(index: number): StubConnection;
  /** Every message received, across all connections, in arrival order. */
  allReceived(): Record<string, unknown>[];
  /** Resolves once `count` connections have been accepted. */
  waitForConnections(count: number): Promise<void>;
  /** Stops accepting and drops all live connections. */
  stopListening(): Promise<void>;
  /** Listens again on the same path, as a restarted herdr would. */
  resumeListening(): Promise<void>;
  close(): Promise<void>;
}

export type StubHandler = (
  connection: StubConnection,
  message: Record<string, unknown>,
) => void | Promise<void>;

export async function startStubServer(handler: StubHandler): Promise<StubServer> {
  // Unix socket paths are capped near 104 bytes on macOS, so keep this short.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-'));
  const socketPath = path.join(dir, 's');

  const connections: StubConnection[] = [];
  const sockets: net.Socket[] = [];
  const connectionWaiters: { count: number; resolve: () => void }[] = [];
  let server = net.createServer();

  const onConnection = (socket: net.Socket): void => {
    socket.on('error', () => {
      // A test that drops a connection mid-write is exercising the client, not
      // the stub; ECONNRESET here is expected and uninteresting.
    });
    sockets.push(socket);

    const received: Record<string, unknown>[] = [];
    const index = connections.length + 1;
    const connection: StubConnection = {
      index,
      received,
      writeRaw: (bytes) => {
        if (!socket.destroyed) socket.write(bytes);
      },
      send: (message) => {
        if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
      },
      writeInPieces: async (bytes, pieces, gapMs = 5) => {
        let offset = 0;
        for (const size of pieces) {
          if (socket.destroyed) return;
          socket.write(bytes.slice(offset, offset + size));
          offset += size;
          await delay(gapMs);
        }
        if (offset < bytes.length && !socket.destroyed) socket.write(bytes.slice(offset));
      },
      end: () => {
        socket.end();
      },
      destroy: () => {
        socket.destroy();
      },
    };
    connections.push(connection);

    for (const waiter of connectionWaiters.splice(0)) {
      if (connections.length >= waiter.count) waiter.resolve();
      else connectionWaiters.push(waiter);
    }

    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineAt = buffer.indexOf('\n');
      while (newlineAt !== -1) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (line.trim() !== '') {
          const message = JSON.parse(line) as Record<string, unknown>;
          received.push(message);
          void handler(connection, message);
        }
        newlineAt = buffer.indexOf('\n');
      }
    });
  };

  server.on('connection', onConnection);
  await listen(server, socketPath);

  return {
    socketPath,
    connectionCount: () => connections.length,
    connection: (index) => {
      const connection = connections[index - 1];
      if (connection === undefined) {
        throw new Error(`no connection ${String(index)}; ${String(connections.length)} accepted`);
      }
      return connection;
    },
    allReceived: () => connections.flatMap((connection) => connection.received),
    waitForConnections: (count) =>
      connections.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => connectionWaiters.push({ count, resolve })),
    stopListening: async () => {
      // Drop live connections first: net.Server.close() does not call back until
      // every accepted connection has ended, so closing before destroying hangs.
      for (const socket of sockets.splice(0)) socket.destroy();
      await closeServer(server);
      fs.rmSync(socketPath, { force: true });
    },
    resumeListening: async () => {
      server = net.createServer();
      server.on('connection', onConnection);
      await listen(server, socketPath);
    },
    close: async () => {
      for (const socket of sockets.splice(0)) socket.destroy();
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function listen(server: net.Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
