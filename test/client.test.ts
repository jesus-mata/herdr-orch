import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HerdrClient } from '../src/herdr/client.ts';
import { HerdrRequestError } from '../src/herdr/errors.ts';
import { startStubServer, type StubServer } from './helpers/stub-server.ts';
import { createHerdrStub } from './helpers/herdr-stub.ts';

interface Harness {
  server: StubServer;
  client: HerdrClient;
  /** The params herdr received for `method`. Fails if it was never called. */
  readonly paramsFor: (method: string) => Record<string, unknown>;
}

async function withClient(
  results: Record<string, unknown>,
  body: (harness: Harness) => Promise<void>,
): Promise<void> {
  const server = await startStubServer((connection, message) => {
    const method = message['method'] as string;
    const result = results[method] ?? { type: 'ok' };
    connection.send({ id: message['id'], result });
    connection.end();
  });
  const client = new HerdrClient({ socketPath: server.socketPath });

  try {
    await body({
      server,
      client,
      paramsFor: (method) => {
        const request = server
          .allReceived()
          .find((received) => received['method'] === method);
        assert.ok(request !== undefined, `herdr never received ${method}`);
        return request['params'] as Record<string, unknown>;
      },
    });
  } finally {
    await client.close();
    await server.close();
  }
}

test('ping reports the protocol version herdr is speaking', async () => {
  await withClient(
    { ping: { type: 'pong', version: '0.7.5', protocol: 17, capabilities: {} } },
    async ({ client }) => {
      const pong = await client.ping();

      assert.equal(pong.protocol, 17);
      assert.equal(pong.version, '0.7.5');
    },
  );
});

test('returns a session snapshot', async () => {
  const snapshot = {
    version: '0.7.5',
    protocol: 17,
    workspaces: [{ workspace_id: 'w1', label: 'herdr-orch' }],
    tabs: [],
    panes: [{ pane_id: 'w1:p1', agent_status: 'idle' }],
    layouts: [],
    agents: [],
  };

  await withClient(
    { 'session.snapshot': { type: 'session_snapshot', snapshot } },
    async ({ client }) => {
      const result = await client.sessionSnapshot();

      assert.equal(result.protocol, 17);
      assert.equal(result.workspaces[0]?.workspace_id, 'w1');
      assert.equal(result.panes[0]?.pane_id, 'w1:p1');
    },
  );
});

test('creates a worktree-backed workspace', async () => {
  const result = {
    type: 'worktree_created',
    workspace: { workspace_id: 'w2' },
    tab: { tab_id: 'w2:t1', workspace_id: 'w2' },
    root_pane: { pane_id: 'w2:p1' },
    worktree: { path: '/tmp/wt', branch: 'spec-1' },
  };

  await withClient({ 'worktree.create': result }, async ({ client, paramsFor }) => {
    const created = await client.createWorktreeWorkspace({
      cwd: '/repo',
      branch: 'spec-1',
      base: 'main',
      path: '/tmp/wt',
      label: 'spec-1',
    });

    assert.equal(created.worktree.path, '/tmp/wt');
    assert.equal(created.rootPane.pane_id, 'w2:p1');
    assert.deepEqual(paramsFor('worktree.create'), {
      cwd: '/repo',
      branch: 'spec-1',
      base: 'main',
      path: '/tmp/wt',
      label: 'spec-1',
      focus: false,
    });
  });
});

test('creates a tab without stealing focus by default', async () => {
  const result = {
    type: 'tab_created',
    tab: { tab_id: 'w1:t2', workspace_id: 'w1' },
    root_pane: { pane_id: 'w1:p3' },
  };

  await withClient({ 'tab.create': result }, async ({ client, paramsFor }) => {
    const created = await client.createTab({ workspaceId: 'w1', label: 'ticket-2' });

    assert.equal(created.tab.tab_id, 'w1:t2');
    assert.deepEqual(paramsFor('tab.create'), {
      workspace_id: 'w1',
      label: 'ticket-2',
      focus: false,
    });
  });
});

test('splits a pane and returns the new pane', async () => {
  await withClient(
    { 'pane.split': { type: 'pane_info', pane: { pane_id: 'w1:p4' } } },
    async ({ client, paramsFor }) => {
      const pane = await client.splitPane({ targetPaneId: 'w1:p3', direction: 'down' });

      assert.equal(pane.pane_id, 'w1:p4');
      assert.deepEqual(paramsFor('pane.split'), {
        target_pane_id: 'w1:p3',
        direction: 'down',
        focus: false,
      });
    },
  );
});

test('passes a pane environment through, which is how a Worker learns its verdict path', async () => {
  await withClient(
    { 'pane.split': { type: 'pane_info', pane: { pane_id: 'w1:p4' } } },
    async ({ client, paramsFor }) => {
      await client.splitPane({
        targetPaneId: 'w1:p3',
        direction: 'right',
        env: { HERDR_ORCH_VERDICT_PATH: '/tmp/verdict.json' },
      });

      assert.deepEqual(paramsFor('pane.split')['env'], {
        HERDR_ORCH_VERDICT_PATH: '/tmp/verdict.json',
      });
    },
  );
});

test('renames a pane, which is how an orphan is found after a crash', async () => {
  await withClient({}, async ({ client, paramsFor }) => {
    await client.renamePane('w1:p4', 'orch/run-1/ticket-2/implement');

    assert.deepEqual(paramsFor('pane.rename'), {
      pane_id: 'w1:p4',
      label: 'orch/run-1/ticket-2/implement',
    });
  });
});

test('clears a pane label when given no name', async () => {
  await withClient({}, async ({ client, paramsFor }) => {
    await client.renamePane('w1:p4', undefined);

    assert.deepEqual(paramsFor('pane.rename'), { pane_id: 'w1:p4', label: null });
  });
});

test('closes a pane and a tab', async () => {
  await withClient({}, async ({ client, paramsFor }) => {
    await client.closePane('w1:p4');
    await client.closeTab('w1:t2');

    assert.deepEqual(paramsFor('pane.close'), { pane_id: 'w1:p4' });
    assert.deepEqual(paramsFor('tab.close'), { tab_id: 'w1:t2' });
  });
});

test('reads a pane, which is how output is captured before the pane closes', async () => {
  const read = {
    pane_id: 'w1:p4',
    workspace_id: 'w1',
    tab_id: 'w1:t2',
    source: 'recent_unwrapped',
    format: 'text',
    text: 'all tests passed',
    revision: 12,
    truncated: false,
  };

  await withClient({ 'pane.read': { type: 'pane_read', read } }, async ({ client, paramsFor }) => {
    const result = await client.readPane({
      paneId: 'w1:p4',
      source: 'recent_unwrapped',
      lines: 5_000,
    });

    assert.equal(result.text, 'all tests passed');
    assert.equal(result.truncated, false);
    assert.deepEqual(paramsFor('pane.read'), {
      pane_id: 'w1:p4',
      source: 'recent_unwrapped',
      lines: 5_000,
      strip_ansi: true,
    });
  });
});

test('starts an agent in an existing pane', async () => {
  const result = {
    type: 'agent_started',
    agent: { pane_id: 'w1:p4', agent: 'claude', agent_status: 'idle' },
    argv: ['claude'],
  };

  await withClient({ 'agent.start': result }, async ({ client, paramsFor }) => {
    const started = await client.startAgent({
      paneId: 'w1:p4',
      name: 'implement',
      kind: 'claude',
      args: ['--permission-mode', 'acceptEdits'],
      startupTimeoutMs: 60_000,
    });

    assert.equal(started.agent, 'claude');
    assert.deepEqual(paramsFor('agent.start'), {
      pane_id: 'w1:p4',
      name: 'implement',
      kind: 'claude',
      args: ['--permission-mode', 'acceptEdits'],
      timeout_ms: 60_000,
    });
  });
});

// The invariant this module exists to hold. A Worker stopped at a permission
// prompt reaches `blocked` and never `done`, so a prompt that waited on the
// finished states alone would burn the Phase's entire timeout on a dialog.

test('prompting a Worker waits on blocked as well as the finished states', async () => {
  await withClient(
    { 'agent.prompt': { type: 'agent_prompted', agent: { pane_id: 'w1:p4' } } },
    async ({ client, paramsFor }) => {
      await client.promptAgent({ target: 'w1:p4', text: 'implement ticket 2' });

      const wait = paramsFor('agent.prompt')['wait'] as { until: string[] };
      assert.deepEqual([...wait.until].sort(), ['blocked', 'done', 'idle']);
    },
  );
});

test('prompting adds blocked to whatever states the caller asked for', async () => {
  await withClient(
    { 'agent.prompt': { type: 'agent_prompted', agent: { pane_id: 'w1:p4' } } },
    async ({ client, paramsFor }) => {
      await client.promptAgent({ target: 'w1:p4', text: 'go', until: ['done'] });

      const wait = paramsFor('agent.prompt')['wait'] as { until: string[] };
      assert.ok(wait.until.includes('blocked'), `expected blocked in ${JSON.stringify(wait.until)}`);
      assert.ok(wait.until.includes('done'));
    },
  );
});

test('prompting cannot be asked to wait on the finished state alone', async () => {
  await withClient(
    { 'agent.prompt': { type: 'agent_prompted', agent: { pane_id: 'w1:p4' } } },
    async ({ client, paramsFor }) => {
      // Even an explicit, deliberate request for done-only is widened.
      await client.promptAgent({ target: 'w1:p4', text: 'go', until: ['done', 'done'] });

      const wait = paramsFor('agent.prompt')['wait'] as { until: string[] };
      assert.notDeepEqual([...new Set(wait.until)], ['done']);
      assert.ok(wait.until.includes('blocked'));
    },
  );
});

test('prompting passes its deadline to herdr as well as to the transport', async () => {
  await withClient(
    { 'agent.prompt': { type: 'agent_prompted', agent: { pane_id: 'w1:p4' } } },
    async ({ client, paramsFor }) => {
      await client.promptAgent({ target: 'w1:p4', text: 'go', timeoutMs: 90_000 });

      const wait = paramsFor('agent.prompt')['wait'] as { timeout_ms: number };
      assert.equal(wait.timeout_ms, 90_000);
    },
  );
});

test('waiting on an agent also waits on blocked', async () => {
  await withClient(
    { 'agent.wait': { type: 'agent_info', agent: { pane_id: 'w1:p4', agent_status: 'blocked' } } },
    async ({ client, paramsFor }) => {
      const agent = await client.waitForAgent({ target: 'w1:p4', until: ['done'] });

      assert.equal(agent.agent_status, 'blocked');
      assert.ok((paramsFor('agent.wait')['until'] as string[]).includes('blocked'));
    },
  );
});

test('lists agents and panes', async () => {
  await withClient(
    {
      'agent.list': {
        type: 'agent_list',
        agents: [{ pane_id: 'w1:p4', agent: 'claude', agent_status: 'working' }],
      },
      'pane.list': { type: 'pane_list', panes: [{ pane_id: 'w1:p4', agent_status: 'working' }] },
    },
    async ({ client }) => {
      assert.equal((await client.listAgents())[0]?.agent, 'claude');
      assert.equal((await client.listPanes())[0]?.pane_id, 'w1:p4');
    },
  );
});

test('surfaces a herdr error code to the caller', async () => {
  const server = await startStubServer((connection, message) => {
    connection.send({
      id: message['id'],
      error: { code: 'agent_prompt_stalled', message: 'no state change observed' },
    });
    connection.end();
  });
  const client = new HerdrClient({ socketPath: server.socketPath });

  try {
    await assert.rejects(
      client.promptAgent({ target: 'w1:p4', text: 'go' }),
      (error: unknown) => {
        assert.ok(error instanceof HerdrRequestError);
        assert.equal(error.code, 'agent_prompt_stalled');
        return true;
      },
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test('watches a pane’s agent status through the client', async () => {
  const stub = createHerdrStub([{ pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'idle' }]);
  const server = await startStubServer(stub.handler);
  const client = new HerdrClient({ socketPath: server.socketPath });
  const statuses: string[] = [];

  try {
    client.onAgentStatusChange((change) => statuses.push(change.status));
    await client.watchAgentStatus('w1:p1');

    stub.emitStatusChange({ pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'working' });

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !statuses.includes('working')) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(statuses.includes('working'), `got ${JSON.stringify(statuses)}`);
  } finally {
    await client.close();
    await server.close();
  }
});
