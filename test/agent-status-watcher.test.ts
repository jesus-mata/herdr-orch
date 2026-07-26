import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AgentStatusWatcher } from '../src/herdr/agent-status-watcher.ts';
import { HerdrRequestTransport } from '../src/herdr/transport.ts';
import { HerdrError } from '../src/herdr/errors.ts';
import type { AgentStatusChange } from '../src/herdr/protocol.ts';
import { startStubServer, delay, type StubServer } from './helpers/stub-server.ts';
import { createHerdrStub, type HerdrStub } from './helpers/herdr-stub.ts';
import { waitFor } from './helpers/wait-for.ts';

interface Harness {
  server: StubServer;
  stub: HerdrStub;
  watcher: AgentStatusWatcher;
  changes: AgentStatusChange[];
  errors: HerdrError[];
  /** Changes for one pane, which is what most assertions here care about. */
  readonly changesFor: (paneId: string) => AgentStatusChange[];
}

async function withWatcher(
  panes: { pane_id: string; workspace_id: string; agent_status: string }[],
  body: (harness: Harness) => Promise<void>,
): Promise<void> {
  const stub = createHerdrStub(panes);
  const server = await startStubServer(stub.handler);
  const transport = new HerdrRequestTransport({ socketPath: server.socketPath });
  const changes: AgentStatusChange[] = [];
  const errors: HerdrError[] = [];
  const watcher = new AgentStatusWatcher({
    transport,
    reconnect: { initialDelayMs: 10, maxDelayMs: 30, maxAttempts: 4 },
  });
  watcher.onChange((change) => changes.push(change));
  watcher.onError((error) => errors.push(error));

  try {
    await body({
      server,
      stub,
      watcher,
      changes,
      errors,
      changesFor: (paneId) => changes.filter((change) => change.paneId === paneId),
    });
  } finally {
    watcher.close();
    await server.close();
  }
}

const PANE_A = { pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'idle' };
const PANE_B = { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'idle' };

test('surfaces a pane agent status change to the caller', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher, changes }) => {
    await watcher.watch(PANE_A.pane_id);

    stub.emitStatusChange({ ...PANE_A, agent_status: 'working' }, { agent: 'claude' });
    await waitFor(
      () => changes.some((change) => change.status === 'working'),
      'the status change to arrive',
    );

    assert.deepEqual(changes.find((change) => change.status === 'working'), {
      paneId: 'w1:p1',
      workspaceId: 'w1',
      status: 'working',
      agent: 'claude',
      displayAgent: undefined,
      title: undefined,
      stateLabels: {},
    });
  });
});

test('reports the pane’s current status as soon as watching begins', async () => {
  await withWatcher([{ ...PANE_A, agent_status: 'blocked' }], async ({ watcher, changes }) => {
    // The Worker was already stopped at a prompt before anyone looked. It will
    // emit no event, so being told on subscribe is the only way to find out.
    await watcher.watch(PANE_A.pane_id);
    await waitFor(() => changes.length === 1, 'the initial status');

    assert.equal(changes[0]?.status, 'blocked');
  });
});

test('surfaces the blocked status, which is the one a permission prompt produces', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher, changes }) => {
    await watcher.watch(PANE_A.pane_id);

    stub.emitStatusChange({ ...PANE_A, agent_status: 'blocked' });
    await waitFor(
      () => changes.some((change) => change.status === 'blocked'),
      'the blocked status to arrive',
    );
  });
});

test('subscribes for exactly the watched panes', async () => {
  await withWatcher([PANE_A, PANE_B], async ({ stub, watcher }) => {
    await watcher.watch(PANE_A.pane_id);

    assert.deepEqual(stub.subscriptions(), [
      { type: 'pane.agent_status_changed', pane_id: 'w1:p1' },
    ]);
  });
});

test('watching a second pane re-establishes a subscription covering both', async () => {
  await withWatcher([PANE_A, PANE_B], async ({ stub, watcher, changes }) => {
    await watcher.watch(PANE_A.pane_id);
    await watcher.watch(PANE_B.pane_id);

    assert.deepEqual(
      stub.subscriptions().map((subscription) => subscription['pane_id']),
      ['w1:p1', 'w1:p2'],
    );

    stub.emitStatusChange({ ...PANE_B, agent_status: 'done' });
    await waitFor(
      () => changes.some((change) => change.paneId === 'w1:p2' && change.status === 'done'),
      'a change for the second pane',
    );
  });
});

test('watching a pane twice does not re-subscribe', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher }) => {
    await watcher.watch(PANE_A.pane_id);
    const afterFirst = stub.subscribeCount();
    await watcher.watch(PANE_A.pane_id);

    assert.equal(stub.subscribeCount(), afterFirst);
  });
});

test('stops delivering changes for an unwatched pane', async () => {
  await withWatcher([PANE_A, PANE_B], async ({ stub, watcher, changesFor }) => {
    await watcher.watch(PANE_A.pane_id);
    await watcher.watch(PANE_B.pane_id);
    await watcher.unwatch(PANE_A.pane_id);
    const deliveredBefore = changesFor(PANE_A.pane_id).length;

    assert.deepEqual(
      stub.subscriptions().map((subscription) => subscription['pane_id']),
      ['w1:p2'],
    );

    stub.emitStatusChange({ ...PANE_A, agent_status: 'working' });
    await delay(60);

    assert.equal(changesFor(PANE_A.pane_id).length, deliveredBefore);
  });
});

test('ignores an event for a pane it does not watch', async () => {
  await withWatcher([PANE_A, PANE_B], async ({ stub, watcher, changesFor }) => {
    await watcher.watch(PANE_A.pane_id);

    stub.emitStatusChange({ ...PANE_B, agent_status: 'working' });
    await delay(60);

    assert.deepEqual(changesFor(PANE_B.pane_id), []);
  });
});

test('reconnects after the connection drops and keeps delivering changes', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher, changes, errors }) => {
    await watcher.watch(PANE_A.pane_id);
    const subscribesBefore = stub.subscribeCount();

    stub.subscriptionConnection()?.destroy();
    await waitFor(() => stub.subscribeCount() > subscribesBefore, 'a re-subscription');

    stub.emitStatusChange({ ...PANE_A, agent_status: 'working' });
    await waitFor(
      () => changes.some((change) => change.status === 'working'),
      'a change after reconnecting',
    );
    assert.deepEqual(errors, []);
  });
});

test('re-subscribes to every watched pane after a reconnect', async () => {
  await withWatcher([PANE_A, PANE_B], async ({ stub, watcher }) => {
    await watcher.watch(PANE_A.pane_id);
    await watcher.watch(PANE_B.pane_id);
    const subscribesBefore = stub.subscribeCount();

    stub.subscriptionConnection()?.destroy();
    await waitFor(() => stub.subscribeCount() > subscribesBefore, 'a re-subscription');

    assert.deepEqual(
      stub.subscriptions().map((subscription) => subscription['pane_id']),
      ['w1:p1', 'w1:p2'],
    );
  });
});

test('reports a status that changed while the connection was down', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher, changes }) => {
    await watcher.watch(PANE_A.pane_id);
    const subscribesBefore = stub.subscribeCount();

    // The pane goes blocked during the gap, so no event is ever delivered for
    // it. A watcher that only forwarded events would leave the Orchestrator
    // waiting on a Worker that is in fact stopped at a prompt.
    stub.panes.set(PANE_A.pane_id, { ...PANE_A, agent_status: 'blocked' });
    stub.subscriptionConnection()?.destroy();

    await waitFor(() => stub.subscribeCount() > subscribesBefore, 'a re-subscription');
    await waitFor(
      () => changes.some((change) => change.status === 'blocked'),
      'the missed status to be reported after reconnecting',
    );
  });
});

test('does not invent a change when nothing moved while the connection was down', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher, changes }) => {
    await watcher.watch(PANE_A.pane_id);
    stub.emitStatusChange({ ...PANE_A, agent_status: 'working' });
    await waitFor(() => changes.some((change) => change.status === 'working'), 'the first change');
    const deliveredBefore = changes.length;

    const subscribesBefore = stub.subscribeCount();
    stub.subscriptionConnection()?.destroy();
    await waitFor(() => stub.subscribeCount() > subscribesBefore, 'a re-subscription');
    await delay(60);

    assert.equal(changes.length, deliveredBefore);
  });
});

test('announces each reconnect so callers can distrust what they missed', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher }) => {
    let reconnects = 0;
    watcher.onReconnect(() => (reconnects += 1));
    await watcher.watch(PANE_A.pane_id);

    stub.subscriptionConnection()?.destroy();
    await waitFor(() => reconnects === 1, 'the reconnect signal');
  });
});

test('surfaces the failure rather than hanging when it cannot reconnect', async () => {
  await withWatcher([PANE_A], async ({ server, stub, watcher, errors }) => {
    await watcher.watch(PANE_A.pane_id);

    await server.stopListening();
    stub.subscriptionConnection()?.destroy();

    await waitFor(() => errors.length === 1, 'the terminal reconnect failure');
    assert.match(errors[0]?.message ?? '', /reconnect/i);
    assert.equal(watcher.failed, true);
  });
});

test('recovers when herdr comes back before the attempts run out', async () => {
  await withWatcher([PANE_A], async ({ server, stub, watcher, changes, errors }) => {
    await watcher.watch(PANE_A.pane_id);
    const subscribesBefore = stub.subscribeCount();

    await server.stopListening();
    await server.resumeListening();

    await waitFor(() => stub.subscribeCount() > subscribesBefore, 'a re-subscription');
    stub.emitStatusChange({ ...PANE_A, agent_status: 'done' });
    await waitFor(
      () => changes.some((change) => change.status === 'done'),
      'a change after recovery',
    );
    assert.deepEqual(errors, []);
  });
});

test('watch() rejects when the socket cannot be reached at all', async () => {
  const transport = new HerdrRequestTransport({ socketPath: '/nonexistent/herdr.sock' });
  const watcher = new AgentStatusWatcher({
    transport,
    reconnect: { initialDelayMs: 5, maxDelayMs: 10, maxAttempts: 2 },
  });

  try {
    await assert.rejects(watcher.watch('w1:p1'), HerdrError);
  } finally {
    watcher.close();
  }
});

test('close() stops reconnecting', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher, errors }) => {
    await watcher.watch(PANE_A.pane_id);
    watcher.close();

    stub.subscriptionConnection()?.destroy();
    const subscribesAfterClose = stub.subscribeCount();
    await delay(80);

    assert.equal(stub.subscribeCount(), subscribesAfterClose);
    assert.deepEqual(errors, []);
  });
});

test('reports the last status it saw for a pane', async () => {
  await withWatcher([PANE_A], async ({ stub, watcher, changes }) => {
    await watcher.watch(PANE_A.pane_id);
    await waitFor(() => watcher.lastStatus(PANE_A.pane_id) === 'idle', 'the initial status');

    stub.emitStatusChange({ ...PANE_A, agent_status: 'blocked' });
    await waitFor(() => changes.some((change) => change.status === 'blocked'), 'the change');

    assert.equal(watcher.lastStatus(PANE_A.pane_id), 'blocked');
  });
});

test('tracks which panes it is watching', async () => {
  await withWatcher([PANE_A, PANE_B], async ({ watcher }) => {
    await watcher.watch(PANE_A.pane_id);
    await watcher.watch(PANE_B.pane_id);
    assert.deepEqual(watcher.watched, ['w1:p1', 'w1:p2']);

    await watcher.unwatch(PANE_A.pane_id);
    assert.deepEqual(watcher.watched, ['w1:p2']);
  });
});
