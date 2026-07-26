import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { HerdrRequestTransport } from '../src/herdr/transport.ts';
import {
  HerdrConnectionError,
  HerdrProtocolError,
  HerdrRequestError,
  HerdrTimeoutError,
} from '../src/herdr/errors.ts';
import { startStubServer, delay, type StubServer } from './helpers/stub-server.ts';

/** Answers every request with `result`, then half-closes as herdr does. */
function replyOnce(result: unknown) {
  return (connection: Parameters<Parameters<typeof startStubServer>[0]>[0], message: Record<string, unknown>) => {
    connection.send({ id: message['id'], result });
    connection.end();
  };
}

async function withServer(
  handler: Parameters<typeof startStubServer>[0],
  body: (server: StubServer, transport: HerdrRequestTransport) => Promise<void>,
): Promise<void> {
  const server = await startStubServer(handler);
  const transport = new HerdrRequestTransport({ socketPath: server.socketPath });
  try {
    await body(server, transport);
  } finally {
    await server.close();
  }
}

test('sends a request and returns its result', async () => {
  await withServer(replyOnce({ type: 'pong', protocol: 17 }), async (server, transport) => {
    const result = await transport.send('ping', {});

    assert.deepEqual(result, { type: 'pong', protocol: 17 });
    assert.deepEqual(server.allReceived()[0]?.['method'], 'ping');
    assert.deepEqual(server.allReceived()[0]?.['params'], {});
  });
});

test('gives every request a distinct id', async () => {
  await withServer(replyOnce({ type: 'ok' }), async (server, transport) => {
    await transport.send('ping', {});
    await transport.send('ping', {});
    await transport.send('ping', {});

    const ids = server.allReceived().map((message) => message['id']);
    assert.equal(new Set(ids).size, 3, `expected 3 distinct ids, got ${JSON.stringify(ids)}`);
  });
});

test('uses a fresh connection per request, because herdr answers one and closes', async () => {
  await withServer(replyOnce({ type: 'ok' }), async (server, transport) => {
    await transport.send('ping', {});
    await transport.send('ping', {});

    assert.equal(server.connectionCount(), 2);
    assert.equal(server.connection(1).received.length, 1);
    assert.equal(server.connection(2).received.length, 1);
  });
});

test('keeps concurrent in-flight requests distinct when replies come back out of order', async () => {
  const handler = async (
    connection: Parameters<Parameters<typeof startStubServer>[0]>[0],
    message: Record<string, unknown>,
  ) => {
    const label = (message['params'] as { label: number }).label;
    // Later requests answer first, so a client that paired replies by arrival
    // order rather than by id would hand back the wrong ones.
    await delay((8 - label) * 12);
    connection.send({ id: message['id'], result: { label } });
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    const labels = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = await Promise.all(
      labels.map((label) => transport.send<{ label: number }>('ping', { label })),
    );

    assert.deepEqual(
      results.map((result) => result.label),
      labels,
    );
  });
});

test('reassembles a reply that arrives split across reads', async () => {
  const handler = async (
    connection: Parameters<Parameters<typeof startStubServer>[0]>[0],
    message: Record<string, unknown>,
  ) => {
    const frame = `${JSON.stringify({ id: message['id'], result: { type: 'pong', version: '0.7.5' } })}\n`;
    await connection.writeInPieces(frame, [5, 9, 3, 20]);
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    assert.deepEqual(await transport.send('ping', {}), { type: 'pong', version: '0.7.5' });
  });
});

test('reads its reply when the server writes several frames in one packet', async () => {
  const handler = (
    connection: Parameters<Parameters<typeof startStubServer>[0]>[0],
    message: Record<string, unknown>,
  ) => {
    // One write, three frames: a stray event, the reply, another stray event.
    connection.writeRaw(
      `${JSON.stringify({ event: 'pane_updated', data: {} })}\n` +
        `${JSON.stringify({ id: message['id'], result: { type: 'ok' } })}\n` +
        `${JSON.stringify({ event: 'pane_updated', data: {} })}\n`,
    );
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    assert.deepEqual(await transport.send('ping', {}), { type: 'ok' });
  });
});

test('rejects an error envelope with herdr’s own error code', async () => {
  const handler = (
    connection: Parameters<Parameters<typeof startStubServer>[0]>[0],
    message: Record<string, unknown>,
  ) => {
    connection.send({
      id: message['id'],
      error: { code: 'pane_not_found', message: 'pane not found' },
    });
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    await assert.rejects(transport.send('pane.get', { pane_id: 'w1:p9' }), (error: unknown) => {
      assert.ok(error instanceof HerdrRequestError);
      assert.equal(error.code, 'pane_not_found');
      assert.equal(error.method, 'pane.get');
      return true;
    });
  });
});

test('rejects a reply whose id does not match the request', async () => {
  const handler = (connection: Parameters<Parameters<typeof startStubServer>[0]>[0]) => {
    connection.send({ id: 'someone-elses-request', result: { type: 'ok' } });
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    await assert.rejects(transport.send('ping', {}), HerdrProtocolError);
  });
});

test('rejects an envelope that is neither a result nor an error', async () => {
  const handler = (
    connection: Parameters<Parameters<typeof startStubServer>[0]>[0],
    message: Record<string, unknown>,
  ) => {
    connection.send({ id: message['id'], unexpected: true });
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    await assert.rejects(transport.send('ping', {}), HerdrProtocolError);
  });
});

test('rejects rather than hangs when the connection closes before replying', async () => {
  const handler = (connection: Parameters<Parameters<typeof startStubServer>[0]>[0]) => {
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    await assert.rejects(transport.send('ping', {}), HerdrConnectionError);
  });
});

test('rejects rather than hangs when the connection is dropped before replying', async () => {
  const handler = (connection: Parameters<Parameters<typeof startStubServer>[0]>[0]) => {
    connection.destroy();
  };

  await withServer(handler, async (_server, transport) => {
    await assert.rejects(transport.send('ping', {}), HerdrConnectionError);
  });
});

test('rejects when the reply is cut off mid-frame', async () => {
  const handler = (
    connection: Parameters<Parameters<typeof startStubServer>[0]>[0],
    message: Record<string, unknown>,
  ) => {
    connection.writeRaw(`{"id":"${String(message['id'])}","result":{"type":`);
    connection.end();
  };

  await withServer(handler, async (_server, transport) => {
    await assert.rejects(transport.send('ping', {}), HerdrProtocolError);
  });
});

test('rejects when the socket does not exist', async () => {
  const transport = new HerdrRequestTransport({ socketPath: '/nonexistent/herdr.sock' });

  await assert.rejects(transport.send('ping', {}), HerdrConnectionError);
});

test('times out rather than waiting forever on a silent server', async () => {
  const handler = () => {
    /* never replies */
  };

  await withServer(handler, async (_server, transport) => {
    await assert.rejects(transport.send('ping', {}, { timeoutMs: 60 }), (error: unknown) => {
      assert.ok(error instanceof HerdrTimeoutError);
      assert.equal(error.timeoutMs, 60);
      return true;
    });
  });
});

test('a timed-out request closes its connection instead of leaking it', async () => {
  const handler = () => {
    /* never replies */
  };

  await withServer(handler, async (server, transport) => {
    await assert.rejects(transport.send('ping', {}, { timeoutMs: 40 }), HerdrTimeoutError);
    await delay(30);

    assert.equal(server.connection(1).received.length, 1);
    assert.equal(server.connectionCount(), 1);
  });
});

test('honours a per-transport default timeout', async () => {
  const server = await startStubServer(() => {
    /* never replies */
  });
  const transport = new HerdrRequestTransport({
    socketPath: server.socketPath,
    defaultTimeoutMs: 50,
  });

  try {
    await assert.rejects(transport.send('ping', {}), HerdrTimeoutError);
  } finally {
    await server.close();
  }
});

test('timeoutMs null waits indefinitely, for the long waits herdr supports', async () => {
  const handler = async (
    connection: Parameters<Parameters<typeof startStubServer>[0]>[0],
    message: Record<string, unknown>,
  ) => {
    await delay(120);
    connection.send({ id: message['id'], result: { type: 'ok' } });
    connection.end();
  };

  const server = await startStubServer(handler);
  const transport = new HerdrRequestTransport({
    socketPath: server.socketPath,
    defaultTimeoutMs: 40,
  });

  try {
    assert.deepEqual(await transport.send('agent.wait', {}, { timeoutMs: null }), { type: 'ok' });
  } finally {
    await server.close();
  }
});

test('resolves the socket path from the environment when none is given', async () => {
  const server = await startStubServer(replyOnce({ type: 'pong' }));
  const transport = new HerdrRequestTransport({
    env: { HERDR_SOCKET_PATH: server.socketPath, HOME: path.sep },
  });

  try {
    assert.deepEqual(await transport.send('ping', {}), { type: 'pong' });
  } finally {
    await server.close();
  }
});
